"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

// Wizard flow (June 2026 rework): prospects arrive having verbally agreed a
// quote, so the order is confirm-details -> contract -> payment -> Slack ->
// onboarding questionnaire -> complete. These actions are intentionally public
// (access = having the link); each re-checks the current step server-side so
// steps can't be skipped or replayed. clientId is bound server-side by the
// page, never taken from form input.

async function getState(clientId: string) {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("onboarding_state")
    .select("current_step, details_confirmed")
    .eq("client_id", clientId)
    .single();
  return data;
}

// Step 1: confirm/correct the details that merge into the contract.
export async function confirmDetails(
  clientId: string,
  formData: FormData,
): Promise<void> {
  const state = await getState(clientId);
  if (!state) throw new Error("Onboarding not found.");
  if (state.current_step !== "contract" || state.details_confirmed) {
    revalidatePath(`/onboarding/${clientId}`);
    return;
  }

  const companyName = String(formData.get("company_name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  if (!companyName || !contactName || !contactEmail) {
    throw new Error("Company, name, and email are required.");
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({
      company_name: companyName,
      contact_name: contactName,
      contact_email: contactEmail,
    })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  const { error: stateErr } = await supabase
    .from("onboarding_state")
    .update({ details_confirmed: true })
    .eq("client_id", clientId);
  if (stateErr) throw new Error(stateErr.message);

  await logActivity({ clientId, eventType: "details_confirmed", actor: "client" });
  revalidatePath(`/onboarding/${clientId}`);
}

// Step 2: generate the PandaDoc agreement (details must be confirmed first).
export async function generateContract(clientId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("current_step, details_confirmed, pandadoc_document_id")
    .eq("client_id", clientId)
    .single();
  if (!state) throw new Error("Onboarding not found.");
  if (state.current_step !== "contract" || !state.details_confirmed) {
    revalidatePath(`/onboarding/${clientId}`);
    return;
  }

  const { createContractDocument, ensureDocumentSent } = await import(
    "@/lib/integrations/pandadoc"
  );

  if (state.pandadoc_document_id) {
    await ensureDocumentSent(state.pandadoc_document_id);
  } else {
    const { data: client } = await supabase
      .from("clients")
      .select(
        "id, company_name, contact_name, contact_email, service_tier, custom_monthly_price, platforms",
      )
      .eq("id", clientId)
      .single();
    if (!client) throw new Error("Client not found.");

    // Custom price (or custom plan) → client-facing name is the neutral
    // "custom plan"; otherwise the band tier name + band price.
    const { getTier, tierName, CUSTOM_PLAN_NAME, channelsLabel } = await import(
      "@/lib/tiers"
    );
    const tier = getTier(client.service_tier);
    const price = client.custom_monthly_price ?? tier?.monthlyPrice;
    const name = client.custom_monthly_price
      ? CUSTOM_PLAN_NAME
      : tier
        ? tierName(tier)
        : null;
    if (!name || !price) {
      throw new Error("Client has no valid plan/price configured.");
    }

    const documentId = await createContractDocument(client, {
      name,
      price,
      channels: channelsLabel(client.platforms),
    });
    const { error } = await supabase
      .from("onboarding_state")
      .update({ pandadoc_document_id: documentId })
      .eq("client_id", clientId);
    if (error) throw new Error(error.message);

    await logActivity({
      clientId,
      eventType: "contract_generated",
      actor: "client",
      payload: { pandadoc_document_id: documentId },
    });
  }
  revalidatePath(`/onboarding/${clientId}`);
}

// "I've signed" fallback: verify with PandaDoc and advance if completed.
export async function confirmContractSigned(clientId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("current_step, pandadoc_document_id")
    .eq("client_id", clientId)
    .single();
  if (state?.current_step === "contract" && state.pandadoc_document_id) {
    const { getDocumentStatus, markContractSigned } = await import(
      "@/lib/integrations/pandadoc"
    );
    const status = await getDocumentStatus(state.pandadoc_document_id);
    if (status === "document.completed") {
      await markContractSigned(clientId, "contract-return");
    }
  }
  revalidatePath(`/onboarding/${clientId}`);
}

// Step 3: Stripe Checkout. Completion recorded by webhook / checkout-return.
export async function startCheckout(clientId: string): Promise<void> {
  const state = await getState(clientId);
  if (!state) throw new Error("Onboarding not found.");
  if (state.current_step !== "payment") {
    revalidatePath(`/onboarding/${clientId}`);
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, contact_email, service_tier, custom_monthly_price")
    .eq("id", clientId)
    .single();
  if (!client) throw new Error("Client not found.");

  const { createCheckoutSessionForClient } = await import(
    "@/lib/integrations/stripe"
  );
  const checkoutUrl = await createCheckoutSessionForClient(client);

  await logActivity({ clientId, eventType: "checkout_started", actor: "client" });
  redirect(checkoutUrl);
}

// Step 4: Slack — record the invite email, provision what automation allows,
// and always advance (failures become ops tasks, never client-facing walls).
export async function submitSlackEmail(
  clientId: string,
  formData: FormData,
): Promise<void> {
  const state = await getState(clientId);
  if (!state) throw new Error("Onboarding not found.");
  if (state.current_step !== "slack") {
    revalidatePath(`/onboarding/${clientId}`);
    return;
  }

  const slackEmail = String(formData.get("slack_email") ?? "").trim();
  if (!slackEmail) throw new Error("An email for the Slack invite is required.");

  const supabase = createSupabaseAdminClient();
  const { data: client } = await supabase
    .from("clients")
    .select("company_name")
    .eq("id", clientId)
    .single();

  let slackStatus: "not_created" | "invited" = "not_created";
  const { isSlackConfigured, createClientChannel, tryInviteByEmail, postMessage } =
    await import("@/lib/integrations/slack");

  if (isSlackConfigured() && client) {
    try {
      const channelId = await createClientChannel(client.company_name);
      const invite = await tryInviteByEmail(channelId, slackEmail);
      if (invite === "invited") {
        slackStatus = "invited";
        await logActivity({
          clientId,
          eventType: "slack_channel_created",
          actor: "system:slack",
          payload: { channel_id: channelId, invited: slackEmail },
        });
      } else {
        await postMessage(
          channelId,
          `New client channel for ${client.company_name}. Manual guest invite needed for: ${slackEmail}`,
        );
        await logActivity({
          clientId,
          eventType: "slack_manual_invite_needed",
          actor: "system:slack",
          payload: { channel_id: channelId, email: slackEmail },
        });
      }
    } catch (e) {
      console.error("Slack provisioning failed (continuing):", e);
      await logActivity({
        clientId,
        eventType: "slack_provisioning_failed",
        actor: "system:slack",
        payload: { email: slackEmail },
      });
    }
  } else {
    await logActivity({
      clientId,
      eventType: "slack_invite_requested",
      actor: "client",
      payload: { email: slackEmail, note: "Slack not configured — provision manually" },
    });
  }

  const { error } = await supabase
    .from("onboarding_state")
    .update({
      slack_invite_email: slackEmail,
      slack_status: slackStatus,
      current_step: "questionnaire",
    })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath(`/onboarding/${clientId}`);
}

// Step 5: the real onboarding questionnaire (post-payment).
export async function submitQuestionnaire(
  clientId: string,
  formData: FormData,
): Promise<void> {
  const state = await getState(clientId);
  if (!state) throw new Error("Onboarding not found.");
  if (state.current_step !== "questionnaire") {
    revalidatePath(`/onboarding/${clientId}`);
    return;
  }

  // Accept "drive.google.com/..." and normalise to a full URL.
  let driveLink = String(formData.get("drive_link") ?? "").trim();
  if (driveLink && !/^https?:\/\//i.test(driveLink)) {
    driveLink = "https://" + driveLink;
  }

  const questionnaire = {
    monthly_budget: String(formData.get("monthly_budget") ?? "").trim(),
    cpl_cpa_target: String(formData.get("cpl_cpa_target") ?? "").trim(),
    roas_target: String(formData.get("roas_target") ?? "").trim(),
    channels: formData.getAll("channels").map(String),
    target_locations: String(formData.get("target_locations") ?? "").trim(),
    business_focus: String(formData.get("business_focus") ?? "").trim(),
    priority_keywords: String(formData.get("priority_keywords") ?? "").trim(),
    avoid_keywords: String(formData.get("avoid_keywords") ?? "").trim(),
    usps: String(formData.get("usps") ?? "").trim(),
    valuable_actions: String(formData.get("valuable_actions") ?? "").trim(),
    ad_schedule: String(formData.get("ad_schedule") ?? "").trim(),
    demographics: String(formData.get("demographics") ?? "").trim(),
    competitors: String(formData.get("competitors") ?? "").trim(),
    drive_link: driveLink,
  };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("onboarding_state")
    .update({ questionnaire_data: questionnaire, current_step: "complete" })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  await logActivity({
    clientId,
    eventType: "questionnaire_submitted",
    actor: "client",
  });
  revalidatePath(`/onboarding/${clientId}`);
  revalidatePath(`/clients/${clientId}`);
}

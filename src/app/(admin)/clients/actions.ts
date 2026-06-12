"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAgencyAdmin } from "@/lib/auth/guard";
import { logActivity } from "@/lib/activity";
import { getTier, CUSTOM_TIER_KEY } from "@/lib/tiers";

// Create a client record + its onboarding state, then jump to the client page
// (where the shareable onboarding link lives). Admin-only.
export async function createClient(formData: FormData): Promise<void> {
  const { email: adminEmail } = await requireAgencyAdmin();

  const companyName = String(formData.get("company_name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const serviceTier = String(formData.get("service_tier") ?? "").trim();
  const customPriceRaw = String(formData.get("custom_monthly_price") ?? "").trim();

  const isCustomPlan = serviceTier === CUSTOM_TIER_KEY;
  if (!companyName || !contactEmail || (!getTier(serviceTier) && !isCustomPlan)) {
    throw new Error("Company name, contact email, and a valid tier are required.");
  }

  // Negotiated price (whole units): required for the custom plan, optional
  // override for band tiers.
  let customPrice: number | null = null;
  if (customPriceRaw) {
    customPrice = Math.round(Number(customPriceRaw));
    if (!Number.isFinite(customPrice) || customPrice <= 0) {
      throw new Error("Custom monthly price must be a positive number.");
    }
  }
  if (isCustomPlan && !customPrice) {
    throw new Error("The custom plan requires a custom monthly price.");
  }

  const platforms = formData.getAll("platforms").map(String);
  if (platforms.length === 0) {
    throw new Error("Select at least one advertising platform.");
  }

  const supabase = createSupabaseAdminClient();

  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      company_name: companyName,
      contact_name: contactName || null,
      contact_email: contactEmail,
      service_tier: serviceTier,
      custom_monthly_price: customPrice,
      platforms,
      status: "onboarding",
    })
    .select("id")
    .single();

  if (error || !client) {
    throw new Error(error?.message ?? "Failed to create client.");
  }

  // Wizard starts at the contract step (a details-confirmation gate shows
  // first); the onboarding questionnaire comes after payment + Slack.
  const { error: stateError } = await supabase
    .from("onboarding_state")
    .insert({ client_id: client.id, current_step: "contract" });
  if (stateError) {
    throw new Error(stateError.message);
  }

  await logActivity({
    clientId: client.id,
    eventType: "client_created",
    actor: `admin:${adminEmail}`,
    payload: {
      company_name: companyName,
      service_tier: serviceTier,
      custom_monthly_price: customPrice,
    },
  });

  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

// Approve a client's submitted Google Ads customer ID and send the link
// invitation from the PPC Mastery MCC. Admin-only — this is the human-approval
// gate declared in the Google application. Failures are written to the
// activity log (the client page surfaces the latest one) instead of crashing.
export async function approveGoogleAdsLink(clientId: string): Promise<void> {
  const { email: adminEmail } = await requireAgencyAdmin();

  const supabase = createSupabaseAdminClient();
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("ad_link_status, google_ads_customer_id")
    .eq("client_id", clientId)
    .single();
  if (!state) throw new Error("Onboarding state not found.");
  if (state.ad_link_status !== "requested" || !state.google_ads_customer_id) {
    revalidatePath(`/clients/${clientId}`);
    return;
  }

  const { sendLinkInvitation, GoogleAdsError } = await import(
    "@/lib/integrations/google-ads"
  );

  try {
    const resourceName = await sendLinkInvitation(state.google_ads_customer_id);

    const { error } = await supabase
      .from("onboarding_state")
      .update({ ad_link_status: "invited", google_ads_link_resource: resourceName })
      .eq("client_id", clientId);
    if (error) throw new Error(error.message);

    await logActivity({
      clientId,
      eventType: "ad_link_invited",
      actor: `admin:${adminEmail}`,
      payload: {
        customer_id: state.google_ads_customer_id,
        link_resource: resourceName,
      },
    });
  } catch (e) {
    const friendly =
      e instanceof GoogleAdsError && e.isInvalidCustomer
        ? "This ID doesn't appear to exist or isn't reachable from the MCC — check it with the client."
        : e instanceof Error
          ? e.message
          : "Unknown error sending the invitation.";
    await logActivity({
      clientId,
      eventType: "ad_link_invite_failed",
      actor: `admin:${adminEmail}`,
      payload: { customer_id: state.google_ads_customer_id, message: friendly },
    });
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/onboarding/${clientId}`);
}

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

  const accessTasks = formData
    .getAll("access_tasks")
    .map(String)
    .filter((k) => ["ga4", "gtm", "gsc"].includes(k));

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
      access_tasks: accessTasks,
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

    // Ping the client's Slack channel (non-fatal — channel may not exist yet).
    try {
      const { data: client } = await supabase
        .from("clients")
        .select("company_name")
        .eq("id", clientId)
        .single();
      if (client && process.env.SLACK_BOT_TOKEN) {
        const { postMessage, channelNameFor } = await import(
          "@/lib/integrations/slack"
        );
        await postMessage(
          `#${channelNameFor(client.company_name)}`,
          `📊 We've sent the Google Ads management request for account ${state.google_ads_customer_id} — one last step: approve it in Google Ads (Admin → Access and security → Managers): https://ads.google.com`,
        );
      }
    } catch (slackErr) {
      console.error("Slack ping on ad-link send failed (non-fatal):", slackErr);
    }
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

// Re-check the MCC->client link status with Google and advance our state.
// No webhooks exist for link status — v1 is this manual refresh (a daily cron
// joins in chunk 4). Transitions are logged; the client's card flips to
// "connected" only on ACTIVE.
export async function refreshGoogleAdsLinkStatus(clientId: string): Promise<void> {
  const { email: adminEmail } = await requireAgencyAdmin();

  const supabase = createSupabaseAdminClient();
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("ad_link_status, google_ads_customer_id")
    .eq("client_id", clientId)
    .single();
  if (!state?.google_ads_customer_id || state.ad_link_status !== "invited") {
    revalidatePath(`/clients/${clientId}`);
    return;
  }

  const { getLinkStatus, portalStatusFor, resolveReportingCustomerId } =
    await import("@/lib/integrations/google-ads");
  const googleStatus = await getLinkStatus(state.google_ads_customer_id);
  const next = portalStatusFor(googleStatus);

  if (next) {
    const update: Record<string, unknown> = { ad_link_status: next };
    // On activation, resolve the leaf account to report on (the linked id may
    // be a manager/MCC with no campaigns of its own).
    let reporting: Awaited<ReturnType<typeof resolveReportingCustomerId>> | null = null;
    if (next === "approved") {
      try {
        reporting = await resolveReportingCustomerId(state.google_ads_customer_id);
        if (reporting.reportingId) {
          update.google_ads_reporting_customer_id = reporting.reportingId;
        }
      } catch (e) {
        console.error("Reporting-account resolution failed:", e);
      }
    }

    const { error } = await supabase
      .from("onboarding_state")
      .update(update)
      .eq("client_id", clientId);
    if (error) throw new Error(error.message);

    await logActivity({
      clientId,
      eventType: `ad_link_${next}`,
      actor: `admin:${adminEmail}`,
      payload: {
        customer_id: state.google_ads_customer_id,
        google_status: googleStatus,
        reporting_customer_id: reporting?.reportingId ?? null,
        accounts_found: reporting?.leaves.length ?? null,
        needs_account_selection: reporting?.multi ?? false,
      },
    });
  } else {
    await logActivity({
      clientId,
      eventType: "ad_link_status_checked",
      actor: `admin:${adminEmail}`,
      payload: {
        customer_id: state.google_ads_customer_id,
        google_status: googleStatus ?? "no link found",
        result: "still pending",
      },
    });
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/onboarding/${clientId}`);
}

// Permanently delete a client and everything keyed to it (onboarding_state,
// activity_log, ads_report_cache, weekly_reports all cascade on delete). Admin
// only. Does NOT cancel any Stripe subscription — that's a separate action.
export async function deleteClient(clientId: string): Promise<void> {
  await requireAgencyAdmin();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("clients").delete().eq("id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  redirect("/clients");
}

// Add a reporting-only client: an existing client whose Google Ads account
// already sits under our MCC (e.g. moved from the BJ PPC main MCC into the PPC
// Mastery sub-MCC). No wizard, no contract, no payment — we verify we can reach
// the account, resolve the reporting leaf, and stand up the dashboard.
export async function addReportingClient(formData: FormData): Promise<void> {
  const { email: adminEmail } = await requireAgencyAdmin();

  const companyName = String(formData.get("company_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").replace(/\D/g, "");
  if (!companyName || !contactEmail) {
    throw new Error("Company name and a contact email are required.");
  }
  if (customerId.length !== 10) {
    throw new Error("Enter a valid 10-digit Google Ads ID (the account or its MCC).");
  }

  // Verify we actually manage this account and find the leaf to report on.
  const { resolveReportingCustomerId } = await import("@/lib/integrations/google-ads");
  let reportingId: string | null;
  try {
    const resolved = await resolveReportingCustomerId(customerId);
    if (resolved.multi) {
      throw new Error(
        "This manager has multiple accounts — single-account add only for now (multi-select coming).",
      );
    }
    reportingId = resolved.reportingId;
  } catch (e) {
    if (e instanceof Error && e.message.includes("multiple accounts")) throw e;
    throw new Error(
      "Couldn't reach that account from our MCC — is it linked/moved under our MCC yet?",
    );
  }
  if (!reportingId) {
    throw new Error("No reportable ad account found under that ID.");
  }

  const supabase = createSupabaseAdminClient();

  // Don't create a duplicate if this account (or its leaf) is already a client.
  const { data: dupes } = await supabase
    .from("onboarding_state")
    .select("google_ads_customer_id, google_ads_reporting_customer_id");
  const taken = new Set(
    (dupes ?? []).flatMap((r) =>
      [r.google_ads_customer_id, r.google_ads_reporting_customer_id].filter(Boolean),
    ) as string[],
  );
  if (taken.has(customerId) || taken.has(reportingId)) {
    throw new Error("That account is already a client.");
  }

  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      company_name: companyName,
      contact_email: contactEmail,
      status: "active",
      source: "reporting_only",
    })
    .select("id")
    .single();
  if (error || !client) throw new Error(error?.message ?? "Failed to create client.");

  const { error: stateErr } = await supabase.from("onboarding_state").insert({
    client_id: client.id,
    current_step: "complete",
    ad_link_status: "approved",
    google_ads_customer_id: customerId,
    google_ads_reporting_customer_id: reportingId,
  });
  if (stateErr) throw new Error(stateErr.message);

  await logActivity({
    clientId: client.id,
    eventType: "reporting_client_added",
    actor: `admin:${adminEmail}`,
    payload: { customer_id: customerId, reporting_customer_id: reportingId },
  });

  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

// Bulk-import managed accounts: the admin ticks accounts already sitting under
// our MCC (enumerated by listManagedAccounts) and we stand them all up as
// reporting-only clients in one pass. Leaves are reachable by definition, so no
// per-account verify; already-imported accounts are skipped. Built for the MCC
// Command Center clone (BJ main MCC, ~129 accounts).
export async function addReportingClientsBulk(formData: FormData): Promise<void> {
  const { email: adminEmail } = await requireAgencyAdmin();

  const selectedIds = new Set(formData.getAll("account_ids").map(String));
  if (selectedIds.size === 0) {
    throw new Error("Select at least one account to import.");
  }

  const { listManagedAccounts } = await import("@/lib/integrations/google-ads");
  const leaves = await listManagedAccounts();
  const supabase = createSupabaseAdminClient();

  // Skip accounts already imported (dedupe by Google Ads customer id).
  const { data: existing } = await supabase
    .from("onboarding_state")
    .select("google_ads_customer_id");
  const have = new Set(
    (existing ?? []).map((r) => r.google_ads_customer_id).filter(Boolean) as string[],
  );

  const toAdd = leaves.filter((l) => selectedIds.has(l.id) && !have.has(l.id));
  if (toAdd.length === 0) {
    revalidatePath("/clients");
    redirect("/clients");
  }

  // Batch insert clients, then their onboarding state (RETURNING preserves the
  // input order, so we can zip the new ids back to the leaves).
  const { data: created, error } = await supabase
    .from("clients")
    .insert(
      toAdd.map((l) => ({
        company_name: l.name || `Account ${l.id}`,
        contact_email: adminEmail,
        status: "active",
        source: "reporting_only",
      })),
    )
    .select("id");
  if (error || !created) throw new Error(error?.message ?? "Failed to create clients.");

  const { error: stateErr } = await supabase.from("onboarding_state").insert(
    created.map((c, i) => ({
      client_id: c.id,
      current_step: "complete",
      ad_link_status: "approved",
      google_ads_customer_id: toAdd[i].id,
      google_ads_reporting_customer_id: toAdd[i].id,
    })),
  );
  if (stateErr) throw new Error(stateErr.message);

  await logActivity({
    clientId: created[0].id,
    eventType: "reporting_clients_bulk_added",
    actor: `admin:${adminEmail}`,
    payload: { count: toAdd.length, customer_ids: toAdd.map((l) => l.id) },
  });

  revalidatePath("/clients");
  redirect("/clients");
}

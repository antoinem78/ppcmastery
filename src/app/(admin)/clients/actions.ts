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

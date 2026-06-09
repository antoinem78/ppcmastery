"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAgencyAdmin } from "@/lib/auth/guard";
import { logActivity } from "@/lib/activity";
import { getTier } from "@/lib/tiers";

// Create a client record + its onboarding state, then jump to the client page
// (where the shareable onboarding link lives). Admin-only.
export async function createClient(formData: FormData): Promise<void> {
  const { email: adminEmail } = await requireAgencyAdmin();

  const companyName = String(formData.get("company_name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const serviceTier = String(formData.get("service_tier") ?? "").trim();

  if (!companyName || !contactEmail || !getTier(serviceTier)) {
    throw new Error("Company name, contact email, and a valid tier are required.");
  }

  const supabase = createSupabaseAdminClient();

  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      company_name: companyName,
      contact_name: contactName || null,
      contact_email: contactEmail,
      service_tier: serviceTier,
      status: "onboarding",
    })
    .select("id")
    .single();

  if (error || !client) {
    throw new Error(error?.message ?? "Failed to create client.");
  }

  const { error: stateError } = await supabase
    .from("onboarding_state")
    .insert({ client_id: client.id });
  if (stateError) {
    throw new Error(stateError.message);
  }

  await logActivity({
    clientId: client.id,
    eventType: "client_created",
    actor: `admin:${adminEmail}`,
    payload: { company_name: companyName, service_tier: serviceTier },
  });

  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

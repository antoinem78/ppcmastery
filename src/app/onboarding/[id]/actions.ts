"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

// These actions are intentionally public (access = having the link). Each one
// re-checks the current step server-side so steps can't be skipped or replayed
// out of order. clientId is bound server-side in the page, not taken from form
// input, so it can't be swapped by the client.

async function getState(clientId: string) {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("onboarding_state")
    .select("current_step")
    .eq("client_id", clientId)
    .single();
  return data;
}

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

  // Accept "spacex.com" and normalise to a full URL so the field is painless.
  let website = String(formData.get("website_url") ?? "").trim();
  if (website && !/^https?:\/\//i.test(website)) {
    website = "https://" + website;
  }

  const questionnaire = {
    website_url: website,
    industry: String(formData.get("industry") ?? "").trim(),
    monthly_budget: String(formData.get("monthly_budget") ?? "").trim(),
    primary_goal: String(formData.get("primary_goal") ?? "").trim(),
    platforms: formData.getAll("platforms").map(String),
    target_locations: String(formData.get("target_locations") ?? "").trim(),
    competitors: String(formData.get("competitors") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim(),
  };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("onboarding_state")
    .update({ questionnaire_data: questionnaire, current_step: "contract" })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  await logActivity({
    clientId,
    eventType: "questionnaire_submitted",
    actor: "client",
  });
  revalidatePath(`/onboarding/${clientId}`);
}

export async function completeContract(clientId: string): Promise<void> {
  const state = await getState(clientId);
  if (!state) throw new Error("Onboarding not found.");
  if (state.current_step !== "contract") {
    revalidatePath(`/onboarding/${clientId}`);
    return;
  }

  const supabase = createSupabaseAdminClient();
  // Stub: Phase 2 replaces this with the real PandaDoc signature event.
  const { error } = await supabase
    .from("onboarding_state")
    .update({ contract_status: "signed", current_step: "payment" })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  await logActivity({
    clientId,
    eventType: "contract_completed",
    actor: "client",
    payload: { stub: true },
  });
  revalidatePath(`/onboarding/${clientId}`);
}

export async function completePayment(clientId: string): Promise<void> {
  const state = await getState(clientId);
  if (!state) throw new Error("Onboarding not found.");
  if (state.current_step !== "payment") {
    revalidatePath(`/onboarding/${clientId}`);
    return;
  }

  const supabase = createSupabaseAdminClient();
  // Stub: Phase 2 replaces this with the real Stripe payment + webhook.
  const { error } = await supabase
    .from("onboarding_state")
    .update({ payment_status: "paid", current_step: "complete" })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  // In Phase 2 the Stripe webhook flips the client to "active". For the Phase 1
  // fake flow we do it here so the lifecycle completes end-to-end.
  await supabase.from("clients").update({ status: "active" }).eq("id", clientId);

  await logActivity({
    clientId,
    eventType: "payment_completed",
    actor: "client",
    payload: { stub: true },
  });
  await logActivity({
    clientId,
    eventType: "client_activated",
    actor: "system",
    payload: { stub: true },
  });
  revalidatePath(`/onboarding/${clientId}`);
  revalidatePath(`/clients/${clientId}`);
}

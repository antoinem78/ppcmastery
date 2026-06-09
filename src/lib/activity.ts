// Append-only activity log helper. Every meaningful client event goes through
// here so the activity_log table is the single audit trail (and the thing we read
// when an integration misbehaves later).
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function logActivity(params: {
  clientId: string;
  eventType: string;
  actor?: string; // e.g. "admin:jane@…", "client", "system:stripe-webhook"
  payload?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("activity_log").insert({
    client_id: params.clientId,
    event_type: params.eventType,
    actor: params.actor ?? "system",
    payload: params.payload ?? {},
  });
  // Logging must never break the main flow — surface but don't throw.
  if (error) console.error("logActivity failed:", error.message);
}

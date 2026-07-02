// The cross-cutting security audit for every Google Ads write attempt (P5-Lite
// and Campaign Builder publish), including boundary rejections. Writes to the
// non-client-scoped write_audit table (migration 0019). Append-only; never
// throws (an audit failure is surfaced, not allowed to break the caller — but
// the caller has already enforced the boundary regardless).
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface WriteAuditEntry {
  deployment?: string;
  mcc?: string;
  customerId?: string;
  source: "p5lite" | "publish";
  action?: string;
  phase?: "dry_run" | "apply" | "rollback" | "publish";
  mccCheck?: "passed" | "violation";
  allowlistCheck?: "allowed" | "not_listed" | "allow_all" | "skipped";
  approver?: string;
  result: "ok" | "blocked" | "failed" | "boundary_violation";
  detail?: Record<string, unknown>;
  clientId?: string | null;
}

export async function recordWriteAudit(e: WriteAuditEntry): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("write_audit").insert({
      deployment: e.deployment ?? null,
      mcc: e.mcc ?? null,
      customer_id: e.customerId ?? null,
      source: e.source,
      action: e.action ?? null,
      phase: e.phase ?? null,
      mcc_check: e.mccCheck ?? null,
      allowlist_check: e.allowlistCheck ?? null,
      approver: e.approver ?? null,
      result: e.result,
      detail: e.detail ?? {},
      client_id: e.clientId ?? null,
    });
    if (error) console.error("recordWriteAudit failed:", error.message);
  } catch (err) {
    console.error("recordWriteAudit threw:", err);
  }
}

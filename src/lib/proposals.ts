// Optimization proposals — the structured approval queue. The AI agent FILES
// proposals here (it never executes); a human approves or dismisses them. With
// P5-Lite enabled (Phase D), an approved executable proposal can then be applied
// to Google Ads through the guarded worker. Backed by the optimization_proposals
// table (migration 0015; execution columns in 0016).
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

export type ProposalStatus = "pending" | "approved" | "dismissed" | "applied" | "failed" | "rolled_back";

// The executable action shapes P5-Lite understands. Anything else is
// advisory-only (no details.action).
export type ProposalAction =
  | { kind: "add_negative_keyword"; campaign: string; text: string; matchType?: "EXACT" | "PHRASE" | "BROAD" }
  | { kind: "pause_campaign"; campaign: string }
  | { kind: "set_campaign_budget"; campaign: string; dailyBudget: number }
  // Account-level: adds one negative to a shared negative keyword list and
  // attaches that list to every enabled Search campaign (no `campaign`).
  | { kind: "add_shared_negative"; text: string; matchType?: "EXACT" | "PHRASE" | "BROAD" };

export interface Proposal {
  id: string;
  client_id: string;
  type: string;
  title: string;
  rationale: string;
  details: { action?: ProposalAction } & Record<string, unknown>;
  status: ProposalStatus;
  created_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

export interface CreateProposalInput {
  clientId: string;
  type: string;
  title: string;
  rationale: string;
  details?: Record<string, unknown>;
  createdBy?: string;
}

export async function createProposal(input: CreateProposalInput): Promise<{ id: string } | { error: string }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("optimization_proposals")
    .insert({
      client_id: input.clientId,
      type: input.type,
      title: input.title,
      rationale: input.rationale,
      details: input.details ?? {},
      status: "pending",
      created_by: input.createdBy ?? "agent",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await logActivity({
    clientId: input.clientId,
    eventType: "proposal_created",
    actor: input.createdBy ?? "agent",
    payload: { proposal_id: data.id, type: input.type, title: input.title },
  });
  return { id: data.id as string };
}

export async function listProposals(status?: ProposalStatus): Promise<Proposal[]> {
  const supabase = createSupabaseAdminClient();
  let q = supabase.from("optimization_proposals").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) {
    console.error("listProposals failed:", error.message);
    return [];
  }
  return (data ?? []) as Proposal[];
}

export async function pendingProposalCount(): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from("optimization_proposals")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) return 0; // table may not exist yet (migration 0015 not run)
  return count ?? 0;
}

// Manually mark an approved proposal as applied (for advisory proposals the team
// actioned by hand in Google Ads; executable ones flip to 'applied' via the
// P5-Lite worker on a real write).
export async function markProposalApplied(id: string, actor: string): Promise<{ ok: true } | { error: string }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("optimization_proposals")
    .update({ status: "applied", applied_by: actor, applied_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "approved")
    .select("client_id, title")
    .single();
  if (error) return { error: error.message };
  if (!data) return { error: "Only an approved proposal can be marked applied." };
  await logActivity({
    clientId: data.client_id as string,
    eventType: "proposal_marked_applied",
    actor,
    payload: { proposal_id: id, title: data.title, manual: true },
  });
  return { ok: true };
}

export async function deleteProposal(id: string, actor: string): Promise<{ ok: true } | { error: string }> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.from("optimization_proposals").select("client_id, title").eq("id", id).single();
  const { error } = await supabase.from("optimization_proposals").delete().eq("id", id);
  if (error) return { error: error.message };
  if (data) {
    await logActivity({
      clientId: data.client_id as string,
      eventType: "proposal_deleted",
      actor,
      payload: { proposal_id: id, title: data.title },
    });
  }
  return { ok: true };
}

export async function decideProposal(
  id: string,
  decision: "approved" | "dismissed",
  decidedBy: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("optimization_proposals")
    .update({ status: decision, decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending") // only pending proposals can be decided
    .select("client_id, title")
    .single();
  if (error) return { error: error.message };
  if (!data) return { error: "Proposal not found or already decided." };
  await logActivity({
    clientId: data.client_id as string,
    eventType: `proposal_${decision}`,
    actor: decidedBy,
    payload: { proposal_id: id, title: data.title },
  });
  return { ok: true };
}

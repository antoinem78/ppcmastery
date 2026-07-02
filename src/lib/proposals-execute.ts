// P5-Lite worker — the control boundary for applying an approved proposal to
// Google Ads. The UI is NOT the boundary: this re-checks the approval record and
// every guardrail itself. Flow: re-check approval -> resolve names to IDs ->
// validate_only -> mutate -> re-query to verify -> immutable audit (activity_log
// + execution before/after) -> Slack alert -> rollback available. One op per
// approval; no batch; no autonomous writes. Inert until the env guardrails are set.
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { entityConfig } from "@/lib/config";
import { logActivity } from "@/lib/activity";
import { gaqlSearch, googleAdsMutate } from "@/lib/integrations/google-ads";
import {
  parseAction, guardAction, assertMccBoundary, accountAllowed, allowAllMccAccounts,
  negativeKeywordCreateOp, criterionRemoveOp, campaignStatusOp, budgetAmountOp,
  sharedSetCreateOp, sharedCriterionCreateOp, campaignSharedSetCreateOp, sharedCriterionRemoveOp,
} from "@/lib/integrations/google-ads/write";
import type { ProposalAction } from "@/lib/proposals";

// Stable name for the account's managed shared negative list (reused across
// add_shared_negative applies). No em/en dashes.
const SHARED_SET_NAME = `${entityConfig.brandName || "Managed"} shared negatives`;
// Google stores keyword text without match-type punctuation.
const cleanKeyword = (t: string) => t.replace(/^[[\]"\s]+|[[\]"\s]+$/g, "").trim();

export type ExecResult = { ok: true; message: string } | { error: string };

const DEPLOYMENT = process.env.APP_BASE_URL ?? "unknown";

// Re-query the mutated resource to confirm the change actually landed (canon:
// validate -> mutate -> VERIFY-AFTER -> audit). Returns a structured result that
// goes into the immutable audit; never throws (a verify failure is recorded, not
// swallowed as success).
async function verifyAfter(
  action: ProposalAction,
  customerId: string,
  before: Record<string, unknown>,
  resourceName: string | null,
): Promise<{ verified: boolean; detail: string; observed?: unknown }> {
  try {
    if (action.kind === "add_negative_keyword") {
      if (!resourceName) return { verified: false, detail: "No criterion resource name returned by the mutate." };
      const rows = await gaqlSearch(
        customerId,
        `SELECT campaign_criterion.resource_name FROM campaign_criterion WHERE campaign_criterion.resource_name = '${resourceName}'`,
      );
      return { verified: rows.length > 0, detail: rows.length > 0 ? "Negative keyword present after write." : "Negative keyword not found after write.", observed: resourceName };
    }
    if (action.kind === "add_shared_negative") {
      if (!resourceName) return { verified: false, detail: "No shared criterion resource name returned by the mutate." };
      const rows = await gaqlSearch(
        customerId,
        `SELECT shared_criterion.resource_name FROM shared_criterion WHERE shared_criterion.resource_name = '${resourceName}'`,
      );
      const linked = Number(before.linkedCount ?? 0);
      return { verified: rows.length > 0, detail: rows.length > 0 ? `Shared negative present after write; list attached to ${linked} Search campaign(s).` : "Shared negative not found after write.", observed: resourceName };
    }
    if (action.kind === "pause_campaign") {
      const cr = String(before.campaignResource ?? "");
      const rows = await gaqlSearch(customerId, `SELECT campaign.status FROM campaign WHERE campaign.resource_name = '${cr}'`);
      const status = ((rows[0]?.campaign ?? {}) as { status?: string }).status ?? "";
      return { verified: status === "PAUSED", detail: `Campaign status after write: ${status || "unknown"}.`, observed: status };
    }
    // set_campaign_budget
    const br = String(before.budgetResource ?? "");
    const want = Math.round((action.dailyBudget ?? 0) * 1_000_000);
    const rows = await gaqlSearch(customerId, `SELECT campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.resource_name = '${br}'`);
    const got = Number(((rows[0]?.campaignBudget ?? {}) as { amountMicros?: string | number }).amountMicros ?? 0);
    return { verified: got === want, detail: `Budget after write: ${got} micros (expected ${want}).`, observed: got };
  } catch (e) {
    return { verified: false, detail: `Verify-after query failed: ${e instanceof Error ? e.message : "unknown"}.` };
  }
}

interface ResolvedCampaign {
  campaignId: string;
  campaignResource: string;
  status: string;
  budgetResource: string | null;
  budgetAmountMicros: number;
}

async function resolveCampaign(customerId: string, name: string): Promise<ResolvedCampaign | null> {
  const rows = await gaqlSearch(
    customerId,
    `SELECT campaign.id, campaign.resource_name, campaign.status, campaign.name,
            campaign_budget.resource_name, campaign_budget.amount_micros
     FROM campaign WHERE campaign.name = '${name.replace(/'/g, "\\'")}' LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return null;
  const c = (r.campaign ?? {}) as { id?: string | number; resourceName?: string; status?: string };
  const b = (r.campaignBudget ?? {}) as { resourceName?: string; amountMicros?: string | number };
  return {
    campaignId: String(c.id ?? ""),
    campaignResource: c.resourceName ?? "",
    status: c.status ?? "",
    budgetResource: b.resourceName ?? null,
    budgetAmountMicros: Number(b.amountMicros ?? 0),
  };
}

interface LoadedProposal {
  id: string;
  clientId: string;
  customerId: string;
  status: string;
  action: ProposalAction;
  execution: Record<string, unknown>;
}

async function loadProposal(id: string): Promise<LoadedProposal | { error: string }> {
  const supabase = createSupabaseAdminClient();
  const { data: p } = await supabase.from("optimization_proposals").select("*").eq("id", id).single();
  if (!p) return { error: "Proposal not found." };
  const action = parseAction(p.details);
  if (!action) return { error: "This proposal has no executable action." };

  const { data: st } = await supabase
    .from("onboarding_state")
    .select("google_ads_customer_id, google_ads_reporting_customer_id, ad_link_status")
    .eq("client_id", p.client_id)
    .single();
  if (!st || st.ad_link_status !== "approved" || !st.google_ads_customer_id) {
    return { error: "The client's Google Ads link is not approved." };
  }
  const customerId = (st.google_ads_reporting_customer_id as string | null) ?? (st.google_ads_customer_id as string);
  return { id: p.id as string, clientId: p.client_id as string, customerId, status: p.status as string, action, execution: (p.execution ?? {}) as Record<string, unknown> };
}

interface Forward {
  ops: Record<string, unknown>[]; // one atomic mutate (temp resource names allowed)
  before: Record<string, unknown>;
  campaignId?: string;
  currentBudgetMicros?: number;
}

// Resolve/create the account's managed shared negative set and the set of
// enabled+paused Search campaigns not yet attached to it.
async function resolveSharedSet(customerId: string): Promise<
  { setResource: string | null; searchCampaigns: string[]; unlinked: string[] } | { error: string }
> {
  const sets = await gaqlSearch(
    customerId,
    `SELECT shared_set.resource_name, shared_set.name, shared_set.type, shared_set.status
     FROM shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'`,
  );
  const existing = sets
    .map((r) => (r.sharedSet ?? {}) as { resourceName?: string; name?: string })
    .find((s) => s.name === SHARED_SET_NAME);
  const setResource = existing?.resourceName ?? null;

  const camps = await gaqlSearch(
    customerId,
    `SELECT campaign.resource_name FROM campaign
     WHERE campaign.advertising_channel_type = 'SEARCH' AND campaign.status != 'REMOVED'`,
  );
  const searchCampaigns = camps
    .map((r) => ((r.campaign ?? {}) as { resourceName?: string }).resourceName ?? "")
    .filter(Boolean);
  if (searchCampaigns.length === 0) return { error: "This account has no Search campaigns to attach a shared negative list to." };

  let linked = new Set<string>();
  if (setResource) {
    const links = await gaqlSearch(
      customerId,
      `SELECT campaign_shared_set.campaign, campaign_shared_set.shared_set
       FROM campaign_shared_set WHERE campaign_shared_set.shared_set = '${setResource}'`,
    );
    linked = new Set(
      links.map((r) => ((r.campaignSharedSet ?? {}) as { campaign?: string }).campaign ?? "").filter(Boolean),
    );
  }
  const unlinked = searchCampaigns.filter((c) => !linked.has(c));
  return { setResource, searchCampaigns, unlinked };
}

// Build the forward op(s) + the before-state needed for verify/rollback.
async function buildForward(action: ProposalAction, customerId: string): Promise<Forward | { error: string }> {
  if (action.kind === "add_negative_keyword") {
    const c = await resolveCampaign(customerId, action.campaign);
    if (!c) return { error: `Campaign "${action.campaign}" not found.` };
    return { ops: [negativeKeywordCreateOp(customerId, c.campaignResource, action.text, action.matchType ?? "BROAD")], before: { campaignResource: c.campaignResource }, campaignId: c.campaignId };
  }
  if (action.kind === "pause_campaign") {
    const c = await resolveCampaign(customerId, action.campaign);
    if (!c) return { error: `Campaign "${action.campaign}" not found.` };
    return { ops: [campaignStatusOp(c.campaignResource, "PAUSED")], before: { campaignResource: c.campaignResource, status: c.status }, campaignId: c.campaignId };
  }
  if (action.kind === "add_shared_negative") {
    const text = cleanKeyword(action.text);
    if (!text) return { error: "The negative keyword text is empty." };
    const r = await resolveSharedSet(customerId);
    if ("error" in r) return r;

    const onlyDigits = customerId.replace(/\D/g, "");
    const ops: Record<string, unknown>[] = [];
    let setRef = r.setResource;
    if (!setRef) {
      setRef = `customers/${onlyDigits}/sharedSets/-1`; // temp resource, created in this mutate
      ops.push(sharedSetCreateOp(setRef, SHARED_SET_NAME));
    }
    ops.push(sharedCriterionCreateOp(setRef, text, action.matchType ?? "EXACT"));
    for (const camp of r.unlinked) ops.push(campaignSharedSetCreateOp(camp, setRef));

    return {
      ops,
      before: {
        setResource: r.setResource, // null when newly created (nothing to roll back on the set)
        setExisted: r.setResource != null,
        linkedCount: r.searchCampaigns.length,
        newLinks: r.unlinked.length,
      },
    };
  }
  // set_campaign_budget
  const c = await resolveCampaign(customerId, action.campaign);
  if (!c) return { error: `Campaign "${action.campaign}" not found.` };
  if (!c.budgetResource) return { error: "Campaign has no resolvable budget." };
  return {
    ops: [budgetAmountOp(c.budgetResource, Math.round(action.dailyBudget * 1_000_000))],
    before: { campaignResource: c.campaignResource, budgetResource: c.budgetResource, amountMicros: c.budgetAmountMicros },
    campaignId: c.campaignId,
    currentBudgetMicros: c.budgetAmountMicros,
  };
}

// Pull the resource name of the created criterion out of a multi-op mutate
// response (shared vs campaign criterion depending on the action).
function extractResourceName(results: Record<string, unknown>[], action: ProposalAction): string | null {
  const key = action.kind === "add_shared_negative" ? "sharedCriterionResult" : "campaignCriterionResult";
  for (const r of results) {
    const hit = (r[key] as { resourceName?: string } | undefined)?.resourceName;
    if (hit) return hit;
  }
  // Fallback: first result carrying a resourceName.
  return results.map((r) => Object.values(r)[0] as { resourceName?: string } | undefined).find((x) => x?.resourceName)?.resourceName ?? null;
}

async function alertSlack(text: string): Promise<void> {
  const channel = process.env.SLACK_OPS_CHANNEL || process.env.SLACK_REVIEW_CHANNEL;
  if (!process.env.SLACK_BOT_TOKEN || !channel) return;
  try {
    const { postMessage } = await import("@/lib/integrations/slack");
    await postMessage(channel, text);
  } catch (e) {
    console.error("P5-Lite Slack alert failed:", e);
  }
}

export async function dryRunProposal(id: string): Promise<ExecResult> {
  const loaded = await loadProposal(id);
  if ("error" in loaded) return loaded;
  if (loaded.status !== "approved") return { error: "Only approved proposals can be dry-run." };

  // Hard boundary first — even a dry-run must not touch an account outside the MCC.
  const boundary = await assertMccBoundary(loaded.customerId);
  if (!boundary.ok) {
    await logActivity({ clientId: loaded.clientId, eventType: "proposal_boundary_violation", actor: "system:dry-run", payload: { proposal_id: id, ...boundary, phase: "dry_run" } });
    return { error: boundary.reason ?? "Account is not under this deployment's MCC." };
  }

  const fwd = await buildForward(loaded.action, loaded.customerId);
  if ("error" in fwd) return fwd;
  // Dry-run skips the account/campaign allowlist so a real account can be
  // validated BEFORE it's added to the allowlist (kill switch + caps still apply).
  const blocked = guardAction(loaded.action, { customerId: loaded.customerId, campaignId: fwd.campaignId, currentBudgetMicros: fwd.currentBudgetMicros }, { skipAllowlist: true });
  if (blocked) return { error: blocked };
  try {
    await googleAdsMutate(loaded.customerId, fwd.ops, true); // validateOnly
    return { ok: true, message: `Validation passed (account ${boundary.customerId} confirmed under MCC ${boundary.mcc}). Google accepts this change; nothing was written.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Validation failed." };
  }
}

export async function applyProposal(id: string, actor: string): Promise<ExecResult> {
  const loaded = await loadProposal(id);
  if ("error" in loaded) return loaded;
  if (loaded.status !== "approved") return { error: "Only an approved proposal can be applied." };

  const supabase = createSupabaseAdminClient();

  // 1. Hard boundary: MCC membership. A violation is audit-logged and refused.
  const boundary = await assertMccBoundary(loaded.customerId);
  if (!boundary.ok) {
    await logActivity({ clientId: loaded.clientId, eventType: "proposal_boundary_violation", actor, payload: { proposal_id: id, ...boundary, phase: "apply" } });
    await alertSlack(`⛔ P5-Lite BOUNDARY VIOLATION: ${loaded.action.kind} on ${boundary.customerId} rejected (not under MCC ${boundary.mcc}; proposal ${id}, by ${actor}).`);
    return { error: boundary.reason ?? "Account is not under this deployment's MCC." };
  }

  const fwd = await buildForward(loaded.action, loaded.customerId);
  if ("error" in fwd) return fwd;

  // 2. Operational gates (kill switch, account + campaign allowlist, budget caps).
  const allowlistOk = accountAllowed(loaded.customerId);
  const blocked = guardAction(loaded.action, { customerId: loaded.customerId, campaignId: fwd.campaignId, currentBudgetMicros: fwd.currentBudgetMicros });
  if (blocked) return { error: blocked };

  // Scope block recorded on every audit entry for this write.
  const scope = {
    deployment: DEPLOYMENT,
    mcc: boundary.mcc,
    customerId: boundary.customerId,
    mccCheck: "passed",
    allowlistCheck: allowAllMccAccounts() ? "allow_all" : allowlistOk ? "allowed" : "not_listed",
    approver: actor,
    campaignId: fwd.campaignId ?? null,
  };

  try {
    const validate = await googleAdsMutate(loaded.customerId, fwd.ops, true); // validate first
    const res = await googleAdsMutate(loaded.customerId, fwd.ops, false); // real write
    const results = (res as { results?: Record<string, unknown>[] }).results ?? [];
    const resourceName = extractResourceName(results, loaded.action);

    // 3. Verify-after: re-query to confirm the change landed.
    const verify = await verifyAfter(loaded.action, loaded.customerId, fwd.before, resourceName);

    const execution = {
      action: loaded.action,
      scope,
      before: fwd.before,
      resourceName,
      validateOnly: { ok: true },
      mutate: { resourceName },
      verifyAfter: verify,
      applied_at: new Date().toISOString(),
    };
    void validate;
    await supabase.from("optimization_proposals").update({ status: "applied", applied_by: actor, applied_at: new Date().toISOString(), execution }).eq("id", id);
    await logActivity({ clientId: loaded.clientId, eventType: "proposal_applied", actor, payload: { proposal_id: id, action: loaded.action, resourceName, scope, verifyAfter: verify } });
    const verifyNote = verify.verified ? "verified" : `NOT verified (${verify.detail})`;
    await alertSlack(`✅ P5-Lite APPLIED: ${loaded.action.kind} on ${boundary.customerId} under MCC ${boundary.mcc} (proposal ${id}, by ${actor}) — ${verifyNote}.`);
    return { ok: true, message: `Applied to Google Ads (${verifyNote}). Rollback is available.` };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Apply failed.";
    await supabase.from("optimization_proposals").update({ status: "failed", execution: { action: loaded.action, scope, error: message } }).eq("id", id);
    await logActivity({ clientId: loaded.clientId, eventType: "proposal_failed", actor, payload: { proposal_id: id, error: message, scope } });
    await alertSlack(`⚠️ P5-Lite FAILED: ${loaded.action.kind} on ${boundary.customerId} (proposal ${id}): ${message}`);
    return { error: message };
  }
}

export async function rollbackProposal(id: string, actor: string): Promise<ExecResult> {
  const loaded = await loadProposal(id);
  if ("error" in loaded) return loaded;
  if (loaded.status !== "applied") return { error: "Only an applied proposal can be rolled back." };

  // Rollback is itself a write — same hard MCC boundary.
  const boundary = await assertMccBoundary(loaded.customerId);
  if (!boundary.ok) {
    await logActivity({ clientId: loaded.clientId, eventType: "proposal_boundary_violation", actor, payload: { proposal_id: id, ...boundary, phase: "rollback" } });
    return { error: boundary.reason ?? "Account is not under this deployment's MCC." };
  }

  const exec = loaded.execution as { before?: Record<string, unknown>; resourceName?: string | null };
  const before = exec.before ?? {};
  let op: Record<string, unknown> | null = null;
  if (loaded.action.kind === "add_negative_keyword") {
    if (!exec.resourceName) return { error: "No criterion resource name recorded; cannot roll back automatically." };
    op = criterionRemoveOp(exec.resourceName);
  } else if (loaded.action.kind === "add_shared_negative") {
    // Remove only the keyword we added; leave the shared set and its campaign
    // links in place (they may carry other negatives).
    if (!exec.resourceName) return { error: "No shared criterion resource name recorded; cannot roll back automatically." };
    op = sharedCriterionRemoveOp(exec.resourceName);
  } else if (loaded.action.kind === "pause_campaign") {
    op = campaignStatusOp(String(before.campaignResource), (before.status as "ENABLED" | "PAUSED") ?? "ENABLED");
  } else if (loaded.action.kind === "set_campaign_budget") {
    op = budgetAmountOp(String(before.budgetResource), Number(before.amountMicros ?? 0));
  }
  if (!op) return { error: "Could not build a rollback operation." };

  const supabase = createSupabaseAdminClient();
  try {
    await googleAdsMutate(loaded.customerId, [op], true);
    await googleAdsMutate(loaded.customerId, [op], false);
    await supabase.from("optimization_proposals").update({ status: "rolled_back", rolled_back_by: actor, rolled_back_at: new Date().toISOString() }).eq("id", id);
    await logActivity({ clientId: loaded.clientId, eventType: "proposal_rolled_back", actor, payload: { proposal_id: id, mcc: boundary.mcc, customerId: boundary.customerId, deployment: DEPLOYMENT } });
    await alertSlack(`↩️ P5-Lite ROLLED BACK: ${loaded.action.kind} on ${boundary.customerId} under MCC ${boundary.mcc} (proposal ${id}, by ${actor}).`);
    return { ok: true, message: "Rolled back." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Rollback failed." };
  }
}

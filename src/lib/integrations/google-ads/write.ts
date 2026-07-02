// P5-Lite guardrails — the safety layer around the ONLY Google Ads write path
// (googleAdsMutate). Two independent scopes gate every write:
//
//   1. MCC MEMBERSHIP (the hard outer boundary) — the target account must be
//      verifiably under THIS deployment's MCC (login-customer-id). Enforced
//      server-side via the customer_client hierarchy (see index.ts,
//      isCustomerUnderMcc), NOT a UI parameter. No cross-MCC writes, ever.
//   2. ACCOUNT ALLOWLIST (the operational rollout control) — GOOGLE_ADS_WRITE_
//      CUSTOMERS, expanded deliberately (test acct -> one real acct -> groups ->
//      full book). ALLOW_ALL_MCC_ACCOUNTS lifts this once rollout completes, so
//      MCC membership alone gates. Default off.
//
// Plus the unchanged canon: kill switch (default off), one op per approval, no
// batch, no autonomous writes, validate-only -> mutate -> verify-after ->
// immutable audit -> rollback. The worker (proposals-execute.ts) is the control
// boundary and re-checks all of this; the UI is not trusted.
import type { ProposalAction } from "@/lib/proposals";
import { isCustomerUnderMcc, currentMccId } from "./index";

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export interface BoundaryResult {
  ok: boolean;
  mcc: string;
  customerId: string;
  reason?: string;
}

/**
 * The HARD outer boundary, enforced server-side before any write OR validate is
 * constructed: the target account must be verifiably under this deployment's MCC.
 * A failure is a boundary violation (audit-logged by the caller). This must not
 * be bypassable by a modified request — it checks the live customer_client
 * hierarchy, never a UI-supplied value.
 */
export async function assertMccBoundary(customerId: string): Promise<BoundaryResult> {
  const mcc = currentMccId();
  const cid = onlyDigits(customerId);
  const ok = await isCustomerUnderMcc(cid);
  return ok
    ? { ok: true, mcc, customerId: cid }
    : { ok: false, mcc, customerId: cid, reason: `Account ${cid} is not under this deployment's MCC (${mcc}). Write refused.` };
}

/** Master kill switch. Case-insensitive; anything but "true" means OFF. */
export function writeEnabled(): boolean {
  return (process.env.GOOGLE_ADS_WRITE_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Rollout complete: allow writes to ANY account under the MCC (MCC membership
 *  becomes the sole account gate). Default OFF — expand the allowlist first. */
export function allowAllMccAccounts(): boolean {
  return (process.env.ALLOW_ALL_MCC_ACCOUNTS ?? "").trim().toLowerCase() === "true";
}

/** Account allowlist — the operational rollout control (10-digit ids, comma-
 *  separated). Ships containing only the test account. Ignored when
 *  allowAllMccAccounts() is on. */
export function allowedCustomers(): string[] {
  return (process.env.GOOGLE_ADS_WRITE_CUSTOMERS ?? "").split(",").map((s) => onlyDigits(s)).filter(Boolean);
}

/** The account-level rollout gate (allowlist ∪ allow-all). MCC membership is a
 *  SEPARATE, always-enforced boundary checked async by the worker. */
export function accountAllowed(customerId: string): boolean {
  if (allowAllMccAccounts()) return true;
  return allowedCustomers().includes(onlyDigits(customerId));
}

/** Campaign-id allowlist (required for pause + budget). Empty = none allowed. */
export function allowedCampaigns(): string[] {
  return (process.env.GOOGLE_ADS_WRITE_CAMPAIGNS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export interface BudgetCaps {
  maxDaily: number; // hard ceiling on a new daily budget
  maxIncreasePct: number; // reject increases above this %
  largeDecreasePct: number; // decreases beyond this % are flagged (advisory)
}
export function budgetCaps(): BudgetCaps {
  const n = (v: string | undefined, d: number) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : d);
  return {
    maxDaily: n(process.env.GOOGLE_ADS_BUDGET_MAX_DAILY, 0), // 0 = no budget writes allowed
    maxIncreasePct: n(process.env.GOOGLE_ADS_BUDGET_MAX_INCREASE_PCT, 50),
    largeDecreasePct: n(process.env.GOOGLE_ADS_BUDGET_LARGE_DECREASE_PCT, 50),
  };
}

/** Validate + narrow a stored details.action into a known executable action. */
export function parseAction(details: unknown): ProposalAction | null {
  const a = (details as { action?: Record<string, unknown> })?.action;
  if (!a || typeof a !== "object") return null;
  const kind = a.kind;
  if (kind === "add_negative_keyword" && typeof a.campaign === "string" && typeof a.text === "string") {
    const mt = a.matchType;
    return { kind, campaign: a.campaign, text: a.text, matchType: mt === "EXACT" || mt === "PHRASE" || mt === "BROAD" ? mt : "BROAD" };
  }
  if (kind === "pause_campaign" && typeof a.campaign === "string") {
    return { kind, campaign: a.campaign };
  }
  if (kind === "set_campaign_budget" && typeof a.campaign === "string" && typeof a.dailyBudget === "number" && a.dailyBudget > 0) {
    return { kind, campaign: a.campaign, dailyBudget: a.dailyBudget };
  }
  if (kind === "add_shared_negative" && typeof a.text === "string") {
    const mt = a.matchType;
    return { kind, text: a.text, matchType: mt === "EXACT" || mt === "PHRASE" || mt === "BROAD" ? mt : "EXACT" };
  }
  return null;
}

export interface GuardContext {
  customerId: string;
  campaignId?: string; // resolved id, required for pause/budget
  currentBudgetMicros?: number; // for budget increase checks
}

/**
 * The synchronous pre-flight gate (kill switch, account allowlist, campaign
 * allowlist, budget caps). The async MCC-membership boundary is checked
 * SEPARATELY and first by the worker — this function assumes it has passed.
 *
 * `opts.skipAllowlist` is used for validate-only / dry-run: MCC membership +
 * kill switch still apply, but the account/campaign allowlist does not, so an
 * operator can validate against a real account BEFORE adding it to the
 * allowlist (per the staged rollout plan). Real writes never skip it.
 *
 * Returns null when allowed, or a human reason when blocked.
 */
export function guardAction(action: ProposalAction, ctx: GuardContext, opts: { skipAllowlist?: boolean } = {}): string | null {
  if (!writeEnabled()) return "Controlled writes are disabled (GOOGLE_ADS_WRITE_ENABLED is off).";
  if (!opts.skipAllowlist && !accountAllowed(ctx.customerId)) return "This account is not on the write allowlist (GOOGLE_ADS_WRITE_CUSTOMERS).";

  if (action.kind === "pause_campaign" || action.kind === "set_campaign_budget") {
    if (!ctx.campaignId) return "Could not resolve the campaign id.";
    // Campaign allowlist is an OPTIONAL extra narrowing: enforced only when set,
    // so it can pin early testing to specific campaigns without blocking the
    // wider account-scoped rollout. Skipped for validate-only.
    if (!opts.skipAllowlist) {
      const campaigns = allowedCampaigns();
      if (campaigns.length > 0 && !campaigns.includes(ctx.campaignId)) {
        return "This campaign is not on the write allowlist (GOOGLE_ADS_WRITE_CAMPAIGNS).";
      }
    }
  }

  if (action.kind === "set_campaign_budget") {
    const caps = budgetCaps();
    if (caps.maxDaily <= 0) return "Budget writes are disabled (set GOOGLE_ADS_BUDGET_MAX_DAILY).";
    if (action.dailyBudget > caps.maxDaily) return `New budget ${action.dailyBudget} exceeds the cap of ${caps.maxDaily}.`;
    if (ctx.currentBudgetMicros && ctx.currentBudgetMicros > 0) {
      const current = ctx.currentBudgetMicros / 1_000_000;
      const increasePct = ((action.dailyBudget - current) / current) * 100;
      if (increasePct > caps.maxIncreasePct) return `Increase of ${Math.round(increasePct)}% exceeds the ${caps.maxIncreasePct}% cap.`;
    }
  }
  return null;
}

// ---- single-op mutate builders (resource names are pre-resolved by the worker) ----

export function negativeKeywordCreateOp(customerId: string, campaignResource: string, text: string, matchType: string) {
  return { campaignCriterionOperation: { create: { campaign: campaignResource, negative: true, keyword: { text, matchType } } } };
}
export function criterionRemoveOp(resourceName: string) {
  return { campaignCriterionOperation: { remove: resourceName } };
}
export function campaignStatusOp(campaignResource: string, status: "ENABLED" | "PAUSED") {
  return { campaignOperation: { update: { resourceName: campaignResource, status }, updateMask: "status" } };
}
export function budgetAmountOp(budgetResource: string, amountMicros: number) {
  return { campaignBudgetOperation: { update: { resourceName: budgetResource, amountMicros: String(amountMicros) }, updateMask: "amount_micros" } };
}

// ---- shared negative list ops ----
// A shared negative list is a SharedSet(NEGATIVE_KEYWORDS) + SharedCriterion
// entries, attached to campaigns via CampaignSharedSet. `setResource` may be a
// temp resource name (negative id) when created in the same atomic mutate.
export function sharedSetCreateOp(tempResource: string, name: string) {
  return { sharedSetOperation: { create: { resourceName: tempResource, name, type: "NEGATIVE_KEYWORDS", status: "ENABLED" } } };
}
export function sharedCriterionCreateOp(setResource: string, text: string, matchType: string) {
  return { sharedCriterionOperation: { create: { sharedSet: setResource, keyword: { text, matchType } } } };
}
export function campaignSharedSetCreateOp(campaignResource: string, setResource: string) {
  return { campaignSharedSetOperation: { create: { campaign: campaignResource, sharedSet: setResource } } };
}
export function sharedCriterionRemoveOp(resourceName: string) {
  return { sharedCriterionOperation: { remove: resourceName } };
}

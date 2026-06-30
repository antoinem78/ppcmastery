// P5-Lite guardrails — the safety layer around the ONLY Google Ads write path
// (googleAdsMutate). Ships INERT: the kill switch is off and the allowlists are
// empty by default, so nothing can be written until an operator explicitly sets
// the env vars (and redeploys). Three actions only; one op per approval; no
// batch; no autonomous writes. The worker (proposals-execute.ts) is the control
// boundary and re-checks all of this; the UI is not trusted.
import type { ProposalAction } from "@/lib/proposals";

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** Master kill switch. Case-insensitive; anything but "true" means OFF. */
export function writeEnabled(): boolean {
  return (process.env.GOOGLE_ADS_WRITE_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Customer-id allowlist (10-digit ids, comma-separated). Empty = none allowed. */
export function allowedCustomers(): string[] {
  return (process.env.GOOGLE_ADS_WRITE_CUSTOMERS ?? "").split(",").map((s) => onlyDigits(s)).filter(Boolean);
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
  return null;
}

export interface GuardContext {
  customerId: string;
  campaignId?: string; // resolved id, required for pause/budget
  currentBudgetMicros?: number; // for budget increase checks
}

/** The full pre-flight gate. Returns null when allowed, or a human reason when blocked. */
export function guardAction(action: ProposalAction, ctx: GuardContext): string | null {
  if (!writeEnabled()) return "Controlled writes are disabled (GOOGLE_ADS_WRITE_ENABLED is off).";
  if (!allowedCustomers().includes(onlyDigits(ctx.customerId))) return "This account is not on the write allowlist (GOOGLE_ADS_WRITE_CUSTOMERS).";

  if (action.kind === "pause_campaign" || action.kind === "set_campaign_budget") {
    if (!ctx.campaignId) return "Could not resolve the campaign id.";
    if (!allowedCampaigns().includes(ctx.campaignId)) return "This campaign is not on the write allowlist (GOOGLE_ADS_WRITE_CAMPAIGNS).";
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

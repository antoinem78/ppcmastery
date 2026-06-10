// Locked service tiers for the quote. A quote is *configured* (admin picks one of
// these), not authored — no free-text scope box.
//
// ⚠️ PLACEHOLDER names / prices / features. Real tiers are NOT DECIDED yet —
// replace before go-live. Prices are plain numbers in the deployment's currency
// (entityConfig.currency: USD for BJ PPC, GBP for WMI). Open question, deferred:
// whether the two entity deployments share tier definitions or need their own —
// if per-entity, this file's contents move into per-deployment config.

export type TierKey = "starter" | "growth" | "scale";

export interface Tier {
  key: TierKey;
  name: string;
  /** Monthly subscription price in the deployment's currency. PLACEHOLDER. */
  monthlyPrice: number;
  blurb: string;
  features: string[];
}

export const TIERS: Record<TierKey, Tier> = {
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPrice: 500,
    blurb: "For smaller accounts getting started with managed PPC.",
    features: [
      "1 ad platform (Google or Microsoft)",
      "Campaign setup + management",
      "Monthly performance review",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    monthlyPrice: 1000,
    blurb: "For scaling accounts across multiple platforms.",
    features: [
      "Up to 2 ad platforms",
      "Campaign setup + ongoing optimisation",
      "Bi-weekly performance reviews",
      "Slack support",
    ],
  },
  scale: {
    key: "scale",
    name: "Scale",
    monthlyPrice: 2000,
    blurb: "For high-spend accounts needing hands-on management.",
    features: [
      "Multi-platform (Google, Microsoft, more)",
      "Full-funnel campaign management",
      "Weekly performance reviews",
      "Priority Slack support",
    ],
  },
};

export const TIER_LIST: Tier[] = [TIERS.starter, TIERS.growth, TIERS.scale];

export function getTier(key: string | null | undefined): Tier | null {
  if (key && key in TIERS) return TIERS[key as TierKey];
  return null;
}

// Billing model (decided June 2026, supersedes the handover's 3-months-upfront):
// 1-month rolling subscription, billed in advance on the signup date each month
// (sign up June 14 → pay June 14, July 14, …). Cancellation requires 31 days'
// notice, so the renewal falling inside the notice window still bills — one
// final payment after cancelling. Stripe: anchor = signup; on cancellation set
// cancel_at = notice date + 31 days (NOT cancel_at_period_end).

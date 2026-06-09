// Locked service tiers for the quote. A quote is *configured* (admin picks one of
// these), not authored — no free-text scope box.
//
// ⚠️ PLACEHOLDER names / prices / features. Replace with the real PPC Mastery
// tiers before go-live. The whole wizard + quote read from this file, so updating
// these values is all that's needed — no structural changes.

export type TierKey = "starter" | "growth" | "scale";

export interface Tier {
  key: TierKey;
  name: string;
  /** Monthly subscription price, EUR. PLACEHOLDER. */
  monthlyPriceEur: number;
  blurb: string;
  features: string[];
}

export const TIERS: Record<TierKey, Tier> = {
  starter: {
    key: "starter",
    name: "Starter",
    monthlyPriceEur: 500,
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
    monthlyPriceEur: 1000,
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
    monthlyPriceEur: 2000,
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

// Billing model (handover): 3 months upfront, then monthly from month 4.
export const UPFRONT_MONTHS = 3;

export function upfrontEur(tier: Tier): number {
  return tier.monthlyPriceEur * UPFRONT_MONTHS;
}

export function formatEur(amount: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

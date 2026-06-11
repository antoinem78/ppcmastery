// Locked service tiers for the quote. A quote is *configured* (admin picks one of
// these), not authored — no free-text scope box.
//
// REAL tiers (decided June 2026): paid search only (Google Ads + Microsoft Ads),
// priced by the client's monthly ad spend band. The low prices are sustainable
// only in a ZERO-CALLS context — Slack-only communication.
//
// Not tiers (sales routing, handled at the discovery call — "speak to an expert
// for a bespoke quote"):
//   - ad spend above the top band ($20,000+/month)
//   - services beyond Google/Microsoft ads
//   - clients requiring calls (premium package, tailored quote)
//
// Prices are plain numbers in the deployment's currency (entityConfig.currency).
// Whether the WMI clone keeps these numbers in GBP or gets its own is undecided.

import { formatMoney } from "@/lib/config";

export type TierKey =
  | "ps-1k"
  | "ps-2k"
  | "ps-3k"
  | "ps-5k"
  | "ps-10k"
  | "ps-15k"
  | "ps-20k";

export interface Tier {
  key: TierKey;
  /** Upper bound of the monthly ad spend band this tier covers. */
  spendCapMonthly: number;
  /** Monthly subscription price in the deployment's currency. */
  monthlyPrice: number;
}

const BANDS: Array<[TierKey, number, number]> = [
  ["ps-1k", 1_000, 99],
  ["ps-2k", 2_000, 129],
  ["ps-3k", 3_000, 149],
  ["ps-5k", 5_000, 199],
  ["ps-10k", 10_000, 399],
  ["ps-15k", 15_000, 499],
  ["ps-20k", 20_000, 599],
];

export const TIERS: Record<TierKey, Tier> = Object.fromEntries(
  BANDS.map(([key, spendCapMonthly, monthlyPrice]) => [
    key,
    { key, spendCapMonthly, monthlyPrice },
  ]),
) as Record<TierKey, Tier>;

export const TIER_LIST: Tier[] = BANDS.map(([key]) => TIERS[key]);

export function getTier(key: string | null | undefined): Tier | null {
  if (key && key in TIERS) return TIERS[key as TierKey];
  return null;
}

/** Display name, e.g. "Paid Search — ad spend under $2,000/mo". */
export function tierName(tier: Tier): string {
  return `Paid Search — ad spend under ${formatMoney(tier.spendCapMonthly)}/mo`;
}

// Bespoke/negotiated deals: a pseudo-tier with no band — the price comes from
// clients.custom_monthly_price. Clients only ever see the neutral plan name.
export const CUSTOM_TIER_KEY = "custom";
export const CUSTOM_PLAN_NAME = "Paid Search — custom plan";

/** Display name straight from a stored key; null when unknown/unset. */
export function tierNameFor(key: string | null | undefined): string | null {
  if (key === CUSTOM_TIER_KEY) return CUSTOM_PLAN_NAME;
  const tier = getTier(key);
  return tier ? tierName(tier) : null;
}

/** Platforms an admin can select at client creation. */
export const PLATFORM_OPTIONS = ["Google Ads", "Microsoft Ads", "Meta Ads"] as const;

export function channelsLabel(platforms: string[] | null | undefined): string {
  return platforms?.length ? platforms.join(" & ") : "Google Ads & Microsoft Ads";
}

/**
 * Plan wording shown on quotes. Custom/premium plans deliberately do NOT
 * mention zero-calls — calls may be part of what was negotiated.
 */
export function planBlurb(
  platforms: string[] | null | undefined,
  isCustom: boolean,
): string {
  return `Managed ${channelsLabel(platforms)}${isCustom ? "" : " — a zero-calls service"}.`;
}

export function planFeatures(
  platforms: string[] | null | undefined,
  isCustom: boolean,
): string[] {
  return [
    `${channelsLabel(platforms)} management`,
    "Campaign setup & continuous optimisation",
    "Weekly written performance reports",
    isCustom ? "Dedicated Slack channel" : "Slack-only communication — no calls",
  ];
}

// Billing model (decided June 2026, supersedes the handover's 3-months-upfront):
// 1-month rolling subscription, billed in advance on the signup date each month
// (sign up June 14 → pay June 14, July 14, …). Cancellation requires 31 days'
// notice, so the renewal falling inside the notice window still bills — one
// final payment after cancelling. Stripe: anchor = signup; on cancellation set
// cancel_at = notice date + 31 days (NOT cancel_at_period_end).

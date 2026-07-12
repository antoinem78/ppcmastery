// Pricing model: every MaaS quote is bespoke — a custom monthly price per
// client. The locked self-serve spend-band tiers were removed (June 2026):
// bespoke quotes carry their own complexity, and a tiered catalogue belongs to
// the future self-serve SaaS, not the MaaS (see FUTURE_SAAS.md). It also kept
// us from seeding tier products into the shared Stripe account.
//
// The price comes from clients.custom_monthly_price; the client sees a single
// neutral plan name. clients.service_tier is retained but always 'custom'.

/** Marker stored in clients.service_tier — all MaaS clients are 'custom'. */
export const CUSTOM_TIER_KEY = "custom";

/** Single client-facing plan name (quote + contract). No long dashes in
 *  client-facing copy (house rule) — this appears on contracts, Stripe
 *  checkout, and the client home. */
export const CUSTOM_PLAN_NAME = "Paid Search Managed Service";

/** Platforms an admin can select at client creation. */
export const PLATFORM_OPTIONS = ["Google Ads", "Microsoft Ads", "Meta Ads"] as const;

export function channelsLabel(platforms: string[] | null | undefined): string {
  return platforms?.length ? platforms.join(" & ") : "Google Ads & Microsoft Ads";
}

/** Plan wording shown on the quote/contract. */
export function planBlurb(platforms: string[] | null | undefined): string {
  return `Managed ${channelsLabel(platforms)}.`;
}

export function planFeatures(platforms: string[] | null | undefined): string[] {
  return [
    `${channelsLabel(platforms)} management`,
    "Campaign setup & continuous optimisation",
    "Weekly written performance reports",
    "Dedicated Slack channel",
  ];
}

// Billing model (decided June 2026): 1-month rolling subscription, billed in
// advance on the signup date each month. Cancellation requires 31 days' notice,
// so the renewal inside the notice window still bills — one final payment.
// Stripe: anchor = signup; on cancellation set cancel_at = now + 31 days.

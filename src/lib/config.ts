// Per-deployment entity/brand configuration — the ONLY place these env vars are
// read. The same app is deployed once per entity (e.g. BJ PPC → USD, WMI → GBP),
// each Vercel project carrying its own env set. Code must never branch on which
// entity it is; it just reads this config. See .env.example.
//
// Server-side only (none of these are NEXT_PUBLIC_): import from Server
// Components and server actions, not from "use client" files.

export const entityConfig = {
  /** Legal entity behind this deployment, e.g. "BJ PPC sp. z o.o. trading as PPC Mastery".
   *  Used on contracts/invoices from Phase 2. */
  legalName: process.env.ENTITY_LEGAL_NAME ?? "",

  /** Brand shown in the UI (wordmark, titles, wizard header). */
  brandName: process.env.BRAND_NAME ?? "PPC mastery",

  /** Optional logo image; when empty the text wordmark is rendered instead. */
  brandLogoUrl: process.env.BRAND_LOGO_URL ?? "",

  /** ISO 4217 currency for all price formatting (USD for BJ PPC, GBP for WMI). */
  currency: process.env.CURRENCY ?? "USD",

  /** VAT percentage for quotes/invoices (Phase 2). Null = not configured. */
  vatRate: process.env.VAT_RATE ? Number(process.env.VAT_RATE) : null,

  /** VAT number shown on contract/invoice footers (Phase 2). */
  vatNumber: process.env.VAT_NUMBER ?? "",

  /** Optional partner/credential claim printed in the audit document appendix,
   *  e.g. "Google Premier Partner". EMPTY by default — only set it (via
   *  AUDIT_PARTNER_CLAIM) for an entity that actually holds the status, else the
   *  appendix uses neutral "certified Google Ads specialists" wording. */
  partnerClaim: process.env.AUDIT_PARTNER_CLAIM ?? "",

  /** Reporting-only deployment (e.g. "MCC Command Center" for BJ PPC's existing
   *  premium clients): no onboarding funnel — only "Add managed account" +
   *  dashboards + weekly reports. The full onboarding portal leaves this off. */
  reportingOnly: process.env.PORTAL_REPORTING_ONLY === "true",
};

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: entityConfig.currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

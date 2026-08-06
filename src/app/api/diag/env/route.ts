// GET /api/diag/env — config health for THIS deployment, as booleans only
// (never values). Vercel bakes env at build time, so this is how you prove what
// the running deployment actually sees, not what the dashboard claims. It has
// caught a variable that existed in the dashboard with an empty value, and a
// live Stripe key behind a test-mode webhook.
//
// Admin-gated like every other /api route (proxy covers /api/diag).
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

// Grouped by feature, mirroring .env.example. A var listed here reports
// true/false = non-empty/empty at runtime.
const GROUPS: Record<string, string[]> = {
  entity: [
    "ENTITY_LEGAL_NAME",
    "BRAND_NAME",
    "BRAND_LOGO_URL",
    "CURRENCY",
    "VAT_RATE",
    "VAT_NUMBER",
    "PORTAL_REPORTING_ONLY",
    "PORTAL_REVIEW_MODE",
    "PORTAL_WORKSPACE_NAME",
    "ENTITY_FOOTER_LINE",
    "LEGAL_PRIVACY_URL",
    "LEGAL_TERMS_URL",
    "AUDIT_PARTNER_CLAIM",
  ],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  slack: [
    "SLACK_BOT_TOKEN",
    "SLACK_TEAM_EMAILS",
    "ACCESS_GRANT_EMAILS",
    "META_BUSINESS_ID",
    "SLACK_REVIEW_CHANNEL",
    "SLACK_OPS_CHANNEL",
  ],
  google_ads: [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  ],
  google_ads_writes: [
    "GOOGLE_ADS_WRITE_ENABLED",
    "GOOGLE_ADS_WRITE_CUSTOMERS",
    "GOOGLE_ADS_WRITE_CAMPAIGNS",
    "ALLOW_ALL_MCC_ACCOUNTS",
    "GOOGLE_ADS_BUDGET_MAX_DAILY",
    "GOOGLE_ADS_BUDGET_MAX_INCREASE_PCT",
    "GOOGLE_ADS_BUDGET_LARGE_DECREASE_PCT",
  ],
  contracts: [
    "CONTRACT_PROVIDER",
    "PANDADOC_API_KEY",
    "PANDADOC_TEMPLATE_ID",
    "PANDADOC_WEBHOOK_KEY",
    "PROPOSAL_ENGINE_URL",
    "PROPOSAL_ENGINE_API_TOKEN",
    "PROPOSAL_ENGINE_WEBHOOK_SECRET",
    "DOCUMENSO_URL",
    "DOCUMENSO_API_TOKEN",
    "DOCUMENSO_WEBHOOK_SECRET",
    "ENTITY_REGISTRATION_INFO",
    "AGREEMENT_GOVERNING_LAW",
    "PRIVACY_URL",
    "AGREEMENT_SIGNATORY_NAME",
    "AGREEMENT_SIGNATORY_TITLE",
  ],
  email: ["RESEND_API_KEY", "EMAIL_FROM", "CONTRACT_COPY_TO"],
  meta: ["META_ADS_TOKEN", "META_ACCESS_TOKEN"],
  supabase: ["SUPABASE_URL", "SUPABASE_SECRET_KEY"],
  auth0: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"],
  anthropic: ["ANTHROPIC_API_KEY"],
  cron: ["CRON_SECRET"],
};

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const groups: Record<string, Record<string, boolean>> = {};
  for (const [group, names] of Object.entries(GROUPS)) {
    groups[group] = {};
    for (const name of names) {
      // Present AND non-empty — an empty string in the dashboard is the trap
      // this endpoint exists to catch.
      groups[group][name] = Boolean(process.env[name]?.trim());
    }
  }

  // Non-secret derived facts that catch whole classes of misconfiguration.
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const emailFrom = process.env.EMAIL_FROM ?? "";
  const derived = {
    // Live key + test webhook (or vice versa) = client pays, nothing activates.
    stripe_mode: stripeKey.startsWith("sk_live_")
      ? "live"
      : stripeKey.startsWith("sk_test_")
        ? "test"
        : "unset",
    contract_provider: process.env.CONTRACT_PROVIDER?.trim() || "pandadoc",
    email_from_domain: emailFrom.includes("@") ? emailFrom.split("@").pop() : "",
    // Bernard reads Meta only when one of the two accepted names is set.
    meta_readable: Boolean((process.env.META_ADS_TOKEN ?? process.env.META_ACCESS_TOKEN)?.trim()),
    // Defaults that silently apply when the entity vars are unset, so an empty
    // ENTITY_LEGAL_NAME on a live contract deployment is visible here rather
    // than only on a signed agreement.
    brand_name_effective: process.env.BRAND_NAME?.trim() || "PPC mastery (default)",
    legal_name_set: Boolean(process.env.ENTITY_LEGAL_NAME?.trim()),
    currency_effective: process.env.CURRENCY?.trim() || "USD (default)",
    vat_breakdown_shown: Boolean(process.env.VAT_RATE?.trim()),
    reporting_only: process.env.PORTAL_REPORTING_ONLY === "true",
    review_mode: process.env.PORTAL_REVIEW_MODE === "true",
  };

  // Name forensics: env vars that LOOK like one of ours but aren't (typos,
  // stale names from another deployment's paste). Names only, never values.
  const known = new Set(Object.values(GROUPS).flat());
  const markers = /^(GOOGLE_ADS_|PANDADOC_|DOCUMENSO_|PROPOSAL_ENGINE_|STRIPE_|SLACK_|AUTH0_|SUPABASE_|RESEND_|EMAIL_|CONTRACT_|AGREEMENT_|ENTITY_|PORTAL_|LEGAL_|BRAND_)/;
  const observed_names = Object.keys(process.env)
    .filter((n) => markers.test(n) && !known.has(n))
    .sort();

  return NextResponse.json({ groups, derived, observed_names });
}

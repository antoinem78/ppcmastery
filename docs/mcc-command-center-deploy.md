# MCC Command Center — deployment checklist

A **reporting-only clone** of the portal for BJ PPC's existing premium book.
Same codebase, separate Vercel + Supabase project, pointed at the **BJ main MCC**
(`447-370-6744`). No onboarding funnel — only *Import from MCC* / *Add managed
account* → dashboards → weekly reports.

This is a **clone, not a fork**: nothing to branch in code. The only differences
are environment variables (below) and the `PORTAL_REPORTING_ONLY` flag.

Verified June 2026: our existing dev token + OAuth reach the BJ main MCC and see
**129 leaf accounts**, so no new Google credentials are needed.

---

## 1. Supabase — new project

1. Create a new Supabase project (EU/Ireland, same org). Name it e.g.
   "MCC Command Center".
2. In its SQL editor, paste and run **`supabase/migrations/_consolidated_fresh_install.sql`**
   — the full schema (migrations 0001–0011) in a single run, for fresh clone DBs.
   (Or run the numbered files `0001`→`0011` in order; the consolidated file is
   just the one-paste convenience.)
3. From Project Settings → API Keys, copy the **Project URL** and the **secret**
   key for the env block below.

## 2. Vercel — new project on the same repo

Create a new Vercel project from the **same GitHub repo** (`ppcmastery`), then set
its environment variables. Everything Google-side is identical to the PPC Mastery
deployment **except `GOOGLE_ADS_LOGIN_CUSTOMER_ID`**.

```
# --- Mode + brand ---
PORTAL_REPORTING_ONLY=true
BRAND_NAME=MCC Command Center
ENTITY_LEGAL_NAME=Baptiste Jenard PPC
CURRENCY=USD                      # display fallback; each dashboard uses its account's own currency

# --- Google Ads (same token/OAuth as PPC Mastery; only the login MCC changes) ---
GOOGLE_ADS_DEVELOPER_TOKEN=<same as PPC Mastery>
GOOGLE_ADS_CLIENT_ID=<same>
GOOGLE_ADS_CLIENT_SECRET=<same>
GOOGLE_ADS_REFRESH_TOKEN=<same>
GOOGLE_ADS_LOGIN_CUSTOMER_ID=4473706744     # <-- BJ main MCC (the one change)

# --- Supabase (the NEW project from step 1) ---
SUPABASE_URL=<new project URL>
SUPABASE_SECRET_KEY=<new project secret key>

# --- Auth0 (can reuse the same tenant; add this project's URL to callbacks) ---
AUTH0_DOMAIN=<same>
AUTH0_CLIENT_ID=<same>
AUTH0_CLIENT_SECRET=<same>
AUTH0_SECRET=<generate a fresh one: openssl rand -hex 32>
APP_BASE_URL=https://<this-vercel-project>.vercel.app

# --- Anthropic (weekly narrative; from Baptiste) ---
ANTHROPIC_API_KEY=<sk-ant-...>

# --- Slack (its own review channel for drafts) ---
SLACK_BOT_TOKEN=<same app token, or a dedicated one>
SLACK_TEAM_EMAILS=amartin@ppcmastery.ai,admin@ppcmastery.ai,baptiste@ppcmastery.ai
SLACK_REVIEW_CHANNEL=#mcc-report-drafts      # create this channel + invite the team

# --- Cron ---
CRON_SECRET=<generate a fresh long random string>
```

Notes:
- **Auth0 callbacks:** add `https://<this-vercel-project>.vercel.app/auth/callback`
  (and the logout URL) to the Auth0 app's Allowed Callback/Logout URLs, or stand
  up a separate Auth0 app. Reusing the tenant is fine — login is gated by the
  agency-admin role either way.
- The Vercel cron (`vercel.json`) ships with the repo; the new project picks it
  up automatically. It authenticates with this project's `CRON_SECRET`.

## 3. First run

1. Deploy. Log in (agency-admin).
2. The funnel is hidden (no "New client"). Go to **Clients → Import from MCC**.
3. It lists all ~129 BJ leaf accounts, pre-ticked. Untick any you don't manage,
   then **Import selected accounts** — they're created as reporting-only clients
   with dashboards live.
4. Spot-check a few dashboards (each renders in its own account currency).
5. The Monday cron posts weekly **drafts** to `#mcc-report-drafts` for review.

## Differences from the PPC Mastery deployment

| | PPC Mastery portal | MCC Command Center |
|---|---|---|
| `PORTAL_REPORTING_ONLY` | unset (full funnel) | `true` (reporting only) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | `9281397452` (sub-MCC) | `4473706744` (BJ main MCC) |
| Onboarding wizard / contract / Stripe | yes | hidden |
| Add accounts | wizard + Add managed account | Import from MCC / Add managed account |
| Brand | PPC Mastery AI | MCC Command Center |
| Supabase project | PPC Mastery | separate |
```

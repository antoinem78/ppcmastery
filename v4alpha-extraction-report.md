# V4alpha — Extraction Report (structured technical companion)

Read-only extraction from the PPC Mastery source repo, structured as 10 technical
sections. Companion to `v4alpha-harvest-brief.md` (the 7-area audit). Where they
overlap, both are verified from the same code; **the harvest brief §3 carries the
authoritative PandaDoc-swap verdict** (see §5 below — corrected from an earlier
"truly one module" wording). Every claim cites a real path. No files were modified.

---

## 1. Repo map & framework versions
Tree (`node_modules`/`.next`/`.git` excluded):
```
src/app/(admin)/   → admin UI (gated by (admin)/layout.tsx): clients, dashboard
src/app/api/       → cron (google-ads-links, weekly-reports) + webhooks (stripe, pandadoc)
src/app/onboarding/→ public client wizard + home (link-driven, no login)
src/app/privacy/   → legal page (hardcoded BJ-PPC entity text → rewrite for WMI)
src/components/     → Wordmark, AdsDashboard, StatusBadge, DeleteClientForm, ConfirmSubmitButton, …
src/lib/           → config, auth, supabase, integrations/, tiers, access-tasks, activity
src/lib/integrations/ → google-ads, stripe, slack, pandadoc, anthropic
supabase/migrations/ → 0001–0013 + _consolidated_fresh_install.sql
docs/, scripts/ (get-google-refresh-token.mjs), public/
```
Versions (`package.json`): next `16.2.7`; react/react-dom `19.2.4`; `@supabase/supabase-js ^2.108.0`; `@auth0/nextjs-auth0 ^4.22.0`; `stripe ^22.2.0`; `@anthropic-ai/sdk ^0.104.1`; tailwindcss `^4`; typescript `^5`.
**No Google Ads / Slack / PandaDoc SDK** — those are raw `fetch` (`src/lib/integrations/{google-ads,slack,pandadoc}/index.ts`). DocuSign: choose raw-REST or the DocuSign SDK deliberately.

## 2. Migrations (highest = 0013; all additive, none destructive)
`0001_init` enums+tables (clients, onboarding_state, activity_log; RLS off) · `0002_stripe_ids` · `0003_pandadoc_document_id` *(contract seam)* · `0004_flow_rework` (custom_monthly_price, details_confirmed, slack_invite_email) · `0005_platforms` · `0006_google_ads_linking` **(ALTER TYPE ADD VALUE)** · `0007_client_checklist` (access_tasks, checklist, assets_drive_link) · `0008_ads_report_cache` · `0009_weekly_reports` · `0010_reporting_account` · `0011_client_source` (`clients.source`) · `0012_microsoft_ads` · `0013_subscription_lifecycle` **(ALTER TYPE ADD VALUE 'past_due', cancellation_effective_at)** · `_consolidated_fresh_install.sql` (end-state in one file — **use this for the fresh WMI DB**; avoids the ADD-VALUE-in-transaction caveat in 0006/0013).

## 3. The mode flag — `PORTAL_REPORTING_ONLY`
Read in 3 places only: `src/lib/config.ts:32` (definition), `src/app/(admin)/clients/page.tsx:52` + `:99` (hide "New client" / swap empty-state copy), `src/app/(admin)/clients/new/page.tsx:12` (redirect to `/clients/reporting`). **No sibling flags exist.** Full mode (unset) = the union; reporting-only is a strict subset → no dead/conflicting paths in full mode. Per-client `clients.source` (not the flag) drives the onboarding page's behavior, so mixed books are fine.

## 4. Env var inventory (names only; no secrets found)
Definition + consumers verified by grep. **Re-point to WMI:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_TEAM_EMAILS`, `SLACK_REVIEW_CHANNEL`, `SLACK_OPS_CHANNEL`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `AUTH0_DOMAIN/_CLIENT_ID/_CLIENT_SECRET/AUTH0_SECRET/APP_BASE_URL`, `ANTHROPIC_API_KEY`, `ACCESS_GRANT_EMAILS`, `META_BUSINESS_ID`, `CRON_SECRET`. **Brand/locale:** `ENTITY_LEGAL_NAME`, `BRAND_NAME`, `BRAND_LOGO_URL`, `CURRENCY`, `VAT_RATE`, `VAT_NUMBER`, `PORTAL_REPORTING_ONLY` (leave unset). **Swap for DocuSign:** `PANDADOC_API_KEY/_TEMPLATE_ID/_WEBHOOK_KEY`. Optional `GOOGLE_ADS_API_VERSION` (default `v24`).

## 5. The contract seam — PandaDoc → DocuSign (CORRECTED verdict)
**Not a pure one-module swap.** Logic lives in `src/lib/integrations/pandadoc/index.ts`, but PandaDoc status strings (`document.completed/sent/viewed/draft/uploaded`) + the column `onboarding_state.pandadoc_document_id` leak into:
- `src/app/onboarding/[id]/actions.ts` (uses the column; checks `document.completed`)
- `src/app/onboarding/[id]/page.tsx` (status branching that builds the signing `<iframe src={signingUrl}>`; `signingUrl` = `createSigningSession` → `https://app.pandadoc.com/s/{id}`)
- `src/app/api/webhooks/pandadoc/route.ts` (Connect webhook: HMAC-SHA256 via `?signature=` + `PANDADOC_WEBHOOK_KEY`; `document_state_changed`/`document.completed`)
- DB column `pandadoc_document_id` (migration `0003`); env `PANDADOC_*`.

**Clean (no leak):** `contract_status` enum (`not_sent/sent/signed`) and activity events (`contract_generated`/`contract_signed`) are provider-agnostic; admin journey checks `contract_status==='signed'` only.

**Completion = dual path:** webhook (above) **and** status-check fallback on page load (`page.tsx`: `getDocumentStatus==='document.completed'` → `markContractSigned`). `markContractSigned` (`pandadoc/index.ts`) sets `contract_status='signed'`, `current_step='payment'`.

**DocuSign swap-list:** rewrite the module (envelope + embedded recipient view + JWT/auth-code) → rename to `docusign/`; rewrite the webhook route → `api/webhooks/docusign/route.ts` (DocuSign Connect signing scheme); update status branching in `onboarding/[id]/actions.ts` + `page.tsx` (map `document.sent/viewed/completed` → DocuSign envelope `sent/delivered/completed` — **verify exact names in DocuSign docs**); migrate `pandadoc_document_id` → `docusign_envelope_id`; swap env. **~4 code files + 1 column + env + webhook.**

## 6. Google Ads layer
**v24** confirmed: `src/lib/integrations/google-ads/index.ts:11` (`process.env.GOOGLE_ADS_API_VERSION ?? "v24"`) — **brief's "v20" is wrong.** Auth in `index.ts`: OAuth refresh from `GOOGLE_ADS_CLIENT_ID/_SECRET/_REFRESH_TOKEN`; headers `Authorization: Bearer` + `developer-token` + `login-customer-id` (all env). `gaqlSearch()` = REST `googleAds:search`; reporting in `reporting.ts`. MCC import = `listManagedAccounts()` (enumerate leaves under the login MCC) + `resolveReportingCustomerId()`; consumed by `clients/import/page.tsx` + `addReportingClientsBulk`. **No hardcoded customer/MCC IDs in code** — all via `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

## 7. Reporting + weekly-report pipeline
**No n8n** — Vercel cron only (`vercel.json`: `/api/cron/google-ads-links` `0 8 * * *`; `/api/cron/weekly-reports` `5 8 * * 1`), CRON_SECRET-Bearer-gated. Weekly LLM: `src/lib/integrations/anthropic/narrative.ts` — `generateNarrative()`, 5-section `SYSTEM` prompt (Top Converting / Performance Summary / Optimisations Made / Campaign Insights / Forward Plan), `claude-opus-4-8`, adaptive thinking, `max_tokens 2500`; data via `factsBlock()` + `getWeeklyOptimisations()` (reporting.ts); falls back to `formatWeeklyText()` bullets if no `ANTHROPIC_API_KEY`. Bounded concurrency in `weekly-reports/route.ts` (`CONCURRENCY=5`, `maxDuration=300`, ~40-account ceiling); Slack 429 retry in `slack/index.ts`. Delivery = `postMessage(SLACK_REVIEW_CHANNEL, draft)` with link `${APP_BASE_URL}/onboarding/{clientId}`.

## 8. Hardcoded coupling (must change for app.singularweb.ai / WMI)
- `src/app/api/cron/weekly-reports/route.ts:44` — fallback `"https://ppcmastery.vercel.app"` (set `APP_BASE_URL`).
- `src/lib/auth/roles.ts:4` — `ROLES_CLAIM = "https://ppcmastery.app/roles"` (must match the WMI Auth0 Action exactly — silent "No access" if not).
- "PPC Mastery" hardcoded in ~12 source files (Slack subjects, access-task hints, narrative prompt + `BRAND_NAME` default, onboarding copy, `Wordmark.tsx`, `dashboard/page.tsx`, `privacy/page.tsx`) — sweep for SingularWeb; rewrite `privacy/page.tsx`.
- **No** Supabase project ref/URL, Vercel ref, MCC/customer/price/channel IDs, or callback/webhook URLs in code (all env-derived; e.g. Stripe `success_url` uses `${base}`).

## 9. Auth0
`src/proxy.ts` mounts `/auth/*` + refreshes the cookie (not authz). **Authz gate = `src/app/(admin)/layout.tsx`** (verified): no session → `/auth/login`; logged-in-but-not-`agency_admin` → "No access" screen. `src/lib/auth/roles.ts` (`AppRole = "agency_admin" | "client"`, claim `https://ppcmastery.app/roles`); `auth0.ts` `beforeSessionSaved` carries the claim (v4 strips non-default claims); `guard.ts` `requireAgencyAdmin()` for server actions. **Clients use a link, no login** — `/onboarding/[id]` routes are public; clientId from URL; actions re-check state server-side. Assumed external config: Auth0 app + post-login Action stamping the claim + `agency_admin` role + callbacks at `${APP_BASE_URL}`.

## 10. Cleanest harvest path (minimal sequence)
1. Copy the repo into the new WMI repo (clean-room; source untouched).
2. New Supabase (EU) → run `_consolidated_fresh_install.sql`.
3. Set all §4 env to WMI's; **`APP_BASE_URL=https://app.singularweb.ai` from the first wiring.**
4. Auth0 app (callbacks at `app.singularweb.ai`) + post-login Action stamping `https://ppcmastery.app/roles` (or change `roles.ts:4` + the Action together); assign `agency_admin`.
5. Sweep the ~12 hardcoded "PPC Mastery" files + `route.ts:44`; rewrite `privacy/page.tsx`.
6. **Swap PandaDoc → DocuSign** (§5 swap-list) — the one real rewrite.
7. Verify WMI Google creds reach WMI accounts; wire Stripe/Slack/Anthropic; leave `PORTAL_REPORTING_ONLY` unset.
8. Vercel project on `app.singularweb.ai`; register Stripe + DocuSign-Connect webhooks against it.

**Riskiest step:** the DocuSign swap (#6). **Runner-up:** the Auth0 roles-claim mismatch (#4) — fails silently.

*Read-only extraction; no files in the source repo were modified.*

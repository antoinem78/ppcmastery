# V4alpha / SingularWeb — Harvest Brief (ground-truth audit of the PPC Mastery repo)

Read-only audit of the source repo, for the clean-room WMI build. Every claim is
cited to a file actually opened. Where something is external/config (not in the
repo) or is my interpretation, it's marked. Repo audited: `ppcmastery` (one repo;
the "Command Center" is the same codebase behind an env flag — see §7).

---

## 1. The two-halves mechanism

**`PORTAL_REPORTING_ONLY` is read in exactly three places:**
- `src/lib/config.ts:32` — the only definition: `reportingOnly: process.env.PORTAL_REPORTING_ONLY === "true"`.
- `src/app/(admin)/clients/page.tsx:52` — hides the **"New client"** button when true; `:99` swaps the empty-state copy ("Add managed account…" vs "New client…").
- `src/app/(admin)/clients/new/page.tsx:12` — `if (entityConfig.reportingOnly) redirect("/clients/reporting")`.

That is the **entire** gate: in reporting-only mode the funnel's *entry points* (the New-client button + the `/clients/new` form) are hidden/redirected. Nothing else changes.

**Sibling flags: none.** Grep for `PORTAL_*`, `FEATURE_*`, `*_MODE`, `NEXT_PUBLIC_*` returns only `PORTAL_REPORTING_ONLY` (plus docs). There is no other runtime feature toggle.

**Full mode (flag off) exposes** the union: the onboarding funnel (New client → details → contract → payment → Slack → questionnaire → access-tasks) **plus** "Add managed account", "Import from MCC", dashboards, reporting, and Slack delivery — all of which are present in both modes (only the funnel entry is gated).

**One-mode-only assumptions / both-halves-on risks — none found.** Checked `src/lib/config.ts`, `src/app/(admin)/clients/page.tsx`, `src/app/(admin)/clients/new/page.tsx`, `src/app/onboarding/[id]/page.tsx`, and both cron routes (`src/app/api/cron/weekly-reports/route.ts`, `src/app/api/cron/google-ads-links/route.ts`). The data model carries a per-client `clients.source` (`'onboarding'` | `'reporting_only'`); the onboarding page branches on that *column*, not on the env flag, so onboarding-origin and imported reporting-only clients **coexist by design**. No route assumes "no onboarding clients" or "all reporting-only"; the crons select by `ad_link_status`/state, not by mode. **Reporting-only is a strict subset of full mode** — running full mode adds no dead/conflicting paths.

## 2. The data model (from the real migrations)

Tables (verbatim), from `supabase/migrations/0001`–`0013` + `supabase/migrations/_consolidated_fresh_install.sql`:

| Table | Holds | Side |
|---|---|---|
| `clients` | the canonical client record (company/contact, status, source, custom_monthly_price, platforms, access_tasks, stripe ids, cancellation date) | **shared / source of truth** |
| `onboarding_state` | per-client state: wizard step, contract/payment/slack/ad-link statuses, questionnaire jsonb, checklist jsonb, Google Ads customer + resolved reporting id, microsoft_ads_account_id, assets link, `pandadoc_document_id` | shared (heavily onboarding-side; reporting clients also get a row) |
| `activity_log` | append-only event trail (event_type, actor, payload) | shared (audit) |
| `ads_report_cache` | cached dashboard payload per (client_id, window_days) | management/reporting |
| `weekly_reports` | stored weekly report history incl. narrative | management/reporting |

**Relationships:** every child table has `client_id uuid ... references clients(id) on delete cascade` (`0001`, `0008`, `0009`). `onboarding_state.client_id` is **UNIQUE** — one state row per client. So deleting a `clients` row cascades to all of the above (verified: the delete feature relies on this).

**Single source of truth = `clients` (id uuid).** Onboarding-origin vs imported is the column **`clients.source`** (`'onboarding'` | `'reporting_only'`, migration `0011_client_source.sql`).

**Sharp edges (verified):**
- `onboarding_state` rows exist for **all** clients, including `reporting_only` ones — but for imported clients the onboarding fields are meaningless defaults (`contract_status='not_sent'`, `payment_status='unpaid'`, etc.). Those statuses mean nothing for a reporting-only client. *(Interpretation; columns verified in `0001`/`0004`.)*
- `clients.status` is reached two ways: funnel clients progress `prospect→onboarding→active`; reporting clients are created `active` directly (`addReportingClient` in `src/app/(admin)/clients/actions.ts`). `past_due`/`churned` (migration `0013`) only apply to funnel/subscription clients. **So a status's meaning differs by half.**
- `clients.contact_email` is NOT NULL, but bulk-imported clients get the **admin's email as a placeholder** (`addReportingClientsBulk` in `actions.ts`) — required-but-often-placeholder.
- **No near-duplicate tables.** There is one schema — the "reconcile two data models" task is effectively already done, *because it was always one schema*, not because a merge happened. Checked all 13 migrations + the consolidated file.

## 3. The integration seams (verified)

Each provider sits behind a single module under `src/lib/integrations/` (or `src/lib/auth`, `src/lib/supabase`), consumed by a handful of callers:

| Provider | Module | SDK? | Consumers (direct) |
|---|---|---|---|
| Supabase | `src/lib/supabase/server.ts` | official | every server action/page (single client factory) |
| Stripe | `src/lib/integrations/stripe/index.ts` | official `stripe@^22.2.0` | `api/webhooks/stripe/route.ts`, onboarding `actions.ts`, clients `actions.ts` |
| Slack | `src/lib/integrations/slack/index.ts` | **none — raw `fetch`** | onboarding `actions.ts`, clients `actions.ts`, both crons |
| Google Ads | `src/lib/integrations/google-ads/index.ts` + `reporting.ts` | **none — raw `fetch`** (REST v24) | clients `actions.ts`, `clients/import/page.tsx`, crons |
| Auth0 | `src/lib/auth/{auth0.ts,roles.ts,guard.ts}` + `src/proxy.ts` + `(admin)/layout.tsx` | official `@auth0/nextjs-auth0@^4.22.0` | layout (gate), guard (actions) |
| Anthropic | `src/lib/integrations/anthropic/narrative.ts` | official `@anthropic-ai/sdk@^0.104.1` | `weekly-reports` cron |
| PandaDoc | `src/lib/integrations/pandadoc/index.ts` | **none — raw `fetch`** | see verdict below |

> **Flag:** Google Ads, Slack, and PandaDoc use **no vendor SDK** — they're hand-rolled REST via `fetch`. For DocuSign, decide deliberately: same raw-REST pattern, or add the DocuSign Node SDK.

**PandaDoc → DocuSign — honest verdict: NOT a pure one-module swap.** The contract *logic* is one module (`src/lib/integrations/pandadoc/index.ts`: `createContractDocument`, `getDocumentStatus`, `upsertContact`, `ensureDocumentSent`, `createSigningSession`, `markContractSigned`), but **PandaDoc-shaped vocabulary leaks into other files:**
- `src/app/onboarding/[id]/actions.ts` — selects/updates the column `pandadoc_document_id` and branches on `status === "document.completed"` (lines ~70,83,110,118,129,136,137).
- `src/app/onboarding/[id]/page.tsx` — reads `pandadoc_document_id`; branches on `"document.completed"` / `"document.sent"` / `"document.viewed"` to decide whether to build the signing iframe (lines ~82,179,181–187).
- `src/app/api/webhooks/pandadoc/route.ts` — PandaDoc Connect webhook: HMAC-SHA256 over raw body via `?signature=` + `PANDADOC_WEBHOOK_KEY`, event `document_state_changed`/`document.completed`.
- DB column **`onboarding_state.pandadoc_document_id`** (migration `0003_pandadoc_document_id.sql`).
- Signing URL `https://app.pandadoc.com/s/${id}` (`pandadoc/index.ts:174`).
- Env `PANDADOC_API_KEY`, `PANDADOC_TEMPLATE_ID`, `PANDADOC_WEBHOOK_KEY`.

**Clean (no leak):** `contract_status` enum is generic (`not_sent`/`sent`/`signed`, migration `0001`); activity events are generic (`contract_generated`, `contract_signed`). The admin journey checks `state?.contract_status === "signed"` (`clients/[id]/page.tsx:102`) — provider-agnostic.

**Swap-list for DocuSign:** rewrite `pandadoc/index.ts` (envelope + embedded recipient view + JWT/auth-code auth) → likely rename to `docusign/`; rewrite `api/webhooks/pandadoc/route.ts` → `api/webhooks/docusign/route.ts` (DocuSign Connect, different signing scheme); update the **status branching** in `onboarding/[id]/actions.ts` + `page.tsx` (map PandaDoc `document.sent/viewed/completed` → DocuSign envelope `sent/delivered/completed` — *verify DocuSign's exact status names against their docs*); migrate/rename the `pandadoc_document_id` column → `docusign_envelope_id`; swap the `PANDADOC_*` env for `DOCUSIGN_*`. **Bounded (~4 code files + 1 column + env + webhook), but more than one module** — the wizard page's status logic is the tendril to watch.

## 4. The credential surface (names only)

Complete env list (from `.env.example` + grep `process.env.`). **No values printed; no committed secrets found** (`.env.example` is empty placeholders; `.env.local` is gitignored).

**Re-point to WMI for the harvest:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; `SLACK_BOT_TOKEN`, `SLACK_TEAM_EMAILS`, `SLACK_REVIEW_CHANNEL`, `SLACK_OPS_CHANNEL`; `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`; `SUPABASE_URL`, `SUPABASE_SECRET_KEY`; `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`; `ANTHROPIC_API_KEY`; `ACCESS_GRANT_EMAILS`, `META_BUSINESS_ID`; `CRON_SECRET`.
**Brand/locale:** `ENTITY_LEGAL_NAME`, `BRAND_NAME`, `BRAND_LOGO_URL`, `CURRENCY`, `VAT_RATE`, `VAT_NUMBER`, `PORTAL_REPORTING_ONLY` (leave unset).
**Optional:** `GOOGLE_ADS_API_VERSION` (defaults to `v24`).

**Full PandaDoc reference list (the DocuSign swap surface):** env `PANDADOC_API_KEY` / `PANDADOC_TEMPLATE_ID` / `PANDADOC_WEBHOOK_KEY`; module `src/lib/integrations/pandadoc/index.ts`; webhook `src/app/api/webhooks/pandadoc/route.ts`; DB column `onboarding_state.pandadoc_document_id` (migration `0003`); code refs in `src/app/onboarding/[id]/actions.ts` + `src/app/onboarding/[id]/page.tsx`; **no DB enum leak**.

## 5. Harvest hazards

**What breaks first on a fresh clone:**
1. **DB not migrated** → every query 500s. Run `supabase/migrations/_consolidated_fresh_install.sql` first (it bakes the enum values in; the step-by-step `0006`/`0013` use `ALTER TYPE … ADD VALUE`, which has a same-transaction-use caveat).
2. **Auth0 not wired / roles-claim mismatch** → the `(admin)/layout.tsx` gate shows "No access" to *everyone*, **silently**. The claim key `https://ppcmastery.app/roles` (`src/lib/auth/roles.ts:4`) must match the Auth0 post-login Action exactly.
3. **`APP_BASE_URL` unset** → `src/app/api/cron/weekly-reports/route.ts:44` falls back to the literal `"https://ppcmastery.vercel.app"` (wrong report links), and Stripe `success_url` / callbacks misalign.

**Implicit coupling found:**
- **Vercel:** `vercel.json` carries two cron schedules (`/api/cron/google-ads-links` `0 8 * * *`; `/api/cron/weekly-reports` `5 8 * * 1`). Carried with the repo; needs `CRON_SECRET` set per project.
- **Supabase:** **no project ref/URL in code** — all via `SUPABASE_URL`/`SUPABASE_SECRET_KEY`. ✓
- **Domain:** only the cron fallback literal above + the Auth0 claim namespace string. Everything else derives from `APP_BASE_URL` (e.g. Stripe `success_url` uses `${base}` — `stripe/index.ts:57`).
- **Hardcoded IDs:** **none** — grep for MCC ids (`9281397452`/`4473706744`/`6080462315`), price ids, channel ids → zero in code. Slack channels come from env; Stripe prices are ad-hoc (custom pricing, no price ids).
- **Hardcoded brand text:** "PPC Mastery"/"PPC mastery" appears in ~12 source files (Slack subjects, access-task hints, the narrative prompt + `BRAND_NAME` default, onboarding copy, `components/Wordmark.tsx`, `(admin)/dashboard/page.tsx`, `app/privacy/page.tsx`). `BRAND_NAME` drives the wordmark, but these literals must be swept for SingularWeb. `app/privacy/page.tsx` is hardcoded BJ-PPC legal text → rewrite.

**Manual steps not written in the repo (a fresh builder will trip on these):**
1. Run the consolidated migration before first request. (No seed step — the Stripe price-seed script was removed; custom pricing needs no catalogue.)
2. **Auth0 (dashboard, manual):** create the app, add a post-login Action that stamps `https://ppcmastery.app/roles`, assign the `agency_admin` role; set callback `${APP_BASE_URL}/auth/callback` + logout `${APP_BASE_URL}`. None of this lives in the repo.
3. **Register webhooks (manual):** Stripe (events `checkout.session.completed`, `invoice.payment_failed`, `invoice.paid`, `customer.subscription.deleted`) and the contract provider's Connect webhook — URLs + signing secrets.
4. **Generate the Google refresh token** via `scripts/get-google-refresh-token.mjs`, logged in as the MCC admin (manual, one-off).
5. The weekly-cron schedule rationale (Mon 08:05 UTC = full Mon–Sun incl. US-Pacific) is **not** in the repo — only the cron expression in `vercel.json`.

## 6. PPC-Mastery-specific vs portable

**Specific (rethink for a broader WMI tool):**
- Pricing = bespoke custom monthly price only (`src/lib/tiers.ts` — tiers were removed); a business choice.
- The exact onboarding steps + questionnaire fields (`src/app/onboarding/[id]/actions.ts`).
- The weekly-report **5-section format** (the `SYSTEM` prompt in `src/lib/integrations/anthropic/narrative.ts`).
- Access-task definitions GA4/GTM/GSC/GMC/Meta/Microsoft-Ads (`src/lib/access-tasks.ts`).
- The "no client OAuth" Google linking flow (client enters ID → admin approves → MCC invite → client accepts in Google Ads UI) — a deliberate PPC Mastery design declared to Google; WMI on its own token may keep or revisit it.
- Hardcoded brand/legal text (§5).

**Portable infra (keep close to verbatim):**
- Auth wiring (`auth0.ts`/`roles.ts`/`guard.ts`/`proxy.ts`/`(admin)/layout.tsx`) — clean, env-driven.
- The one-module-per-provider seam pattern + dual webhook+status-fallback pattern.
- `src/lib/supabase/server.ts` + the RLS-ready schema.
- `ads_report_cache` cache layer + `getDashboard` (`reporting.ts`).
- `activity_log` audit pattern.
- Dashboard query layer (`reporting.ts`) + `components/AdsDashboard.tsx`.
- Bounded-concurrency cron (`weekly-reports/route.ts`, `CONCURRENCY = 5`, `maxDuration = 300`, ~40-account ceiling).

## 7. IP provenance honesty

From `git log` of this repo: **all 65 commits are by a single author — "Antoine Martin <antoine@webmarketinginternational.com>" (a WMI email) — between 2026-06-08 and 2026-06-19.**

- The **"Command Center" is not a separate fork in this repo** — it is the *same* codebase, the *same* git history, distinguished only by the `PORTAL_REPORTING_ONLY` env flag at deploy time. There is no Command Center branch or separate repo visible here.
- Therefore, **from the code/history alone, provenance is uniform** (one author, one repo). The multi-party ownership framing in the brief (PPC Mastery MaaS = Antoine + Baptiste; Command Center = Baptiste Jénard MCC) is an **external business/ownership assertion not reflected in the repository**.
- Record-keeping note (not blame, no speculation): because even the jointly-owned "PPC Mastery" product's commits are authored under Antoine's **WMI** email, a future "PPC Mastery owns all its IP" claim is **not supported by git authorship alone** — git shows WMI/Antoine. Whoever needs the EU-grant IP story should resolve ownership contractually; the repo won't disambiguate it.
- I cannot see beyond this repo; if a separate Command Center repo exists elsewhere, it isn't here. **Unverified:** anything about other repos or non-git ownership agreements.

---

## Confidence map

| Section | Basis | Double-check? |
|---|---|---|
| 1 Two-halves | **Directly verified** (grep + the 3 read sites + crons/onboarding read) | No |
| 2 Data model | **Directly verified** (all migrations + consolidated). "Status means different things" is interpretation over verified columns | Light — confirm the reporting-only default-fields behavior in a live row |
| 3 Seams | **Directly verified** (grep + module reads). DocuSign status *mapping* is my analysis | **Yes** — verify DocuSign envelope status names + Connect signing vs the PandaDoc model |
| 4 Credentials | **Directly verified** (`.env.example` + `process.env.` grep) | No |
| 5 Hazards | Coupling **directly verified** (grep clean for IDs/URLs). "What breaks first" + manual-steps are reasoned, not from an actual fresh-clone run | **Yes** — Auth0/webhook setup is *external config*, not in the repo; confirm in the Auth0/Stripe/DocuSign dashboards |
| 6 Specific vs portable | Judgment over verified files | Light — a product call, not a code fact |
| 7 Provenance | **Directly verified** (`git log` authorship/dates) | Only re: repos/agreements outside this repo (stated unverified) |

*Audit produced read-only; no files in the source repo were moved, edited, or refactored.*

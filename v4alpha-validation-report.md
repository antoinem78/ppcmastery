# V4alpha (SingularWeb) — Build Validation Report

**Project:** V4alpha — **SingularWeb**, app at **app.singularweb.ai**
**Owner:** WMI (governed by Antoine Martin alone)
**Companion to:** `v4alpha-build-brief-updated.md` (the brief is the source of truth; this report validates the shared understanding and records the build-time decisions before any code is written)
**Date:** June 2026
**Status:** Pre-build validation — awaiting WMI credentials + repo creation

---

## 1. Purpose of this report

To confirm, on the record and before building, that the builder's understanding
matches the brief — and to capture the architecture decisions taken at kickoff
(including two where the brief's stated stack diverged from how the source app is
actually built, now resolved). It doubles as the **provenance/record-keeping**
artifact the brief asks for (§6).

---

## 2. What we are building (validated)

**SingularWeb (app.singularweb.ai)** — a single Next.js application, on WMI's own
credentials, that combines **both halves of the client lifecycle**:
- **Acquisition / onboarding** (from the PPC Mastery MaaS frontend): questionnaire,
  access-grant requests, account connections, contract, invoice.
- **Management / reporting** (from the BJ PPC MCC Command Center): import + manage
  existing MCC accounts, dashboards, weekly reports, Slack delivery.

**First real job:** onboard, manage and report on **low-budget UK prospects from
Bark.com**. Build for that workload first.

It is WMI's **laboratory** — what's proven here informs the separately-owned PPC
Mastery SaaS later (knowledge loop), but V4alpha is built only for WMI's own use.

---

## 3. Key finding that shapes the build

**The two "source apps" are already one codebase.** The BJ PPC MCC Command Center
is not a separate product to merge — it is the *same* PPC Mastery codebase running
with one environment flag (`PORTAL_REPORTING_ONLY=true`). The full application
(flag off) **already contains both halves**: the onboarding funnel **and**
managed-account import, dashboards, reporting, and Slack delivery, all on **one
unified schema** (migrations 0001–0013, shared `clients` / `onboarding_state` /
`weekly_reports`).

**Consequence:** the brief's flagged "hardest part" — reconciling two data models
(§5.3/§5.6) — is largely **already done**. There is one canonical schema. So
V4alpha is principally:

> **harvest the existing unified codebase into a new WMI-owned repo → rebrand to
> SingularWeb → point at WMI's credentials → swap PandaDoc for DocuSign → run in
> full mode (onboarding + management together).**

The **DocuSign integration is the one genuinely new piece of engineering.**

---

## 4. Decisions taken at kickoff (validated)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Clean-room new WMI repo**; harvest code, do not touch the source apps | IP provenance; the source apps belong to other parties. A deliberate fork — knowledge loop is manual. |
| D2 | **Name = SingularWeb; domain = `app.singularweb.ai`** locked from the first wiring | Matches the Google-token application identity; `app.` stays valid as the product grows; changing the domain later means re-registering with Google. rexos.ai parked. |
| D3 | **DocuSign replaces PandaDoc** | WMI's e-sign stack. The one new integration (envelopes, embedded recipient view, anchor/position tabs, DocuSign Connect webhook + HMAC) behind the existing contract seam. |
| D4 | **WMI's own credentials throughout** | Google dev token (approved under the SingularWeb identity) + WMI MCC `login-customer-id` + WMI-MCC-admin refresh token; WMI Stripe; WMI Slack; WMI Anthropic. Dedicated Supabase project (EU). |
| D5 | **No n8n for v1** *(resolved — brief §4.1 said n8n+Postgres)* | The source app uses no n8n; reporting/Slack/Google calls run in Next.js + Vercel cron and already meet the v1 DoD. n8n belongs to the excluded campaign-builder POC. Re-introduce only with the campaign builder. |
| D6 | **Google Ads API v24** *(resolved — brief §4.3 said v20)* | Source app is on v24; the listed "v20 fixes" are n8n-HTTP-node quirks that don't apply to TypeScript. Substantive Google rules (explicit dev-token header, budget `name`+`explicitlyShared:false`, language via `campaignCriteria`, `manualCpc`, EU-political flag) are already honored. |
| D7 | **No Redis, no multi-tenant auth, no campaign builder, no "monster" features** | Per brief scope walls. The source app never used Redis or multi-tenancy. |
| D8 | **Single-tenant, WMI-only** | Runs on WMI's MCC/token; no external-agency token plug-in (that's PPC Mastery's V4a/V4b, blocked on a SaaS-privileged token). |

---

## 5. Architecture (as it will be built)

| Layer | Technology | Notes |
|---|---|---|
| App | **Next.js 16** (App Router, TS, Tailwind) | harvested from the unified codebase |
| Hosting | **Vercel** (new, dedicated project) | domain `app.singularweb.ai` from day one |
| Data | **Supabase** (new, dedicated, EU) | the unified schema (0001–0013); RLS-ready, RLS off (single-tenant) |
| Auth | **Auth0** | `agency_admin` / `client` roles; clients use a link (no login), per the source design |
| Ads | **Google Ads API v24** | WMI dev token + WMI MCC login id + WMI refresh token |
| Payments | **WMI Stripe** | recurring subscription checkout (see §9 open item on "invoicing" wording) |
| Contracts | **WMI DocuSign** | replaces PandaDoc — the new integration |
| Comms | **WMI Slack** | client channels + weekly report drafts |
| AI | **Anthropic (Claude Opus 4.8)** | weekly narrative; numbers from the data layer, AI only words them |
| Orchestration | **none (Next.js + Vercel cron)** | no n8n, no Redis for v1 |

---

## 6. Feature inventory — what the harvest brings for free

All already built in the source codebase; carried into SingularWeb as-is (re-pointed
at WMI creds, rebranded):

- **Onboarding funnel:** details → contract → payment → Slack → questionnaire →
  access-grant checklist (GA4, GTM, GSC, GMC, Meta-by-Business-Manager-ID,
  Microsoft Ads account number).
- **Reporting:** Google Ads performance dashboard (KPIs, trend, breakdowns, "this
  week"), per-account currency, quota-protecting cache.
- **Weekly reports:** 5-section LLM narrative (Top Converting Campaigns /
  Performance Summary / Optimisations Made / Campaign Insights / Forward Plan) from
  verified data + change history, posted as a Slack review draft with a dashboard
  link; bounded-concurrency cron (scales to ~40 accounts).
- **MCC management:** "Add managed account" + bulk **"Import from MCC"** (one-click
  import of all leaf accounts under the MCC); reporting-only clients.
- **Admin:** client book with search + Google Ads ID column; client detail with
  journey, activity log; **client delete** (type-DELETE); **subscription lifecycle**
  (payment-failure dunning + 31-day-notice cancellation + resume).
- **Pricing:** custom monthly price per client (bespoke), ad-hoc Stripe price.
- **Multi-deployment by env flag** (the mechanism this whole project relies on).

**Changes on harvest:** PandaDoc → DocuSign; all credentials → WMI's; brand →
SingularWeb; `PORTAL_REPORTING_ONLY` off (both halves visible); domain →
`app.singularweb.ai`.

---

## 7. The one real build — DocuSign integration

Replacing PandaDoc is the substantive engineering. Scope:
- Auth: DocuSign OAuth (JWT or auth-code) with the WMI integration key.
- Create an **envelope** from a template (or composed document) filled from the
  client record (company, contact, plan name, monthly price, date).
- **Embedded signing** via a recipient view (returned into the wizard iframe),
  mirroring the current PandaDoc embedded flow.
- Completion via **DocuSign Connect webhook** (HMAC-verified) + a status-check
  fallback (same dual-path pattern the source uses for PandaDoc/Stripe).
- Behind the existing contract seam (one module), so the rest of the funnel is
  unchanged.

Open input needed: DocuSign account + integration key; whether a template exists
or the document is built with anchor tabs.

---

## 8. Build sequence (adapted to the one-codebase reality)

1. **Scaffold** — new WMI repo (harvest the unified codebase), new Supabase (run
   the consolidated schema), new Vercel project; wire WMI env with
   `APP_BASE_URL=https://app.singularweb.ai` and all callbacks/webhooks against it.
2. **Rebrand** to SingularWeb (env `BRAND_NAME`, logo) and run in full mode.
3. **DocuSign** — replace the PandaDoc module; wire Connect webhook.
4. **WMI Google** — set token/OAuth/MCC login id; **verify it reaches WMI's
   accounts** (same enumeration check used before).
5. **WMI Stripe + Slack + Anthropic** — env + webhooks.
6. **Bark.com UK path** — onboard → manage → report end-to-end.
7. **Test** against a real low-budget UK prospect.

---

## 9. Prerequisites / credentials checklist (WMI)

- [ ] New **WMI GitHub repo** (e.g. `singularweb`)
- [ ] **Google Ads:** dev token, OAuth client id/secret, **WMI MCC `login-customer-id`**, refresh token (generated by a WMI-MCC admin)
- [ ] **DocuSign:** account + integration key (+ template?)
- [ ] **Stripe** (WMI) secret key + webhook
- [ ] **Slack** (WMI) bot token + scopes
- [ ] **Anthropic** API key (WMI)
- [ ] **Supabase** new project (EU) — schema provided by the build
- [ ] **DNS:** `app.singularweb.ai` (+ `singularweb.ai`) — WMI-controlled

---

## 10. Definition of done (v1)

On its own Vercel deployment (`app.singularweb.ai`) + Supabase project, on WMI's
credentials:
1. Onboard a Bark.com UK prospect end-to-end — questionnaire, access requests,
   account connections, **DocuSign** contract, **WMI Stripe** invoice.
2. Import + manage existing MCC clients (Command Center parity).
3. Generate reports + dashboards across the book.
4. Deliver reports to internal and/or client Slack channels.
5. All on one unified schema — **no Redis, no multi-tenant layer, no campaign
   builder.**

---

## 11. Risks & open items

- **DocuSign integration** is the main effort + the main unknown (account tier,
  Connect webhook setup, template vs anchor tabs).
- **WMI Google reachability** — must verify the WMI token + refresh token actually
  reach WMI's MCC/accounts before relying on reporting (a prior check showed the BJ
  creds reach *no* WMI MCC, confirming these are a genuinely separate set).
- **Domain lock** — `app.singularweb.ai` must be set before the first OAuth/Stripe
  wiring; late changes disturb Google config.
- **"Invoicing" wording** — the source does recurring **subscription** checkout; if
  WMI means one-off Stripe *invoices*, that's a small code change to confirm.
- **IP provenance** — keep the harvest clean and attributable (for the future
  knowledge loop back into PPC Mastery and any EU-grant IP claim).
- **Fork divergence** — SingularWeb won't auto-inherit PPC Mastery fixes; accepted.

---

## 12. Governance

WMI project, Antoine alone, move fast. Source apps untouched (clean-room harvest).
Documented and governed **separately** from PPC Mastery (membrane discipline).

---

## 13. Validation sign-off

Confirm each before scaffolding:
- [ ] Scope (§2) and scope walls (§4 D7/D8) match intent
- [x] No n8n for v1 (D5) — **confirmed**
- [x] Google Ads v24 (D6) — **confirmed**
- [x] DocuSign replaces PandaDoc (D3) — **confirmed**
- [x] Name/domain SingularWeb / app.singularweb.ai (D2) — **confirmed**
- [ ] Clean-room WMI repo created
- [ ] Credentials gathered (§9)

*V4alpha (SingularWeb · app.singularweb.ai) — Build Validation Report — WMI — June 2026*

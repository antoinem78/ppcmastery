# Build Brief — V4alpha (SingularWeb)
**For:** Claude Code
**From:** Antoine Martin (WMI)
**Date:** June 2026
**Status:** Build kickoff brief and single source of truth for the V4alpha build. If anything here conflicts with assumptions from prior sessions, **this document wins.**

> **Naming note (read once):** Earlier drafts called this product "Rexos / rexos.ai." That is parked. The product is **SingularWeb**, deployed at **app.singularweb.ai**. Reasons: (1) the Google developer token was approved under the **SingularWeb** application identity — the running product must carry that name so the product, domain, and Google paperwork all match; (2) "Rexos" is a name for a future product that doesn't exist yet — don't spend it now. The rexos.ai domain is held in reserve (see §8). Wherever you find "Rexos" in any prior note, treat it as "SingularWeb."

---

## 0. How to read this brief

You (Claude Code) already have the context of two applications we built together:

1. **PPC Mastery MaaS frontend** — the onboarding + reporting platform.
2. **BJ PPC MCC Command Center** — the internal MCC-management tool, cloned from the PPC Mastery codebase.

This brief tells you how to **merge those two into one new application** called **SingularWeb (app.singularweb.ai)**, what it must do, whose credentials it runs on, and the boundaries to respect. Read it fully before writing a line of code. When you start a build session, anchor here: *"We are building V4alpha (SingularWeb) per the build brief. I'm on [section]. Walk me through it."*

**Discipline rule:** when a decision feels obvious, slow down and check it against this brief. When you're inside a documented step, move fast. If you want to add a capability not in this brief, **stop and ask** — scope creep is the main risk.

---

## 1. The context — what we already have

### 1.1 PPC Mastery MaaS frontend (owned by Antoine Martin + Baptiste Jénard)
A live Next.js app on its own Vercel deployment, its own Supabase project. Capabilities:
- **Onboarding tool** — questionnaire, access requests, account connections.
- **Reporting tool** — automated client performance reporting.

This is the root product codebase. It is not derived from a template above it.

### 1.2 BJ PPC MCC Command Center (owned by Baptiste Jénard MCC)
A separate Vercel app, **cloned from** the PPC Mastery codebase but a distinct product belonging to Baptiste Jénard MCC. Internal tool to **manage existing clients within the MCC**:
- Bulk import / management of existing MCC client accounts (one-click import from the manager account).
- Reporting and dashboards across the existing client book.
- Slack delivery of reports into internal and/or client channels.

### 1.3 Why we merge them
PPC Mastery MaaS **onboards new clients**. The Command Center **manages and reports on existing clients**. V4alpha brings both halves of the client lifecycle — acquisition/onboarding AND ongoing management/reporting — into one application.

---

## 2. What we are building — V4alpha (SingularWeb)

### 2.1 One-sentence definition
**V4alpha is a single Next.js application — SingularWeb, deployed at app.singularweb.ai — that merges the PPC Mastery MaaS frontend and the BJ PPC MCC Command Center into one tool, running entirely on WMI's own credentials, used first to onboard and manage low-budget UK prospects sourced from Bark.com.**

### 2.2 What it must do (functional scope)

**From the PPC Mastery MaaS frontend:**
- Client onboarding flow (questionnaire, access requests, account connections).
- Invoicing.
- Everything else the MaaS frontend currently does.

**From the BJ PPC MCC Command Center:**
- Manage existing MCC clients (import, view, organise).
- Create reports and dashboards.
- Send reports into internal and/or client Slack channels.

V4alpha = the union of both, in a single coherent app and deployment.

### 2.3 What it is NOT (scope walls)
- **Not multi-tenant SaaS.** Single-tenant: runs on WMI's own credentials for WMI's own use. It does NOT let external agencies plug in their own Google tokens. (That's PPC Mastery's V4a/V4b problem, blocked on a SaaS-privileged Google token we don't have. V4alpha sidesteps it by being WMI-only.)
- **Not the campaign builder (yet).** The campaign-builder POC is banked for later. Do not pull it in unless explicitly instructed.
- **Not the full SingularWeb "monster" (yet).** V4alpha is the early/lite SingularWeb. The full product (auditing, optimisation, deep management, deeper SingularWeb-substrate integration) grows out of V4alpha later. Build V4alpha to be the foundation that grows; do NOT build the monster's features now.

### 2.4 Its first real job
Onboard the **low-budget UK prospects identified on Bark.com**, then manage and report on them. Build for this use case first; generalise later.

### 2.5 Why it matters strategically (context only — do not build for this)
V4alpha is WMI's **laboratory**. What's proven and polished here informs the PPC Mastery SaaS (V4a/V4b), and PPC Mastery's existing code seeds V4alpha. The loop runs both ways. Nothing to build for this — just know clean structure here pays off twice.

---

## 2.6 Naming & domains (decisions — do not improvise)
- **Product name:** SingularWeb. (SingularWeb the *substrate/Matrix* surfacing as a customer-facing product — coherent, not a conflict.)
- **App domain:** **app.singularweb.ai** — the running application. Chosen over `portal.` deliberately: this app will grow beyond onboarding/reporting into the full product, and `app.` stays accurate forever, whereas `portal.` would force a painful domain migration later (breaking OAuth redirect URIs, Stripe webhooks, Google callback config).
- **Marketing/identity site:** singularweb.ai — matches the identity Google reviewed for the token.
- **Held in reserve:** rexos.ai — a possible future brand if the monster ever wants an identity distinct from SingularWeb. Not used now.
- **CRITICAL for the build:** the chosen domain gets baked into Google OAuth redirect URIs / authorized origins, the Stripe webhook URL, and any Google app config. **Decide and use `app.singularweb.ai` from the first wiring** — changing it later means re-registering with Google and disturbing the token config, which we avoid. Lock the domain before the first OAuth callback is wired.

---

## 3. Credentials & integrations — WMI's own stack
Runs entirely on **WMI's own credentials**. No third-party founder credentials, no external keys to chase. This is what lets us move fast.

| Integration | Account | Notes |
|---|---|---|
| Google Ads API | **WMI's Google dev token** | The token granted to the **WMI MCC for the SingularWeb application**. Single-tenant use under WMI's own MCC — no external-agency token sharing. The running product is named SingularWeb to match this approved application identity. |
| Payments | **WMI's Stripe account** | For invoicing. |
| Notifications | **WMI's Slack** | Internal and client channels for report delivery. |
| Contracts / e-sign | **WMI's DocuSign** | **NOT PandaDoc.** The PPC Mastery MaaS source may reference PandaDoc — replace with DocuSign in V4alpha. |

**Action for the build:** wherever the source apps wire PandaDoc, swap to DocuSign. Wherever they reference a non-WMI Google token / Stripe / Slack, point to WMI's.

---

## 4. Technical architecture

### 4.1 The stack
| Layer | Technology | Role |
|---|---|---|
| Frontend / app | Next.js | The merged onboarding + management + reporting app. |
| Hosting | Vercel | Its own dedicated deployment (a NEW app, not a redeploy of either source). Domain: app.singularweb.ai. |
| Data spine | Supabase | A **dedicated V4alpha Supabase project** — own data, own access, EU region. Do NOT share a Supabase project with the source apps. |
| Orchestration | n8n + Postgres | For workflow/automation (reporting jobs, Slack delivery, Ads API calls). Router + Worker pattern where async work is needed. |
| Ads API | Google Ads API v20 | WMI's Developer Token + OAuth2. Reuse the proven v20 fixes (4.3). |
| AI layer | Claude / GPT | Report narrative/analysis. Never executes side effects directly; output passes through review. Numbers come from the data layer; AI only words them. |

### 4.2 Explicitly NOT in the stack
- **No Redis.** It was POC scaffolding for n8n queue mode at a scale we're not at. n8n runs regular mode on Postgres alone. Reintroduce only if real concurrency later forces it (a config change, not architecture).
- **No multi-tenant auth layer.** Single-tenant, WMI-only. No tenant isolation, no per-tenant credential resolution, no self-serve signup.

### 4.3 Reuse the proven Google Ads API v20 fixes
- Inject the developer token as an explicit header on HTTP nodes (works around the n8n credential-injection bug).
- Build payloads with `Object.assign()`, not JS spreads (n8n truncates expressions containing `}}`).
- Budget creation needs a `name` field and `explicitlyShared: false`.
- Language targeting via `campaignCriteria:mutate` (`languageConstants` is read-only on Campaign in v20).
- Include a bidding strategy (`manualCpc`) where required.
- Include `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` where required (mandatory since April 2026).
- Wire explicit back-references via `$('Node').first().json` so downstream nodes keep earlier data.

---

## 5. The merge plan — how to build it

### 5.1 Start fresh, harvest from both
Create a **new Next.js app** with its own Vercel deployment and its own Supabase project. **Do not edit either source app in place** — both belong to other parties (PPC Mastery MaaS = Antoine + Baptiste; Command Center = Baptiste Jénard MCC) and must remain untouched. V4alpha is WMI's clean-room merge that harvests from both.

### 5.2 Suggested build sequence
1. **Scaffold** the new Next.js app + Vercel deployment + dedicated Supabase project (EU). Wire WMI's credentials (Google dev token, Stripe, Slack, DocuSign) as env vars. Set the domain to app.singularweb.ai and configure OAuth redirect URIs / Stripe webhook against it from the start.
2. **Port the onboarding flow** from the MaaS frontend. Swap PandaDoc → DocuSign. Point Stripe at WMI's account.
3. **Port the reporting tool** from the MaaS frontend.
4. **Port the MCC management capability** from the Command Center — existing-client import, management views.
5. **Port dashboards + Slack delivery** from the Command Center — reports to internal and/or client Slack channels (WMI's Slack).
6. **Reconcile the two data models** into the single V4alpha Supabase schema. The real merge work — unify overlapping tables (clients, reports) into one canonical shape; keep a single source of truth.
7. **Wire the Bark.com UK onboarding use case** as the first end-to-end path: prospect → onboard → manage → report.
8. **Test end-to-end** against a real low-budget UK prospect workflow.

### 5.3 Hardest part — flag early
The two source apps share a codebase ancestry, so much will align. The work needing care is **unifying the data model** — where onboarding-side and management-side tables overlap, decide one canonical shape rather than carrying both. Surface schema conflicts early; resolve them deliberately; don't paper over them.

---

## 6. Boundaries & governance
- **V4alpha is a WMI project, governed by Antoine alone.** No three-founder coordination needed. Move fast.
- **Do not modify the two source apps.** Harvest; leave intact. They belong to other parties.
- **IP provenance — note for later, not a blocker now.** V4alpha harvests from PPC Mastery MaaS (Antoine + Baptiste) and the Command Center (Baptiste Jénard MCC). When polished V4alpha code later flows back into the PPC Mastery SaaS, "whose code is whose" must be answered cleanly before any EU grant leans on "PPC Mastery owns all its IP." Keep the build clean and well-structured so provenance is traceable. Record-keeping discipline, not a build blocker.
- **Membrane discipline.** V4alpha (WMI / SingularWeb) is documented and governed separately from PPC Mastery (the Polish SaaS entity). Don't let V4alpha decisions bleed into PPC Mastery's roadmap or vice versa, beyond the deliberate knowledge loop.

---

## 7. Definition of done for V4alpha v1
On its own Vercel deployment (app.singularweb.ai) with its own Supabase project, running on WMI's credentials, it can:
1. Onboard a new (Bark.com UK) prospect end-to-end — questionnaire, access requests, account connections, **DocuSign** contract, **WMI Stripe** invoice.
2. Import and manage existing MCC clients (Command Center parity).
3. Generate reports and dashboards across the client book.
4. Deliver reports into internal and/or client Slack channels.
5. Do all of the above on a single unified Supabase schema, with **no Redis, no multi-tenant layer, no campaign builder.**

When that's true, V4alpha is the operational lab — and the basis from which the full SingularWeb product grows.

---

## 8. What comes after V4alpha (context only — do not build)
- **The full SingularWeb product grows from V4alpha** into reporting / auditing / management / **optimisation**, built with marketing agencies in mind, integrated into the SingularWeb substrate. WMI-internal tool, **not sold as SaaS**.
- **rexos.ai held in reserve** — if that monster ever wants a brand distinct from SingularWeb, the domain is owned and waiting. A deliberate future decision, not a default.
- **PPC Mastery SaaS (V4a/V4b)** — separately-owned, for-sale product — benefits from everything proven here. Different build, different entity, different brief.

Build V4alpha clean and modular so both futures are cheap to reach. **But build only V4alpha now.**

---

*V4alpha (SingularWeb · app.singularweb.ai) — Build Brief for Claude Code — WMI — June 2026*

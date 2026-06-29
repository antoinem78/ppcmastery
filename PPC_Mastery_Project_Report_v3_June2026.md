# PPC Mastery — Project Understanding & Strategic Report
**June 2026 · Confidential · v3**

> **What it is** — A standalone B2B SaaS for digital agencies. The live product is a client onboarding + reporting platform; the roadmap adds campaign management, account auditing, alerts, and a campaign builder — growing into an Optmyzr/Opteo-class PPC platform. Built by Antoine Martin and Thierry Zdun with Baptiste Jénard (commercial). Poland-incorporated for EU grant eligibility.
>
> **The stack** — Next.js + Vercel + Supabase, with n8n + Postgres for orchestration. The frontend is live on its own deployment. The fork-and-deploy pattern is already proven (the BJ PPC MCC Command Center is a fork of this codebase).
>
> **Where it goes** — V4a white-labels the platform for other agencies. V4b adds management/auditing/alerts (folding in the proven campaign-builder POC) and integrates with SingularWeb as its PPC module. Standalone throughout.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Product & Its Roadmap](#2-the-product--its-roadmap)
3. [Technical Architecture](#3-technical-architecture)
4. [Current Build Status](#4-current-build-status)
5. [Company, Team & Funding](#5-company-team--funding)
6. [EU Grant — Eligibility & Infrastructure](#6-eu-grant--eligibility--infrastructure)
7. [The SingularWeb Relationship](#7-the-singularweb-relationship)
8. [Priorities & Snapshot](#8-priorities--snapshot)

---

## 1. Executive Summary

PPC Mastery is a standalone B2B SaaS platform for digital agencies. The product that exists and is live today is a client onboarding and reporting platform — a Next.js application with its own deployment. Its roadmap extends it into a full PPC management, audit, and reporting product (the class of tool occupied by Optmyzr and Opteo), including a campaign builder whose pipeline has already been proven in a separate proof of concept.

The platform is built on a Next.js + Vercel + Supabase stack, with n8n + Postgres handling orchestration. The team has already demonstrated that this codebase forks and deploys cleanly: the BJ PPC MCC Command Center — an internal tool to manage existing clients in the MCC — is a fork of the PPC Mastery codebase running as its own Vercel app. That proven fork-and-deploy pattern is the mechanism for the white-label roadmap.

The company will be incorporated in Poland, chosen to support a €1,000,000 EU grant application. Billing runs through Baptiste Jénard PPC for the primary product, with a planned UK-friendly version billed through WMI (Antoine Martin's company).

The product is built by Antoine Martin and Thierry Zdun, with Baptiste Jénard as commercial co-founder. Early-stage development is led by Antoine working with Claude Code; Thierry shares the workload as the build matures. The realistic future technical need is a developer to review and debug an AI-built system, not to build it from scratch.

Separately and in parallel, PPC Mastery is the agreed PPC module for SingularWeb — an AI-Powered Growth Operating System (first product: Rexos) being built by Antoine as a separate UK company. That relationship is a reversible, staged commercial integration between two separate companies; PPC Mastery remains standalone throughout. SingularWeb is deliberately kept out of the grant-facing narrative.

| | |
|---|---|
| **Incorporation** | Poland (planned) |
| **Live product** | Onboarding + reporting |
| **Funding** | €1M EU grant (in preparation) |
| **Stack** | Next.js · Vercel · Supabase · n8n |

---

## 2. The Product & Its Roadmap

### 2.1 What Exists Today

The PPC Mastery MaaS frontend is live on its own deployment. Its built-in capabilities are two:

- **Onboarding tool** — guides a new agency client through the setup process (questionnaire, access requests, account connections).
- **Reporting tool** — automated client performance reporting.

*This is the foundation codebase. It is not derived from any template above it — it is itself the root of the product.*

### 2.2 Proven Pattern — The Command Center Fork

The BJ PPC MCC Command Center is an internal tool used to manage existing clients within the MCC. It was built by forking the PPC Mastery codebase into its own separate Vercel app. This matters strategically: it is live proof that the codebase forks and deploys cleanly into a standalone instance — which is exactly the mechanism the white-label roadmap (V4a) depends on. The team has already done this move once, internally, successfully.

### 2.3 The Roadmap — V4a and V4b

| Phase | What it is | Detail |
|---|---|---|
| **Today** | Onboarding + reporting | Live product on its own deployment. The foundation codebase. |
| **V4a** | White-label for other agencies | Clone the PPC Mastery frontend and white-label it so another agency runs it as their own product. Multi-tenant / white-label SaaS. Uses the proven fork-and-deploy pattern. |
| **V4b** | Expand + integrate | Add campaign management, account auditing, alerts, and the campaign builder (folding in the proven POC logic + n8n publish workflows). Then integrate with SingularWeb as its PPC module. |

Across both phases the destination is an Optmyzr/Opteo-class PPC platform: not just building campaigns, but managing, auditing, alerting on, and reporting across an agency's whole book of accounts. The campaign builder is one capability inside that, added at V4b.

### 2.4 Who It Is For

The ideal customer is a digital agency that needs the onboarding and reporting platform now and the management/auditing/alerts layer as it grows — one buyer across one continuous workflow. V4a extends this to agencies who want to run the platform under their own brand. Freelancers and PPC-capable SMEs are adjacent buyers.

---

## 3. Technical Architecture

### 3.1 The Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend / app | Next.js | The PPC Mastery MaaS application — onboarding + reporting, with V4a/V4b building on the same codebase. Forks cleanly (proven by the Command Center). |
| Hosting | Vercel | Each instance is its own Vercel deployment (the product app; the internal Command Center; future white-label clones). |
| Data spine | Supabase | Dedicated PPC Mastery Supabase project — separate data, access, region. Clean separation already in place. |
| Orchestration | n8n + Postgres | Receives campaign JSON via webhook, validates, queues jobs, executes Google Ads API calls. Router + Worker pattern. No Redis (see 3.3). |
| Ads API | Google Ads API v20 | Official API, Developer Token + OAuth2 via sequential HTTP calls. Test-mode token today; production token pending. |
| AI layer | Claude / GPT | Ad-copy generation and (in V4b) auditing/optimization reasoning. Never publishes directly — output passes through human review. |

### 3.2 The Campaign-Builder POC (Banked for V4b)

A separate proof of concept proved the campaign-builder pipeline end to end: a wizard produces a structured campaign which is published automatically to a Google Ads test account as a PAUSED campaign. Three test campaigns were created this way. The POC was built on React + Zustand (on Lovable) with n8n workflows behind it.

**The POC is not discarded.** Its proven logic — SKAG/STAG structuring, the 6-call publish sequence, the Google Ads API v20 fixes — and its n8n workflows are banked and folded into the PPC Mastery platform at V4b, when the campaign builder is added. The Lovable/React frontend itself is a prototype shell; the value carried forward is the pipeline logic and the workflows, rebuilt natively in the Next.js app.

### 3.3 On Redis

Redis appeared in the POC because n8n's queue mode uses it for distributed multi-worker execution. At PPC Mastery's scale — a single instance, jobs arriving at a modest rate, a 30-second poll — n8n runs fine in regular mode on Postgres alone. Redis is dropped. It can be reintroduced later as a configuration change if real concurrency ever demands it; it is not an architectural commitment.

### 3.4 The n8n Workflows (from the POC)

- **[Router] Publish Search Campaign** — validates the campaign payload, computes an idempotency key (no duplicates on retry), queues a job, returns a jobId immediately.
- **[Worker] Publish Search Campaign** — polls, transforms the payload, makes 6 sequential Google Ads API calls (budget → campaign → locations → ad groups → keywords → ads), marks success/failed. Campaigns land PAUSED for human review.
- **[Router] Job Status** — polling endpoint for queued / processing / success / failed.

### 3.5 Problems Already Solved in the POC

| Issue | Resolution |
|---|---|
| Credentials dropped on worker runs | n8n credential-injection bug; injected the developer token as an explicit header on all HTTP nodes. |
| Parsing breaks on JS spreads | n8n truncates expressions containing `}}`; rewrote payloads using `Object.assign()`. |
| v20 budget rejection | Added `name` field and `explicitlyShared: false`. |
| Language targeting rejection | `languageConstants` read-only on Campaign in v20; moved to `campaignCriteria:mutate`. |
| Missing bidding strategy | v20 requires one; added `manualCpc`. |
| EU political advertising rejection | Added `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` (required since April 2026). |
| Nodes losing earlier data | Wired explicit back-references via `$('Node').first().json`. |

---

## 4. Current Build Status

| Component | Status | Detail |
|---|---|---|
| PPC Mastery MaaS frontend (Next.js) | ✅ LIVE | Own Vercel deployment. Onboarding + reporting built in. |
| Onboarding tool | ✅ DONE | Built into the frontend. |
| Reporting tool | ✅ DONE | Built into the frontend. |
| Dedicated Supabase project | ✅ DONE | Separate data/access/region — clean. |
| BJ PPC MCC Command Center | ✅ LIVE | Internal MCC-management tool; fork of the codebase on its own Vercel app. Proves the fork pattern. |
| Campaign-builder pipeline (POC) | ✅ PROVEN | 3 PAUSED test campaigns published to the Google Ads test account via n8n. |
| n8n publish workflows | ✅ DONE | Router / Worker / Job Status; 6 API calls working. |
| Idempotency + error handling | ✅ DONE | No duplicates on retry; full error capture. |
| Own n8n instance (EU, PPC Mastery-owned) | ⚠️ ACTION | Workflows currently in a shared account — separate before grant (Section 6). |
| Production Google Ads developer token | ❌ PENDING | Requires Google application + review; long lead time. |
| Multi-tenant / white-label (V4a) | ❌ NOT BUILT | Clone + white-label the frontend for other agencies. |
| Campaign management / auditing / alerts (V4b) | ❌ FUTURE | The Optmyzr/Opteo-class layer. |
| Campaign builder folded into platform (V4b) | ❌ FUTURE | POC logic + n8n workflows rebuilt natively in Next.js. |
| SingularWeb integration (V4b) | ❌ FUTURE | PPC module via the four-stage path (Section 7). |

---

## 5. Company, Team & Funding

### 5.1 Entity & Billing

PPC Mastery will be incorporated in Poland, chosen to support a €1,000,000 EU grant application — a Poland-based SME is eligible for EU and Polish national programmes a UK entity is not.

- **Primary billing entity:** Baptiste Jénard PPC (Baptiste's company).
- **Planned UK-friendly version:** billed through WMI (Antoine Martin's company).

*WMI is Antoine's company; Baptiste Jénard PPC / adenergy is Baptiste's partner agency. Two separate companies.*

### 5.2 Team

**Antoine Martin — Product & development lead.** PPC expert (Google Ads, Meta Ads, automation, tracking). Leads development with Claude Code. Also founder of SingularWeb (separate company).

**Thierry Zdun — Development & performance.** Business analyst (data analysis, performance frameworks). Shares the build as it matures; drives reporting and quality logic.

**Baptiste Jénard — Commercial co-founder.** Multi-platform advertising expert (Google, Microsoft, Meta). Primary billing entity. Commercial and go-to-market strength; deep agency relationships.

### 5.3 Technical Resourcing

Development is being done by the founders with Claude Code, moving quickly on the existing Next.js codebase. The realistic future need is a developer to **review and debug** an AI-built system — not to build from scratch. That is a lower-risk, lower-cost dependency, engaged when the system is mature enough to warrant review.

### 5.4 EU Grant

A €1,000,000 EU grant application is in preparation, predicated on Poland incorporation. Funding accelerates the move from the live onboarding+reporting product to the full platform (V4a white-label, V4b management/auditing/alerts + builder) and European market entry. Section 6 covers eligibility and the action items that protect the application.

---

## 6. EU Grant — Eligibility & Infrastructure

### 6.1 Eligibility Considerations

The grant attaches to the applicant entity — a Poland-incorporated PPC Mastery doing its development in the EU. A commercial relationship with a UK company (SingularWeb) is not a disqualifier. The risks to manage are specific and mostly already mitigated.

| Risk | Why it matters | Mitigation (status) |
|---|---|---|
| Genuine establishment & autonomy | Grants fund real EU businesses, not non-EU-dependent shells. | Standalone product, own deployment, own data, own buyers. Autonomy is grant-protective. **(Strong)** |
| IP ownership | EU should not fund R&D whose value flows to a non-EU entity. | PPC Mastery owns its code, logic, brand. Keep all grant-funded IP in the Polish company. **(Strong, maintain)** |
| Linked-enterprise / SME status | Antoine's cross-shareholding in both companies may affect SME classification and aid ceilings under state-aid rules. | Get advisor input before incorporation. The one item that genuinely needs a professional. **(To do)** |
| Infrastructure dependency | Core product on non-EU-controlled infrastructure undercuts autonomy. | Vercel + Supabase: PPC Mastery-owned. n8n: shared account — separate it. **(6.3)** |

*This maps where to look; it is not legal advice. Polish (PARP / EU-fund) rules are programme-specific and change. Confirm against the programme criteria and, for SME/linked-enterprise status, with a grant advisor.*

### What IP means here

IP (intellectual property) is the intangible value the business owns: the **code** (the Next.js app, n8n workflows, campaign logic — copyright); the **encoded expert rules and optimization logic** (trade secret — the real moat); the **brand** "PPC Mastery" (trademark); and the **system design and know-how**. Rule: whatever PPC Mastery builds with grant money, PPC Mastery owns — codebase, logic, and brand stay inside the Polish company.

### 6.2 Infrastructure Ownership — The Consistent Pattern

The autonomy story holds when every layer is owned by the PPC Mastery entity, EU-region. The frontend (Vercel) and data (Supabase) already follow this. The one outstanding layer is n8n.

| Layer | Status | Note |
|---|---|---|
| **Vercel (app)** | ✅ Own deployment | PPC Mastery frontend on its own Vercel app. |
| **Supabase (data)** | ✅ Separate project | Own data, access, region. Clean. |
| **n8n (orchestration)** | ⚠️ Shared account | Workflows cloned from other projects but living in a shared account. Cloning is fine; the shared account is the dependency to remove. |

### 6.3 Action — Separate the n8n Instance

> **Move PPC Mastery's n8n workflows to a dedicated EU-region n8n instance owned by and billed to the PPC Mastery (Poland) entity. Same workflows, separate instance — the same pattern already used for Vercel and Supabase.**

Why it matters: the n8n account holds credentials (OAuth tokens, the developer token, the Postgres connection), processes the data, and is owned by whoever owns the account. A shared account means the core engine runs on infrastructure PPC Mastery does not control — which weakens both the grant autonomy test and GDPR controller clarity (the OAuth tokens act on client Google Ads accounts).

**Two routes:**

- **Route A — n8n Cloud, separate EU account.** Sign up under PPC Mastery billing, EU region, import the workflows. ~€20–50/month, no servers. Recommended now.
- **Route B — self-hosted n8n on an EU server** (Hetzner DE/FI). ~€5–15/month, full control, strongest autonomy story. More setup; a later optimization, not a blocker.

**Migration steps:**

1. Export each workflow as JSON (Router, Worker, Job Status).
2. Stand up the new PPC-Mastery-owned EU instance.
3. Import the JSON workflows.
4. **Recreate credentials fresh — do NOT export them** (they're encrypted to the old instance's key). Re-enter the Postgres credential (PPC Mastery Supabase) and a fresh Google Ads OAuth, held by PPC Mastery.
5. Re-point Postgres nodes at the PPC Mastery Supabase project.
6. Update the webhook URLs the frontend will call.
7. Test end-to-end: insert a job, confirm a PAUSED campaign in the test account.
8. Disable (don't delete) the old workflows once proven; remove after a few clean runs.

*Trivial now with three test campaigns and clonable workflows; a credentials-and-live-data migration later. Log it in the decisions record with date and rationale (autonomy + grant + GDPR, reversible).*

---

## 7. The SingularWeb Relationship

*Internal clarity only. Kept out of the grant-facing narrative, where PPC Mastery is the standalone Poland SME it genuinely is.*

### 7.1 What SingularWeb Is

A separate company (UK Ltd, UK brand; trademark filed under Antoine personally; WMI as billing entity for now) building an AI-Powered Growth Operating System. First product: Rexos, a Marketing-as-a-Service module. Currently pre-build and pre-revenue — strategy and architecture committed, no product shipped, no paying customers. (Rexos is not live.)

### 7.2 How PPC Mastery Fits

Rexos excludes paid-acquisition capability from its v1 and will not build PPC management itself. PPC Mastery becomes Rexos's PPC module — a separate company joining via commercial integration, standalone throughout. This happens at PPC Mastery's V4b.

### 7.3 The Four-Stage Integration (Agreed Direction; Terms TBD)

All three PPC Mastery founders agree on this direction. Terms at each stage are still to be set. Reversibility is preserved at every stage.

| Stage | Timing | Shape |
|---|---|---|
| **1** | Through Q3 2026 | Fully separate companies; each proves standalone PMF. Cross-promotion only. ACTIVE. |
| **2** | Q4 2026 / Q1 2027 | API-level loose coupling. A "Connect PPC Mastery" button in the Rexos portal; two billing relationships; each keeps its own auth/data/DPA. |
| **3** | Q2 2027+ | PPC Mastery as Rexos's white-labelled PPC module. Single dashboard/billing/brand for the Rexos buyer; PPC Mastery still standalone for direct buyers. Wholesale 40–60% (TBD). |
| **4** | Q3 2027+ | Only if justified: full merger (with equity treatment for all shareholders) or sister companies indefinitely. Decision on data not yet available. |

*Note: PPC Mastery and SingularWeb share architectural patterns (Next.js, Supabase, n8n) but not instances. Same design taste, separate owned deployments. That is what keeps the integration genuinely reversible and the grant autonomy intact.*

---

## 8. Priorities & Snapshot

### 8.1 Near-Term Critical Path

| # | Action | Why |
|---|---|---|
| 1 | Separate PPC Mastery n8n to a dedicated EU instance | Completes the owned-infrastructure pattern (Vercel + Supabase already done). Grant autonomy + GDPR. (Section 6) |
| 2 | Advisor input on linked-enterprise / SME status | Antoine's cross-shareholding affects aid ceilings. Resolve before incorporation. |
| 3 | Apply for Google production developer token | Longest external lead time; blocks real-customer campaign publishing. |
| 4 | Get first paying agencies on onboarding + reporting | Revenue validates the product and strengthens the grant application. |
| 5 | Build V4a (white-label clone) for a first external agency | Uses the proven fork pattern; opens the SaaS/white-label revenue line. |
| 6 | Begin V4b: fold the campaign builder (POC logic + n8n) into the platform | Moves toward the Optmyzr/Opteo-class destination. |
| 7 | Validate management/auditing/alerts demand with agencies | Confirm the recurring-value layer is the pull, not just onboarding/reporting. |

### 8.2 Snapshot

| | |
|---|---|
| **Product** | PPC Mastery — agency onboarding + reporting platform (live), growing into a full PPC management/audit/reporting platform (Optmyzr/Opteo-class). |
| **Live today** | Onboarding tool + reporting tool, on their own Next.js/Vercel deployment. |
| **Proven pattern** | BJ PPC MCC Command Center — internal MCC tool, a clean fork of the codebase on its own Vercel app. |
| **Roadmap** | V4a = white-label clone for other agencies. V4b = campaign management + auditing + alerts + campaign builder (POC folded in) + SingularWeb integration. |
| **Stack** | Next.js · Vercel · Supabase · n8n + Postgres. No Redis. |
| **POC** | Campaign-builder pipeline proven (3 PAUSED test campaigns); banked for V4b — logic + n8n workflows, not the Lovable shell. |
| **Entity** | Poland (planned), for EU grant. Billing: Baptiste Jénard PPC; WMI for the UK version. |
| **Team** | Antoine (dev lead, Claude Code) + Thierry (dev/performance) + Baptiste (commercial). Review/debug developer later. |
| **Funding** | €1M EU grant in preparation. |
| **Infra ownership** | Vercel + Supabase owned. n8n to be separated before grant. |
| **Biggest external blocker** | Production Google Ads developer token. |
| **Biggest strength** | Live product + proven fork pattern + working API pipeline + AI-accelerated build on one coherent stack. |

---

*PPC Mastery · Project Understanding & Strategic Report · June 2026 · Confidential · v3*

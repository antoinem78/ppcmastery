# SingularWeb Workspace — Orientation Brief
**Workspace:** WMI / SingularWeb (a different machine, a different project)
**Owner:** WMI — governed by Antoine Martin alone
**Purpose:** bring this project up to speed on six months of change, then point it at exactly one job.
**Reads alongside:** `v4alpha-build-brief.md` and `v4alpha-validation-report.md` (those two are the technical source of truth; this document is the *world* they live in).

---

## 0. Read this first — a gentle re-entry

If you have any seed memory of this project, it's probably the **old** picture: a
SaaS **campaign builder** called *AdForge / PPCmastery.ai*, three founders, a
contractor named Adrian, a proof-of-concept running on n8n + Postgres + Redis on a
local machine, a production Google token not yet approved, multi-tenant auth not
built, and a €1M EU funding application with a "weeks-to-months to launch" ETA.

Hold that picture loosely. **The core thesis survived; the route did not.** Here is
the one-paragraph bridge, and then we'll slow down:

> In the last six months the founder (a non-coder) used Claude Code to **build and
> ship a working product in about three weeks** — not the campaign builder, but the
> *operations platform* half of the old whiteboard vision. It's live. The Google
> token got approved. From that one success, three distinct product lines have
> separated out. **This workspace owns exactly one of them: SingularWeb.** The
> other two live in other workspaces and are not your concern beyond context.

Nothing here requires you to relearn the world from scratch. It's the same people,
the same domain (paid-search for agencies), the same "make a managed service feel
like software" instinct. What changed is that it's **real now**, and it **branched**.

---

## 1. The family tree (so the names stop being confusing)

Six months ago there was one idea. Now there are three relatives. Here they are,
plainly:

- **PPC Mastery — MaaS** *(live)* — the operations platform that actually got
  built: a client gets one link and self-serves through onboarding → contract →
  payment → Slack → access-grants → live reporting → automated weekly updates,
  zero staff touches. Owned by **Antoine + Baptiste (50/50)**, Polish entity.
  *Not this workspace.*
- **PPC Mastery — SaaS** *(future, separate workspace)* — selling that capability
  to *other* agencies. Two flavours: **V4a** = white-label the ops platform
  (multi-tenant; Antoine + Baptiste); **V4b** = the old AdForge campaign builder as
  a product (separate entity, three founders incl. Thierry). *Not this workspace.*
- **SingularWeb — "V4alpha"** *(this workspace)* — **WMI's own** merged tool, for
  WMI's own use, governed by **Antoine alone**. This is your job. Everything below
  is about this.

If a conversation drifts toward the first two, the right instinct is: *"that's a
different workspace with different governance — note it as context, don't act on
it."* That separation (the "membrane") is deliberate and load-bearing.

---

## 2. What SingularWeb is (your one job)

**SingularWeb** is a single Next.js application, deployed at **app.singularweb.ai**,
that combines **both halves of the client lifecycle** in one tool, running entirely
on **WMI's own credentials**:

- **Acquisition / onboarding** — questionnaire, access-grant requests, account
  connections, contract, invoice.
- **Management / reporting** — import and manage existing accounts under WMI's
  Google manager account (MCC), dashboards, weekly reports, Slack delivery.

**Its first real job:** onboard, manage and report on **low-budget UK prospects
sourced from Bark.com** — the clients a traditional agency can't serve profitably
by hand. Build for that workload first; generalise later.

**Why it exists:** SingularWeb is **WMI's laboratory.** What gets proven and
polished here flows back to inform the (separately-owned) PPC Mastery SaaS, and PPC
Mastery's existing code seeds SingularWeb. The knowledge loop runs both ways — but
you build only for WMI's own use. The grand "monster" version (auditing, deep
optimisation, full SingularWeb-substrate integration) grows out of *this* later;
you are building the **foundation that grows**, not the monster.

---

## 3. The single most important build fact

You might expect "merge two apps" to be hard. It isn't, and here's why:

**The two source apps are already one codebase.** The "MCC Command Center" is not a
separate product — it's the *same* PPC Mastery codebase running with one environment
flag flipped. The full application already contains **both halves** — the onboarding
funnel *and* the managed-account import / dashboards / reporting / Slack delivery —
on **one unified schema**. The old brief's feared "hardest part" (reconciling two
data models) is **largely already done.**

So SingularWeb is principally:

> **harvest the existing unified codebase into a new WMI-owned repo → rebrand to
> SingularWeb → point everything at WMI's credentials → swap PandaDoc for DocuSign
> → run with both halves visible.**

**The DocuSign integration is the one genuinely new piece of engineering.**
Everything else is harvest, rebrand, and re-credential. (Full detail: validation
report §3 and §7.)

---

## 4. How it's built — stack and the two corrections

The stack is the proven one from the source codebase, on WMI's accounts:

- **Next.js 16** (App Router, TS, Tailwind) — harvested.
- **Vercel** — a new, dedicated deployment at app.singularweb.ai.
- **Supabase** — a new, dedicated EU project; the unified schema; RLS-ready but RLS
  off (single-tenant).
- **Auth0** — admin + client roles; clients use a link, no login.
- **Google Ads API** — WMI's dev token + WMI MCC + WMI refresh token.
- **Stripe / Slack / Anthropic** — all WMI's.
- **DocuSign** — WMI's e-sign, **replacing PandaDoc** (the one new build).

Two places where reality corrected an earlier draft of the brief, now settled:
- **Google Ads API v24, not v20.** The source app is on v24; the old "v20 fixes"
  were n8n-specific quirks that don't apply to this TypeScript codebase.
- **No n8n, no Redis.** The ops platform never used them; reporting / Slack /
  Google calls run in Next.js + Vercel cron. n8n + Redis belonged to the excluded
  campaign-builder POC. Don't reintroduce them.

---

## 5. Where it lives — domains and the token truth

- **Product name: SingularWeb.** App at **app.singularweb.ai**; marketing/identity
  at **singularweb.ai**.
- **Why "app." (not "portal."):** this tool will grow well beyond onboarding, and
  `app.` stays accurate forever, whereas `portal.` would force a painful domain
  migration later (re-registering OAuth redirect URIs, Stripe webhooks, Google
  callbacks). **Lock the domain before the first OAuth/Stripe wiring.**
- **rexos.ai is parked** — a cool domain WMI owns, held in reserve in case the
  future "monster" ever wants a brand distinct from SingularWeb. Not used now.

**The token truth (important context):** WMI holds a Google Ads developer token,
approved by Google under the **SingularWeb application identity**, living inside
**WMI's MCC**. This is *why* the product is named SingularWeb — the running product
should carry the name Google approved, so product, domain, and Google's paperwork
all say the same word. The token is for **WMI's own single-tenant use** — no
external agency plugs their own token in here. (That token-sharing model is the PPC
Mastery SaaS's problem, in another workspace, and it's gated on a different,
SaaS-privileged Google approval WMI doesn't have and doesn't need for this.)
**Standing rule:** the token stays inside its declared lane.

---

## 6. Scope walls — what NOT to build

SingularWeb v1 is deliberately bounded. Do not build:
- **Multi-tenant SaaS** — no external-agency token plug-in, no tenant isolation, no
  self-serve signup. Single-tenant, WMI-only.
- **The campaign builder** — the AdForge POC is banked for a later phase; don't pull
  it in unless explicitly told.
- **The "monster"** — auditing, deep optimisation, full substrate integration: all
  later. Build the clean foundation; not the features that grow on it.
- **n8n / Redis** — see §4.

The discipline rule for this whole build: when a decision feels obvious, slow down
and check it against the build brief; when inside a documented step, move fast; if
you want to add a capability not in the brief, **stop and ask.** Scope creep is the
single biggest risk.

---

## 7. Governance, boundaries, and the knowledge loop

- **WMI project, Antoine alone.** No three-founder coordination. Move fast.
- **Don't touch the source apps.** SingularWeb is a clean-room *harvest* into a new
  WMI repo; the PPC Mastery MaaS (Antoine + Baptiste) and the Command Center
  (Baptiste's MCC) belong to other parties and stay intact.
- **Membrane discipline.** SingularWeb is documented and governed *separately* from
  PPC Mastery. Don't let decisions bleed across, beyond the deliberate knowledge
  loop. Keep this workspace's context clean.
- **IP provenance (record-keeping, not a blocker).** SingularWeb harvests code that
  originated in PPC Mastery. If polished SingularWeb code ever flows *back* into the
  PPC Mastery SaaS — or any EU grant leans on "PPC Mastery owns all its IP" — whose
  code is whose must be answerable cleanly. Keep the build well-structured and
  attributable.

---

## 8. Where things stand right now

- **Validation done; awaiting WMI credentials + repo creation.** Claude Code has
  validated the plan and recorded the kickoff decisions (validation report).
- **The one real build is DocuSign.** Its open inputs: WMI DocuSign account +
  integration key, and whether a signing template exists or the document uses
  anchor tabs.
- **One thing to verify early:** that WMI's token + refresh token actually reach
  WMI's MCC and accounts before relying on reporting (a prior check confirmed the
  *other* set of credentials reach no WMI MCC — so these are genuinely separate).
- **Definition of done (v1):** on app.singularweb.ai + its own Supabase, on WMI's
  credentials — onboard a Bark.com UK prospect end-to-end (incl. DocuSign + WMI
  Stripe), import and manage existing MCC clients, generate dashboards, deliver
  reports to Slack — all on one unified schema, no Redis, no multi-tenant layer,
  no campaign builder.

---

## 9. How to work in this project

Anchor every build session to the build brief and validation report:
*"We are building SingularWeb (V4alpha) per the build brief. I'm on [section].
Walk me through it."* Explain changes in plain terms (the owner is comfortable with
infrastructure but is not a coder), flag when something needs doing in an external
dashboard, and pause at meaningful checkpoints so it can be deployed and checked.

That's the whole picture. Welcome back — the world moved, but it moved in your
favour: the thing you were waiting to be unblocked is built, approved, and live,
and your job here is the cleanest, most self-contained piece of it.

*SingularWeb Workspace — Orientation Brief — WMI — June 2026*

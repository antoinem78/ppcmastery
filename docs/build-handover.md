# PPC Mastery (MaaS) — Onboarding & Ops Portal — Build Handover

Corrected canonical handover for the build. Supersedes earlier drafts. Keep it open beside the terminal in Claude Code; drop a copy in the repo as `/docs/build-handover.md`. Last sections are a paste-ready kickoff prompt and a `FUTURE_SAAS.md` starter.

---

## 0. What this is, who owns it, what it is NOT

**What it is:** the onboarding-and-operations portal for the **PPC Mastery MaaS** — a managed PPC service that profitably onboards smaller clients neither founder's agency could serve the old, manual way. A standalone web app that removes the manual friction (signup, contract, payment, Slack, questionnaire, ad-access) the team handles by hand today, so the service feels like a product and scales.

**The cleanest way to think about it: PPC Mastery is a third agency.** Antoine's WMI and Baptiste's adenergy are separate companies that feed clients into it and whose Google MCCs sit above the shared PPC Mastery MCC. Inside the app, every client is simply a **PPC Mastery client** — no origin tag, no per-agency attribution. One clean book, one owner.

**Operating model it has to support:**
- Founders do the **discovery call and the closing call only**. After that they're never on a client call (premium charge if they ever are).
- Day-to-day comms run through **Slack**, handled by a **PPC-masters team** — low-wage humans first, AI agents later — not the founders.
- Campaign creation and management are **partially automated now, fully automated later**.

**Ownership / entities (current state):**
- PPC Mastery (MaaS) is **jointly Antoine + Baptiste**, co-owned 50/50. Architecture decisions are theirs together — not unilateral. **Thierry is not in the MaaS** (he's a shareholder of the SaaS).
- It currently operates under **adenergy.online (Baptiste's Polish SARL) trading as PPC Mastery.** The MaaS and the SaaS will each be registered as **separate legal entities** later.
- **Money model (context only — the app implements none of this):** subscription revenue isn't drawn down; it pools into a shared pot that finances the MaaS and SaaS. Once profitable, 50/50 dividends paid annually. The portal just *collects* subscriptions — it never touches splits, routing, or attribution.

**What it is NOT** (load-bearing distinctions):
- It is **not the SaaS.** The SaaS (self-serve campaign builder, productized; Thierry is a shareholder) is a *later* evolution. This portal is the agency-side MaaS ops layer.
- It is **not on SingularWeb's stack.** SingularWeb/Rexos is its own infrastructure (n8n + Supabase + GHL + Retool); this app is standalone and shares those patterns only in spirit.
- It is **not multi-tenant.** One book of business, one owner (PPC Mastery). See §1.

---

## 1. Tenancy model: single-tenant, one clean book

The tenant is PPC Mastery itself. WMI and adenergy are not tenants in the app — they're the founders' other companies, plus the MCCs that sit above the shared one. Every client is a PPC Mastery client, full stop. No agency attribution, no per-client revenue routing — by design, because the founders' split happens annually at the dividend level, not inside the product.

So the schema is genuinely simple: a `clients` table, an append-only activity/event log, onboarding status. It is still designed **RLS-ready** so true multi-tenant scoping can be switched on later for the *SaaS* phase (when end-clients log into their own scoped views). You build the door now; you don't walk through it.

---

## 2. The hard scope line: "SaaS-portable foundations, zero SaaS features"

"Build the MaaS with the SaaS in mind" is right in one sense and dangerous in another. Hold the distinction or the build bloats.

**Good (do now) — portable foundations:**
- Standard tools you'd use for the SaaS anyway: Next.js, Supabase (Postgres), Stripe, Auth0. Not throwaway tooling you'd fork off later.
- Clean data model from day one: `clients` (with status fields), an append-only activity log. Productizing later = *migrate data*, not rewrite concepts.
- Integrations behind thin seams: one module each for Stripe, PandaDoc, Slack, Google Ads. The SaaS later imports a function, not a tangle.
- Schema designed so Supabase RLS *can* be switched on later.

**Forbidden (do NOT drag in now) — SaaS features:**
- Self-serve signup, plan tiers enforced in code, multi-tenant credential isolation, an end-client analytics dashboard, billing automation beyond your own subscription collection, any revenue-split/attribution logic.

**The test (your own Pattern 5):** for anything tempting "for the SaaS later," ask — *does the MaaS need this to onboard a client next week?* If no, it's a roadmap note → `FUTURE_SAAS.md`, not a build task. (This is the test `origin_agency` failed — it's why the schema has no such field.)

Payoff: the SaaS migration becomes **additive** — add an end-client auth tier, switch on RLS, add self-serve provisioning and plan management. Not a rewrite.

---

## 3. Tech stack (decided)

- **Frontend/backend:** fresh standalone Next.js repo (App Router). Reference the existing Lovable admin (`maestro-reach.lovable.app`) for visual design only.
- **Database + storage:** Supabase — **brand-new isolated project**, EU region (Ireland) for latency + GDPR. Holds only this app's data → clean blast radius around contracts, payments, and (later) Google Ads tokens.
- **Auth:** Auth0. Handles login. Next.js backend verifies the Auth0 session and talks to Supabase with the **service-role key, server-side only**. Single-tenant → no RLS needed in v1, but schema is RLS-ready.
- **Payments:** Stripe — subscription collection (3 months upfront + monthly recurring from month 4). **One Stripe account, under adenergy / PPC Mastery** (its current legal home); billing moves to PPC Mastery's own entity once it's registered. No per-client routing — the build just collects.
- **Contracts:** PandaDoc — templated contract, merge fields from the client record (client name, tier, start date).
- **Comms:** Slack — auto-create / invite to a client channel; the PPC-masters team operates here (can be a later phase).
- **Ad access:** Google Ads API (Basic developer token, live; WMI + adenergy MCCs sit above the shared **PPC Mastery MCC**) + later Microsoft Ads (Bing MCCs mirrored the same way). **Last phase.**
- **Hosting:** Vercel + GitHub (both familiar).

---

## 4. What the portal does (the client flow)

A closed prospect gets a link → lands in the portal → moves through a wizard, each step unlocking the next:

1. **Sign up / log in** (Auth0).
2. **Onboarding questionnaire** (business info, goals, accounts).
3. **Contract** (PandaDoc embed — review + sign).
4. **Payment** (Stripe — 3 months upfront + recurring).
5. **Slack** (invited to their client channel; team takes over comms).
6. **Ad-account linking** (Google Ads — later phase; OAuth-first, see §7).

**Roles:** two only — `agency_admin` (founders + the PPC-masters team) and `client` (sees only their own onboarding flow). Encode as an Auth0 claim. No finer-grained permissions in v1.

---

## 5. Build order

**Phase 0 — Scaffold & deploy early.** Next.js + the isolated Supabase project + Auth0 login (agency_admin first). Deploy to Vercel day one so deployment is never a late surprise. Wire env vars / secrets from the start.

**Phase 1 — The onboarding wizard (the actual product).** Public, link-driven `/onboarding`: questionnaire → contract step (stub) → payment step (stub). Get a fake client through end to end before integrating anything. Use **locked service tiers** for the quote, not a free-text scope box — a quote is configured, not authored.

**Phase 2 — PandaDoc + Stripe.** Contract generation from the client record; Stripe subscription (3-month upfront + monthly from month 4). Webhook flips the client to "active." Test mode first; live mode only once the loop works.

**Phase 3 — Slack.** Auto-create/invite to client channel on activation; the team's workspace for ongoing comms.

**Phase 4 — Google Ads linking** (then Microsoft Ads). Most unknowns; see §7.

---

## 6. External account setup checklist

Each is a fiddly dashboard task only you can do. Claude Code guides each; you're the hands on the keyboard.

- [ ] **Supabase** — new isolated project, EU (Ireland). Save URL, anon key, service-role key, DB password. (Familiar.)
- [ ] **GitHub** — fresh private repo. (Familiar.)
- [ ] **Vercel** — connect repo, set env vars. (Familiar.)
- [ ] **Auth0** — tenant, Next.js application, callback/logout URLs, `agency_admin` / `client` roles as a claim.
- [ ] **Stripe** — products/prices for tiers, webhook endpoint, test vs live keys. One account, under adenergy / PPC Mastery for now.
- [ ] **PandaDoc** — API key, contract template with merge fields (client name, tier, start date).
- [ ] **Slack app** — bot token + scopes for channel create/invite.
- [ ] **Google Cloud project** — enable Google Ads API, OAuth 2.0 client (ID + secret), configure + **submit OAuth consent screen for verification early** (review takes days to ~2 weeks; build against test users meanwhile).
- [ ] **Microsoft Ads API** — developer token + OAuth (faster than Google; later). Set up Bing MCCs mirroring the Google structure.

---

## 7. Google Ads access — the settled mental model

This was the biggest source of confusion, so it's pinned here.

**MCC structure:** the WMI MCC and the adenergy MCC both sit **above the shared PPC Mastery MCC**, which is the container that holds future client accounts. So the API auth (stored refresh token) operates at the **PPC Mastery MCC**, and link invitations go from the PPC Mastery MCC to each client's customer ID. Bing will mirror this structure.

**Developer token ≠ OAuth — complementary, not substitutes.**
- Developer token (Basic tier, confirmed, works on live accounts): authorizes your *application* to call the API. Lives in request headers. Done.
- OAuth credentials (client ID + secret, from Google Cloud): *authentication* — which Google user, and that they consented. Set up separately regardless of token tier.

**Two different "click a link" flows — don't merge them:**
1. "Sign in with Google" = OAuth. A popup (hosted by Google, feels embedded). CAN live in your wizard.
2. "Grant management access to the PPC Mastery MCC" = account linking. Google **requires** the user to do this inside the Google Ads UI. No OAuth scope, no popup, no API call makes one-click MCC linking happen from your site. By design.

**The realistic best flow inside `/onboarding` (OAuth-first):**
1. Client clicks "Connect Google" → real OAuth popup → signs in, consents.
2. From the token, your app reads their accessible Ads accounts and pulls the customer ID automatically (no hunting for a 10-digit number).
3. Your backend (authed as the PPC Mastery MCC) sends the link invitation to that customer ID.
4. The wizard shows a handoff card: "One last step — approve our management access," opening their Google Ads account (new tab) where the pending invite waits.

Net: one popup to connect (SaaS-like), invisible backend work, one explicit "approve in Google Ads" handoff. The final approval is on Google's turf — **don't try to collapse that last step; it cannot be done.**

**Consequence:** OAuth-reading-their-accounts means clients *do* OAuth into your app, so your OAuth consent screen must be **verified by Google for production**. Apply early; develop against test users. This is the only piece with an external clock you don't control — and the thing that stalled the project before.

---

## 8. Honest caveats (carry into the build)

- You're a non-coder, but comfortable with infrastructure (Supabase, Vercel, GitHub, Auth0, env vars, automation from n8n/make). That's the harder half; Claude Code fills in the code.
- Build the smallest valuable slice end to end first. One fake client through questionnaire → payment beats ten half-built admin screens.
- The real skill is *knowing when something is broken and why* (a silent Stripe webhook, an OAuth redirect loop). Read what Claude Code changes; don't accept blindly.
- Resist "while we're at it." It's the exact drift your Pattern 5 exists to kill. Every SaaS feature added now is unvalidated complexity.
- The automated Google flow removes *your* steps, not the client's single approval click. Set that expectation with the team.
- This is a joint Antoine + Baptiste build. Keep Baptiste in the loop on architecture calls (billing entity timing, MCC structure) — they're not unilateral.

---

## 9. Kickoff prompt for Claude Code

Paste into Claude Code in your empty repo to start Phase 0 → Phase 1.

```
I'm building the onboarding + ops portal for "PPC Mastery", a managed PPC service
(MaaS). I'm comfortable with infrastructure (Supabase, Vercel, GitHub, Auth0, env
vars) but I'm not a coder — explain what each change does, and tell me when to do
something in an external dashboard.

CRITICAL framing:
- This is a SINGLE-TENANT internal ops app. The tenant is PPC Mastery itself. Clients
  are RECORDS in the system, not tenants who log into scoped instances. There is no
  per-agency attribution and no revenue-split logic in the app — every client is just
  a PPC Mastery client.
- Do NOT build SaaS features: no self-serve signup, no plan-tier enforcement in code,
  no multi-tenant credential isolation, no end-client analytics dashboard, no
  billing/attribution/split logic. If you think a feature is "for the SaaS later,"
  STOP and add it to FUTURE_SAAS.md instead of building it.
- DO use SaaS-portable foundations: standard tools (Next.js, Supabase, Stripe,
  Auth0), a clean data model, integrations behind thin seams, and a schema designed
  so Supabase RLS could be switched on later. Build the door; don't walk through it.

Stack: Next.js (App Router) + a brand-new isolated Supabase project (EU/Ireland, data
layer only) + Auth0 (login; backend verifies the session and uses the Supabase
service-role key server-side) + Vercel hosting. Stripe for subscription collection
(one account), PandaDoc for contracts, Slack for client channels, Google Ads +
Microsoft Ads APIs for account linking (later phases).

What the portal does: a closed prospect gets a link to /onboarding and goes through a
wizard — Auth0 signup, questionnaire, PandaDoc contract, Stripe payment, Slack invite,
then (later) Google Ads linking. Each step unlocks the next. Two roles only:
agency_admin (founders + ops team) and client, via an Auth0 claim.

Build in this order, no getting ahead:
  Phase 0: scaffold Next.js, connect the isolated Supabase project, Auth0 login for
           agency_admin, deploy to Vercel early.
  Phase 1: the /onboarding wizard (questionnaire -> contract stub -> payment stub).
  Phase 2: PandaDoc + Stripe (3 months upfront + monthly from month 4; webhook marks
           client active).
  Phase 3: Slack channel auto-create/invite on activation.
  Phase 4: Google Ads linking (OAuth-first: connect, auto-read customer ID, send link
           invitation from the PPC Mastery MCC, hand off to Google Ads UI for approval).

Start with Phase 0 ONLY. Before writing code, propose the repo structure and the
Supabase schema (clients with status, append-only activity log, onboarding state),
designed RLS-ready, and wait for me to confirm. Then scaffold step by step, pausing
after each meaningful chunk so I can deploy and check it works. Create FUTURE_SAAS.md
at the start and add any deferred SaaS ideas there as we go.

Design reference: clean navy sidebar, "PPC mastery" wordmark — I'll share screenshots
from the existing Lovable build. Use locked service tiers for the quote, not a
free-text scope box.
```

---

## 10. `FUTURE_SAAS.md` starter (create in the repo on day one)

```
# Future SaaS — deferred ideas (DO NOT BUILD until productization is decided)

Anything here is a roadmap note, not a build task. The MaaS ops app is single-tenant
(the tenant is PPC Mastery; clients are records). These are the additive changes that
would turn it into a multi-tenant SaaS later — captured so we don't forget them and
don't build them early.

- End-client auth tier (clients log into their own scoped view)
- Switch on Supabase RLS over existing tables (scope by client/org)
- Self-serve signup + provisioning (no manual link-send)
- Plan tiers enforced at the billing + feature-gate layer
- Multi-tenant Google Ads OAuth credential isolation (per-tenant refresh tokens)
- End-client reporting dashboard
- The self-serve campaign-builder product itself (the SaaS — separate entity, involves
  Thierry as a shareholder; not a MaaS decision)

Rule: a feature only leaves this file when productization is an explicit, validated
decision — not "while we're at it."
```

---

## 11. Quick start sequence

1. Create the empty GitHub repo, clone locally.
2. Create the new isolated Supabase project (EU/Ireland).
3. Open the folder in Claude Code; paste the kickoff prompt.
4. Have Supabase, Auth0, and Vercel dashboards open in tabs.
5. In parallel, submit the Google OAuth consent screen for verification — it runs in the background (~1–2 weeks) while you build Phases 0–3, so it's likely approved by the time you reach Phase 4.
6. When Phase 0 starts, have Claude Code propose the repo structure and Supabase schema first — and don't let it write a line of feature code until that schema looks right. It's the one decision the whole build sits on.

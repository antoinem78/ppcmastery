# FUTURE_SAAS.md — deferred ideas (DO NOT BUILD until their gate is reached)

Anything here is a roadmap note, not a build task. A feature only leaves this
file when productization is an explicit, validated founder decision — not
"while we're at it." (Precedent: the reporting dashboard left this file for
Phase 6 by explicit founder decision. That's the bar.)

---

## The thesis

WMI and adenergy/BJ PPC are PPC Mastery's first users — our own first
white-label "clients." We run the platform in-house, perfect it on real
clients, then sell the proven thing to other agencies. The MaaS earns the
SaaS.

## The instance ladder

- **V1** — PPC Mastery AI: Baptiste Jenard PPC (Poland, USD). Live.
- **V2 / V3** — WMI UK (GBP, VAT 20) / WMI UAE clones. Same codebase,
  env-config only: their Stripe, PandaDoc, Slack, branding, currency.
  NOT new builds, NOT forks — second deployments with different env vars.
- **V4** — first external agency tenant (e.g. Propelhead): their branding,
  their Stripe, their PandaDoc/DocuSign, their Slack — on OUR platform and
  OUR Google developer token. **V4 is the SaaS boundary.** Nothing in the
  V4 section below gets built until a real tenant deal makes it concrete.

## Settled architectural facts (do not relitigate)

- The Google developer token identifies the APPLICATION, not the billing
  entity. The V2/V3 clones do NOT need their own token — same token,
  different env config (and, only if ever needed, a different
  login-customer-id).
- Tenants will never hold their own developer tokens. Renting access to
  ours (via their linked MCC) IS the product — the standard model for the
  category (WordStream, Optmyzr, Adalysis).
- Google Ads API calls are free at every access tier. The costs of tenancy
  are quota, compliance, and responsibility — not fees.
- **Standing rule, in force TODAY:** the token stays inside its declared
  lane (our own managed service, no client OAuth in the portal) until we
  formally widen the lane with Google.

---

## V4 gate checklist (trigger: a tenant deal looks real — even LOI stage)

Google paperwork has weeks-to-months lead times. Start these BEFORE any
tenant code is written. Paperwork early; code on demand.

- [ ] Apply for **Standard access** on the developer token. The Basic tier's
      15k ops/day is ONE bucket shared by all instances and all future
      tenants; ten agencies bulk-publishing will hit it.
- [ ] **Re-declare the token's use case** with Google BEFORE any tenant
      touches the API. Current approval = our own managed service. Serving
      third-party agencies is a materially different use case and triggers
      Google's Required Minimum Functionality (RMF) rules for tools serving
      third parties. Applying does NOT endanger the existing token;
      operating outside the declaration without telling Google does.
- [ ] Build **tenant-agency OAuth**: the tenant authorizes the platform
      against THEIR MCC; we store their refresh token scoped to their
      tenantId; their clients link to THEIR MCC, never ours. (The only
      OAuth that returns to the roadmap — the MaaS client flow stays
      OAuth-free as declared.)
- [ ] **Tenant-conduct guardrails** (one token = Google holds US accountable
      for everything done through it; a tenant's abuse can suspend the token
      and take down every instance and tenant at once):
      - ToS with teeth + contractual right to cut a tenant off fast
      - human approval retained on campaign publishing, per tenant
      - monitoring for policy-violation patterns
      - V4 pricing reflects this platform risk

## V4+ build items (parked behind the gate)

- Move entity config from env vars → per-tenant DB rows + Supabase RLS
  (the multi-tenant switch; the schema is already RLS-ready by design)
- Tenant self-serve signup + provisioning (no manual link-send)
- Connect-your-own Stripe / PandaDoc / DocuSign / Slack (credential UI)
- Self-serve branding / logo / theming engine
- Plan tiers / spend-band pricing catalogue. **Removed from the MaaS June 2026**
  — every MaaS quote is bespoke (a custom monthly price per client), so the
  locked self-serve tiers (ps-1k…ps-20k, $99–$599) were deleted along with the
  Stripe price-seeding. Tiered, pre-seeded pricing is a self-serve SaaS concept;
  it returns only if/when the SaaS does. (Was in src/lib/tiers.ts + seed script.)
- Multi-tenant Google Ads OAuth credential isolation (per-tenant refresh
  tokens)
- In-app multi-entity / per-client billing routing (only if ever needed)

## Other parked ideas (not V4-gated, still parked)

- End-client auth tier (clients log into their own scoped view — the
  current client link-flow needs no login by design)
- Combined cross-instance revenue / "pot" reporting view (internal; the pot
  itself stays an accounting matter outside the app)
- GA4 / GTM programmatic access grants via a separate client-OAuth consent
  screen (Phase 5 keeps them as guided manual checklist tasks; Search
  Console has no user-management API and stays manual forever)
- Per-agency Stripe routing inside one instance (superseded by the
  instance-clone model; revisit only if clones ever consolidate)
- The "growth OS / rent-the-infrastructure" vision (the portal as the
  operating system other agencies run their service business on)
- The self-serve campaign-builder product itself (AdForge / the SaaS
  proper — separate entity, involves Thierry as a shareholder and Adrian's
  work product; NOT a MaaS decision. Convergence: AdForge may first run
  INSIDE the MaaS for our own campaign automation — a three-founder
  conversation, and its token/declaration questions are its own)
- Google Drive integration for client asset intake (logos, creative).
  The questionnaire already captures a drive LINK as an optional field;
  a real Drive integration (browsing/uploading) stays parked — Slack file
  sharing covers the gap.
- Claude integrated into the PPC Mastery Slack workspace — AI ops
  assistant for the PPC-masters team. Fits the "AI agents later" operating
  model; revisit once the MaaS runs real clients.

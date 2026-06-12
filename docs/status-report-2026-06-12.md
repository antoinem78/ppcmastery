# PPC Mastery Portal — Status Report (June 12, 2026)

For the strategy thread. Assumes knowledge of the original build-handover doc;
focuses on what's built, what changed versus the brief, and what's open.

## Bottom line

Phases 0–3 are **built, deployed, and production-proven** in 3 days of building.
A closed prospect receives one link and self-serves: confirms details → signs a
generated contract → pays a real subscription → gets a Slack channel → completes
the onboarding questionnaire — zero staff touches, every step webhook-verified
and written to an append-only audit log. The Google Ads developer token was
approved today; Phase 4 (ad-account linking) is unblocked.

## What exists (proven in production, test/sandbox modes)

- **Stack:** Next.js 16 + isolated Supabase (EU) + Auth0 (admin login,
  agency_admin role claim) + Vercel, GitHub auto-deploy. Live at
  ppcmastery.vercel.app (custom domain pending).
- **Admin portal:** client book, create-client (tier or custom price, platform
  selection), client detail with onboarding progress, questionnaire answers,
  and full activity log.
- **Client wizard** (link-driven, no client login): details confirmation →
  PandaDoc contract generated from the client record and signed embedded →
  Stripe Checkout (monthly subscription anchored to signup date) → Slack
  channel auto-created with the team added (client auto-invited if workspace
  member; manual guest invite flagged otherwise) → full paid-search
  questionnaire incl. optional creatives drive link.
- **Integrations:** all behind thin seams (one module each), all with
  webhook + verified-fallback dual paths. Production webhooks confirmed for
  Stripe, PandaDoc, and Slack provisioning in a single live test run.

## Decisions that changed the original brief

1. **Entity:** primary deployment = **Baptiste Jenard PPC trading as PPC
   Mastery AI** (Poland, USD) — matching the Google-facing identity
   (ppcmastery.ai, MCC 447-370-6744). WMI UK becomes the **clone** (GBP,
   VAT 20, own domain later). Same codebase, per-entity env config only.
2. **Billing:** 3-months-upfront is **binned** → 1-month rolling, billed in
   advance on the signup-date anniversary, **31 days' cancellation notice**
   (one final payment always collected). Site copy still says 30 — to fix.
3. **Wizard order inverted:** prospects arrive pre-quoted, so everything
   before payment is friction-removal (details → contract → pay) and the
   questionnaire moved **after** payment, alongside Slack setup.
4. **Pricing:** seven real Paid Search spend-band tiers ($99–$599/mo) plus a
   **custom plan** (admin sets the price; client only ever sees "Paid Search —
   custom plan (agreed pricing)" — never the band, and **no zero-calls
   language on custom/premium plans**). Platforms (Google/Microsoft/Meta)
   selected per client and reflected in quote wording.
5. **Phase 4 redesigned to honor the Google design doc:** NO client OAuth in
   the portal (as declared to Google). Flow: client types their customer ID →
   admin approves → link invitation sent from the **PPC Mastery MCC** →
   client accepts inside Google Ads. The PPC Mastery MCC currently sits under
   WMI's MCC; with BJ PPC's token now approved it will be re-parented under
   BJ PPC's MCC (Baptiste's task).

## Open items (none blocking builds)

- Legal review of the agreement (+ template §1 should use the channels token;
  §5 zero-calls clause doesn't fit premium deals).
- Production PandaDoc API key (sandbox = "[DEV]" watermark, in-org sending only).
- Live Stripe keys at production cutover + payment-failure/dunning handling +
  admin cancellation button (mechanical 31-day enforcement).
- Site copy 30→31 days; Stripe display name; Polish VAT treatment.

## Agreed roadmap

- **Phase 4 — Google Ads linking** (next; token approved, 15k ops/day).
  Microsoft Ads mirrors after.
- **Phase 5 — Client home/checklist:** persistent client page at the same
  link; % completion; tasks tick off over days (platform access grants for
  GA4/GTM/Search Console as guided checklist tasks v1 — Search Console has no
  user-management API, so it stays manual forever; GA4/GTM programmatic grants
  possible later via a separate client-OAuth consent screen).
- **Phase 6 — Reporting v1:** native KPI dashboard in the client view (pulled
  into the MaaS from the parked SaaS list by explicit founder decision) +
  plain-English weekly updates generated from Ads API change history, posted
  to Slack and the dashboard.
- **Phase 7 — Connectors:** GHL contact sync on client creation, Meta, the
  OAuth connector model.
- **V2/V3** = WMI UK / WMI UAE clones (env-config only). **V4** = white-label
  sold to an agency client → that's the SaaS boundary, parked in
  FUTURE_SAAS.md along with the "growth OS / rent-the-infrastructure" vision.

## Strategic shape

The portal is evolving from an onboarding tool into the **client interface**:
the prism through which clients see their account (progress, access, KPIs,
weekly plain-English updates) and the channel through which the team operates
(Slack + admin portal + audit trail). Every feature lands behind a seam and an
env flag, so the white-label clones stay configuration, not forks — which is
precisely the door to the SaaS without walking through it yet.

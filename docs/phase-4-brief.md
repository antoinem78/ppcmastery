PHASE 4 — Google Ads account linking. Read docs/build-handover.md and the status
report if present for context. Phases 0–3 are live and production-proven; follow
the existing patterns (thin seams, env config, append-only activity log, webhook +
verified-fallback where applicable).

CRITICAL DESIGN CONSTRAINT (declared to Google — do not deviate):
- NO client OAuth in the portal. Clients never sign in with Google here.
- Flow: client types their Google Ads customer ID → admin reviews and approves →
  our backend sends a link invitation FROM the PPC Mastery MCC → client accepts
  it inside Google Ads (their UI, not ours). Do not try to collapse that last
  step; Google requires it.

MCC / auth context:
- The PPC Mastery MCC sits under Baptiste Jenard PPC's MCC (re-parenting done;
  WMI MCC unlinked). One hierarchy, one developer token (Basic, approved,
  15k ops/day), one stored refresh token.
- API: CustomerClientLinkService mutate creating a PENDING link, sent from the
  MCC. Set the login-customer-id header to the PPC Mastery MCC ID. If calls fail
  with permission errors despite valid credentials, check that header first.
- All Google credentials/IDs in env vars behind the existing config seam — a new
  google-ads module, same pattern as stripe/pandadoc/slack modules.

Build in this order, pausing after each chunk:
1. Customer ID capture in the client checklist: accept 123-456-7890 or 1234567890,
   strip to digits, require exactly 10, reject junk client-side. Include a short
   "where to find your customer ID" helper. Write submission to the activity log.
2. Admin approval step: pending IDs appear in the admin portal; on approve, the
   backend attempts the link creation. Catch the specific error for an invalid /
   inaccessible ID and surface "this ID doesn't appear to exist — check with the
   client" in the admin view instead of failing silently.
3. Link lifecycle tracking: states sent → active, plus refused/cancelled/ignored.
   No webhooks exist for this — use a scheduled status check or an admin "refresh
   status" button (v1: button is fine). Write every transition to the activity
   log. The client checklist item completes ONLY on ACTIVE, not on send.
4. Client handoff card after the invite is sent: "We've sent the request — approve
   it in Google Ads," linking to ads.google.com, with one line: "find it under
   Admin → Access and security → Managers." Post a Slack ping to the client
   channel on send, and notify the team channel if still unaccepted after 3 days.

Scope guards:
- Microsoft Ads comes AFTER Google works end to end with a real client — build
  the seam so it can mirror, but do not build it now.
- No GA4/GTM/Search Console grants in this phase (Phase 5 checklist tasks).
- Anything that smells like per-tenant OAuth or connector UI → FUTURE_SAAS.md.

Explain changes in plain terms as you go, and tell me when anything needs doing
in an external dashboard (Google Cloud, Google Ads UI, Slack).
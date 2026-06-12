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

---

## Deferred integrations & ops ideas (not SaaS-tier — just not now)

These aren't multi-tenant SaaS features; they're future enhancements parked to
protect current scope. Same rule: capture, don't build.

- **Google Drive — client asset intake** (logos, creative). Low priority; Slack file
  sharing covers it for now. NOTE: the onboarding *questionnaire* is a NATIVE wizard
  step (answers → Supabase `onboarding_state.questionnaire_data`), NOT a Google Form —
  so Drive is not needed for the questionnaire.
- **Claude integrated into the PPC Mastery Slack workspace** — AI ops assistant for the
  PPC-masters team. Fits the "AI agents later" operating model; revisit post-MaaS.

---

## SaaS-bound ideas from the June 2026 roadmap session (Antoine + Baptiste)

- **V4: white-label shipped to a third-party agency client** — selling the portal to an
  external agency is productization (multi-tenancy, support, billing for the tool itself).
  V2 (WMI UK) and V3 (WMI UAE) are NOT this — they're own-entity clones via env config.
- **"Growth operating system for agencies"** — portal + CRM bundle rented to agencies:
  GHL subaccounts under the SingularWeb agency account, they brand it, we host/own the
  infrastructure. The endgame the MaaS is building toward.
- **Model-B Google connector at scale** — per-tenant OAuth credential isolation when
  agencies' clients connect GA4/GTM through their own branded instances.

NOTE (decided June 2026): the **end-client performance dashboard** originally parked in
this file was explicitly pulled INTO the MaaS by both founders — it leaves this list as a
validated decision, per the rule.

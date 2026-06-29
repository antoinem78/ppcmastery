# Harvest Audit — interrogation prompt for the in-repo Claude Code instance

**Run this inside the PPC Mastery repo**, with the Claude Code instance that has
the actual code in front of it. Its job is to produce an accurate, ground-truth
harvest brief for a clean-room WMI build ("V4alpha / SingularWeb") — by reading
the real code, not by inferring. Read-only: it must not move, edit, or refactor
anything; it only describes what exists.

Paste everything below the line.

---

You are auditing THIS repository to produce a clean-room **harvest brief**. Another
WMI-owned workspace will build "V4alpha / SingularWeb" by harvesting from this
codebase: same unified app (the one that runs both the onboarding funnel and the
MCC Command Center via `PORTAL_REPORTING_ONLY`), rebranded, re-pointed at WMI's own
credentials, with **PandaDoc swapped for DocuSign**, single-tenant, no n8n, no
Redis.

**Rules for this audit:**
- **Read-only.** Do not move, edit, rename, or refactor any file. Describe only.
- **Ground truth only.** Every claim must come from a file you actually opened —
  cite the path. If you can't verify something, say "unverified" and say what file
  would confirm it. Do not reconstruct or guess.
- **Prose where possible**, no code dumps — but exact identifiers (env var names,
  table names, file paths) must be quoted verbatim, because the other workspace
  will rely on them literally.
- Produce the output as a single markdown document the other workspace can read
  cold. Where you are unsure, an honest "I'm not sure, check X" is worth more than
  a confident guess.

Cover these seven areas, in order:

## 1. The two-halves mechanism
- Find every place `PORTAL_REPORTING_ONLY` is read. Quote the file paths. Describe
  exactly what it gates — which routes, nav items, components, or API handlers
  appear/disappear in reporting-only mode vs full mode.
- Find any **sibling flags** (grep for other `PORTAL_*`, `*_MODE`, `FEATURE_*`,
  `NEXT_PUBLIC_*` toggles). List them, quote names, describe what each does.
- State what **full mode** (flag off / both halves on) actually exposes.
- Critical: identify anything that **only works in one mode** and could break or
  behave oddly with both halves on at once — e.g. a route that assumes no
  onboarding clients exist, a query that assumes all clients are reporting-only, a
  cron that behaves differently per mode. V4alpha runs full mode, so flag every
  such assumption you can find, or state you found none after checking [list where
  you looked].

## 2. The data model (from the real migrations)
- Open the migration files (reportedly 0001–0013) and the consolidated schema if
  one exists. List every table, quoted verbatim.
- For each: one line on what it holds and whether it's onboarding-side,
  management-side, or shared.
- Describe the relationships (foreign keys) in plain terms — especially how a
  "client" ties to `onboarding_state`, `weekly_reports`, `activity_log`,
  `ads_report_cache`, and anything else.
- Where does the **single source of truth for a client** live, and what
  distinguishes an onboarding-origin client from an imported reporting-only one
  (e.g. a `source` column)? Quote the column.
- **Sharp edges:** find columns that are nullable-but-assumed-present, statuses
  that mean different things in the two halves, near-duplicate tables, or any
  reconciliation that looks done but has a caveat. If you find none after checking,
  say so and name what you checked.

## 3. The integration seams (verify, don't assume)
For each of **PandaDoc, Stripe, Slack, Google Ads, Auth0, Anthropic, Supabase**:
- Is it behind a single module/interface, or threaded through many files? Quote the
  main module path, then grep the provider name across the repo and report how many
  files reference it directly.
- For **PandaDoc specifically**: the harvest swaps it for DocuSign. Open the
  contract module and verify the seam is genuinely clean — does anything
  PandaDoc-shaped leak into the wizard UI, the webhook handler, the DB status
  fields/enums, or the activity log? List every file that would need to change for
  a PandaDoc→DocuSign swap. Give an honest verdict: is it really a one-module swap,
  or are there tendrils?

## 4. The credential surface (env var names only — never values)
- Produce the complete list of env vars the app reads (check `.env.example`, config
  files, and grep `process.env.`). Quote each name; map each to its provider.
- Group them: which must be re-pointed to WMI's accounts for the harvest.
- Separately, list **every place PandaDoc is referenced** (env vars, modules,
  webhook routes, DB enums, UI strings) so the other workspace has the full
  swap-list.

## 5. The harvest hazards
- If someone clones this into a fresh repo on new credentials, **what breaks
  first?** Be specific.
- Find anything implicitly coupled to: the current **Vercel** project, the current
  **Supabase** project (project ref/URL in code rather than env?), the current
  **domain** (hardcoded base URLs, OAuth redirect URIs, webhook callback URLs), or
  any **hardcoded IDs** (MCC `login-customer-id`, account ids, Slack channel ids,
  price ids). Quote what you find.
- Flag anything a fresh builder would trip on that **isn't written down anywhere**
  — setup order, a manual step, a migration that must run before a seed, a
  cron-schedule assumption.

## 6. PPC-Mastery-specific vs portable
- Which parts are baked to PPC Mastery's specific business logic (pricing rules,
  the exact onboarding steps, the weekly-report 5-section format, MCC assumptions)
  and would need rethinking for a broader WMI tool?
- Which parts are clean infrastructure that ports as-is (auth wiring, the seam
  pattern, the cache layer, the audit log, the dashboard query layer)?
- Be concrete enough that the other workspace knows what to keep verbatim vs what
  to treat as a starting point.

## 7. IP provenance honesty
- From file history / structure as far as you can see it, flag any parts whose
  origin is genuinely tangled — code clearly from the Command Center fork vs the
  original onboarding build, or anything where "whose code is this" (Antoine vs
  Baptiste vs the BJ MCC fork) would be hard to answer cleanly.
- This is for record-keeping, not blame. Where you can't determine provenance from
  what's in the repo, say so — don't speculate about who wrote what.

End with a short **"confidence map"**: which of the seven sections you answered from
directly-verified code, and which contain anything unverified the other workspace
must double-check.

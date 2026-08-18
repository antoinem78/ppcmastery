# Parity gap report, 2026-08-18

Phase 1 of the portal parity sync (CODE_BRIEF_PORTAL_PARITY_SYNC.md,
2026-08-13). Read-only; nothing here changed either deployment beyond adding
evidence fields to /api/diag/env. Reference: app-wmi at `8811b20` (fetched
2026-08-18). Ours: `06df5e7` at the time of writing.

## The section 3 verdict first: agent memory and data are isolated

**Verdict: isolated, by code default and by founder ruling, with runtime
evidence one diag read away.**

- The memory code (`src/lib/agent-memory.ts`) uses the deployment's OWN
  database unless `MEMORY_SUPABASE_URL` + `MEMORY_SUPABASE_SECRET_KEY` are set.
  This repo's deployments deliberately leave them unset (founder ruling
  2026-08-06: PPC Mastery's agents keep their own memory, separate from WMI's).
- Neither variable appeared in either portal's `observed_names`/`empty_names`
  on the 2026-08-06 sweeps, and they have never been requested for these
  Vercel projects.
- The two portals run on DIFFERENT Supabase projects: every migration this
  month was run twice, once per SQL editor, and the agent-memory seed was run
  on ppcmastery only, deliberately, because its content is PPC Mastery's.
- No WMI data plane is reachable from this repo: there are no SUBSTRATE_*,
  BERNARD_WEBHOOK_KEY, or relay variables in this codebase at all (see env
  inventory below), so there is nothing to point at WMI's estate even by
  misconfiguration.
- **Runtime proof:** /api/diag/env now reports `memory_store` (must read
  "own-database" on both) and `db_ref` (must DIFFER between the two portals).
  Read both after this deploys and paste into the ledger.

One caveat named honestly: the same Meta system-user token is on both portals,
so Bernard reads the same three Meta ad accounts from either. That is an
AGREED exception (founder, 2026-08-06), recorded alongside the shared Stripe
and PandaDoc accounts. It is credential sharing, not memory or database
sharing; the brief's severity test (cross-entity client data in the runtime)
is about the data plane, and the founder has ruled this one in scope-knowledge.

## Finding 1: repo identity, and the brief's premise corrected

The brief "believes same GitHub". Half right:

- **PPCMastery and AdEnergy are the SAME repo** (`antoinem78/ppcmastery`,
  main), two Vercel projects. Code parity between them is by construction;
  the only drift possible is env, database schema, and build recency.
- **The reference is a different repo** (`antoinem78/app-wmi`). Not a detached
  fork: a divergent sibling with shared ancestry (merge base `ef875f44`,
  2026-06-19), maintained separately BY RULING, because features are
  asymmetric in both directions (no Campaign Builder on WMI; no WMI commerce
  machinery here). Parity with it means hand-porting reviewed changes, which
  is exactly how the 2026-08-06 port (W1-W8) was done. No fold-back plan is
  proposed; the founder has ruled this structure repeatedly.

## Commit delta

- This repo: both portals build from main; last push `06df5e7` (2026-08-06).
  Nothing has been pushed since, so both should serve it (verify via
  `derived.commit`; adenergy's last verified read was `c3b9dd4` moments before
  `06df5e7` finished building).
- Reference: 58 commits since `e0aa589` (the last one consumed by the August
  port). **Only 8 touch portal code**; the other 50 are WMI business
  operations (client channels, wmi-website, VIP briefs, demo scripts, risk
  briefs) and are out of scope by definition.

## The 8-commit gap, classified

### A. Port candidates (product improvements, entity-neutral)

| Ref | What | Size | Notes |
|---|---|---|---|
| `8631b9e` | Oscar: attachments in portal chat (PDF/Word/MD), parity with Bernard | ~210 lines across chat route, CommandChat, agent | Bernard here already accepts attachments; Oscar does not. Straight port. |
| `3f21b82` | Meta audit findings engine: deterministic detectors in code, model writes only verified findings | `meta-findings.ts` 427 + `audit-deep.ts` 289 + meta-generate rework | Kills invented findings in the Meta audit doc. Our meta-generate.ts predates it. |
| `e31fddd` | Onboarding: Meta-only clients skip the Google Ads link card | ~80 lines | Funnel correctness for any Meta-only client. Cheap. |
| `4f1daec` | Agents: 1h cache TTL on the stable prefix | 2 lines | `cache_control: { type: "ephemeral", ttl: "1h" }` on the brief block. Ours is the 5-minute default. One-line change in our shared cache.ts (theirs is per-agent because they lack the shared module). |
| `605718a` | Migration runner that cannot hit the wrong database (`scripts/migrate.mjs` + `-- TARGET:` header on every migration) | ~230 lines + headers | Directly answers the brief's own warning about migrations hitting the wrong DB; we run everything by hand in two SQL editors today. |

### B. Founder decision required before porting

| Ref | What | The decision |
|---|---|---|
| `4e494c0` | **Upsells**: one-off invoices + recurring add-ons as separate Stripe subscriptions (cancellation isolation), signable quote for recurring; their migration 0024, `upsells.ts`, `/upsell/[id]` page, Stripe + email wiring | Does the MaaS want to sell add-ons through the portal now? If yes it renumbers to OUR 0022 and needs a walk of its own before first use. |
| `4093baf` | **Sonnet 5 across the board, for cost** (their founder ruling 2026-08-13) | Cost vs quality call for OUR agents. Oscar/Bernard here run Opus 4.8. Their stated reason: the work is now largely mechanical because findings are computed in code. That argument only transfers AFTER the findings engine (3f21b82) is ported. Recommend deciding after, not before. |
| `aff404f` + prior | **Meta weekly reports cron** (9am BST, step-by-step funnel). We never carried `meta/weekly.ts` or its cron at all | Do AdEnergy/PPC Mastery clients get Meta weeklies? Needs `SLACK_META_REVIEW_CHANNEL` and review discipline like the Google ones. |

### C. Config-by-design differences, NOT gaps (do not "fix")

Per-entity Auth0 app, Stripe keys, Resend domain/from, branding, legal wording,
currency, MCCs; ppcmastery=documenso vs adenergy=proposal-engine (ruled
2026-08-18); review-mode surface trims on demo; agreed shared exceptions:
Stripe account, PandaDoc account, Meta token.

### D. Do-not-port list (default no, unchanged)

Substrate/dispatch estate (`SUBSTRATE_*`, `BERNARD_WEBHOOK_KEY`, governed Meta
executor), relay endpoints + keys (`AGENT_RELAY_URL`, `OSCAR/BERNARD_RELAY_KEY`
— useful, but a standing "no" until wanted), per-client currency
(`ENTITY_CURRENCIES`, their 0023 — founder skipped 2026-08-06), platform_client
spine (their 0021 — SingularWeb), shared agent memory (`MEMORY_SUPABASE_*` —
see §3), WMI commerce/OCT machinery (`OCT_UPLOAD_KEY`, `CONSOLE_CONFIG_KEY`).

## Migration ledger

Repo head: our 0021. Applied 2026-08-06 to BOTH portal databases by hand
(0020 agent_memory, 0021 share_dashboard), seed on ppcmastery only. Numbering
fork vs the reference is documented in PARITY_LEDGER.md. Strays: none known;
verify with the SQL below (read-only), one run per database:

```sql
select
  to_regclass('agent_memory')  is not null as m0020_agent_memory,
  exists (select 1 from information_schema.columns
          where table_name='clients' and column_name='share_token') as m0021_share,
  to_regclass('write_audit')   is not null as m0019_write_audit,
  to_regclass('upsells')       is not null as stray_upsells_should_be_false,
  exists (select 1 from information_schema.columns
          where table_name='clients' and column_name='currency') as stray_currency_should_be_false;
```

## Environment inventory (names only), 2026-08-18

Both portals fully swept via /api/diag/env on 2026-08-06/18; `observed_names`
and `empty_names` empty on both (no typos, no blank values). Deliberately
absent everywhere in this repo: the fifteen reference-only vars (substrate,
relays, shared memory, currency list, roles-claim override, API-version pin).
Open env items are operational, not parity: AdEnergy email trio pending Resend
DNS; AdEnergy signatory pair; `VAT_RATE` unset by ruling.

## Proposed phase 2 (after founder review)

Order per the brief, ppcmastery first, working instance between steps. All
class-A ports land in this repo once and reach both portals in the same
deploy, so "per instance" here means verification, not separate builds.

1. Class A ports, one commit each, tests + build green: 1h TTL (minutes),
   Meta-only skip (~half hour), Oscar attachments (~1-2h), findings engine
   (~2-3h, includes exercising the Meta audit against a real account),
   migration runner (~1h, needs DB URLs supplied at run time, never stored).
2. Founder rules on B: upsells now or later; Sonnet 5 after the findings
   engine proves out; Meta weeklies yes/no.
3. Acceptance: diag on both portals (commit, provider-ready, memory_store,
   db_ref), Oscar probe with an attachment, one generated Meta audit read for
   invented findings, ledger updated.

Estimate for class A: one working session. Upsells, if ruled in: one more,
plus its own rehearsal.

# Parity ledger

One row per deployment; update as part of any deploy or migration run. This is
the mechanism that makes a parity sync a checklist instead of an excavation:
drift becomes a number anyone can read. Verify a row's serving SHA with
`/api/diag/env` (derived.commit) rather than trusting this file.

Two repos, by ruling, not accident:

- **ppcmastery repo** (this one, `antoinem78/ppcmastery`): app.ppcmastery.ai,
  app.adenergy.online and demo.ppcmastery.ai. One codebase, three Vercel
  projects; code parity between them is by construction, only env and database
  differ. Every push to main deploys ALL THREE.
- **app-wmi repo** (`antoinem78/app-wmi`, the `wmi` remote here): app.wmiltd.com
  and the FZCO portal. Divergent sibling (merge base `ef875f44`, 2026-06-19).
  Improvements cross by HAND-PORT, never merge: WMI must not receive the
  Campaign Builder, this repo must not receive WMI's commerce machinery.

| Deployment | Repo | Serving SHA | DB ref | Migration head | Agents | Contract provider | Last verified |
|---|---|---|---|---|---|---|---|
| app.ppcmastery.ai | ppcmastery | `723e976` | `rnhyegybpwyoxubmgvds` | 0021 (+ agent memory seeded) | Oscar + Bernard, Opus 4.8, memory own-DB | documenso, ready | 2026-08-18, live diag |
| app.adenergy.online | ppcmastery | `723e976` | `hwpmxavoxhimhvqiskfq` | 0021 (seed NOT run, deliberate) | Oscar + Bernard, Opus 4.8, memory own-DB | ⚠ documenso, NOT ready (flip to proposal-engine never took; funnel throws) | 2026-08-18, live diag |
| demo.ppcmastery.ai | ppcmastery | follows main | 0015-0019 era, review seed | analyst only (review mode: no persona, no memory, no exec) | n/a (review) | 2026-08-06 |
| app.wmiltd.com | app-wmi | reference `8811b20` | their 0024 (upsells) | Oscar + Bernard + dispatch, Sonnet 5 | pandadoc/engine | reference only |
| FZCO portal | app-wmi | not tracked here | — | — | engine click-wrap | reference only |

Class-A parity ports landed 2026-08-18 (both portals, same deploy): 1h agent
cache TTL, Meta-only onboarding skip, Oscar chat attachments, Meta audit
findings engine, migration runner with target guard (scripts/migrate.mjs;
every .sql now carries a TARGET header). Outstanding class-B founder rulings:
upsells, Sonnet 5 for the agents, Meta weekly cron.

Numbering fork, so nobody applies the wrong file: the two repos' migrations
diverged at 0019. Theirs 0019=share_dashboard, 0020=write_audit,
0021=platform_client, 0022=agent_memory, 0023=client_currency, 0024=upsells.
Ours: 0019=write_audit, 0020=agent_memory, 0021=share_dashboard;
platform_client and client_currency deliberately not carried. Anything ported
from their 0022+ gets renumbered into OUR sequence (next free: 0022).

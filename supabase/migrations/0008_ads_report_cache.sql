-- Phase 6.1: cache the whole Google Ads dashboard payload per client+window so
-- client refreshes don't eat the shared 15k/day API quota (Phase 4 linking and
-- reporting draw on the same token). TTL is enforced in code (~30 min).
-- Run in the Supabase SQL Editor. (Reporting still works without this — it just
-- queries live every load until the table exists.)

create table ads_report_cache (
  client_id   uuid not null references clients(id) on delete cascade,
  window_days int not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (client_id, window_days)
);

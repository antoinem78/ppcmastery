-- TARGET: PORTAL
-- Phase 6.3: store each weekly report we generate + post to Slack, for history.
-- Run in the Supabase SQL Editor. (The cron still posts to Slack without this;
-- the store is best-effort.)

create table weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

create index weekly_reports_client_idx on weekly_reports (client_id, created_at desc);

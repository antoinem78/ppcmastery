-- 0015: optimization_proposals — the structured approval queue. The AI analyst
-- files proposals; a human approves or dismisses them. Run in BOTH Supabase
-- projects (PPC Mastery + the Command Center deployment). RLS stays off (the
-- server uses the secret key; single-agency). No UTF-8 BOM.

create table if not exists optimization_proposals (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  type        text not null,
  title       text not null,
  rationale   text not null default '',
  details     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
              check (status in ('pending','approved','dismissed','applied','failed','rolled_back')),
  created_by  text not null default 'agent',
  created_at  timestamptz not null default now(),
  decided_by  text,
  decided_at  timestamptz
);

create index if not exists optimization_proposals_status_idx on optimization_proposals (status, created_at desc);
create index if not exists optimization_proposals_client_idx on optimization_proposals (client_id);

-- 0016: P5-Lite execution/audit columns on optimization_proposals. Records who
-- applied/rolled back a proposal and an immutable before/after of the single
-- operation. Run in BOTH Supabase projects. No UTF-8 BOM.

alter table optimization_proposals
  add column if not exists applied_by      text,
  add column if not exists applied_at      timestamptz,
  add column if not exists rolled_back_by  text,
  add column if not exists rolled_back_at  timestamptz,
  add column if not exists execution       jsonb not null default '{}'::jsonb;

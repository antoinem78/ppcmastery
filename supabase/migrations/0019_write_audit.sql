-- 0019: write_audit — the cross-cutting security audit for EVERY Google Ads write
-- attempt (P5-Lite apply/rollback AND Campaign Builder publish), including
-- boundary rejections. Not client-scoped (publish can target a raw customer id
-- with no client record), so client_id is nullable. Append-only. Records the MCC
-- scope, both check results, the approver, and the outcome. Run in BOTH Supabase
-- projects. RLS off (server secret key, single-agency). No UTF-8 BOM.

create table if not exists write_audit (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  deployment       text,                 -- APP_BASE_URL of the deployment
  mcc              text,                 -- login-customer-id (the MCC scope)
  customer_id      text,                 -- target account
  source           text not null,        -- 'p5lite' | 'publish'
  action           text,                 -- action kind / 'publish_campaign'
  phase            text,                 -- 'dry_run' | 'apply' | 'rollback' | 'publish'
  mcc_check        text,                 -- 'passed' | 'violation'
  allowlist_check  text,                 -- 'allowed' | 'not_listed' | 'allow_all' | 'skipped'
  approver         text,
  result           text not null,        -- 'ok' | 'blocked' | 'failed' | 'boundary_violation'
  detail           jsonb not null default '{}'::jsonb,
  client_id        uuid                   -- optional link to clients(id) when known
);

create index if not exists write_audit_created_at_idx on write_audit (created_at desc);
create index if not exists write_audit_customer_idx   on write_audit (customer_id);
create index if not exists write_audit_result_idx     on write_audit (result);

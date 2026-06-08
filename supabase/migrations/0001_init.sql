-- =============================================================================
-- PPC Mastery — Ops Portal — Initial schema (Phase 0)
-- =============================================================================
-- Single-tenant: the tenant is PPC Mastery. Clients are RECORDS, not tenants.
-- RLS is intentionally OFF in v1 (the Next.js backend is the only DB caller, via
-- the service-role key). The schema is RLS-READY: every table is keyed on a
-- client_id (or is the clients table itself), so row-level scoping can be added
-- later without restructuring. See FUTURE_SAAS.md.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums (locked option sets — not free text)
-- ---------------------------------------------------------------------------

-- Client lifecycle.
create type client_status as enum (
  'prospect',    -- closed deal, link not yet sent / not started
  'onboarding',  -- moving through the wizard
  'active',      -- paid & live (set by Stripe webhook in Phase 2)
  'paused',      -- temporarily halted
  'churned'      -- ended (soft end; we don't hard-delete clients)
);

-- Where a client is in the onboarding wizard.
create type onboarding_step as enum (
  'questionnaire',
  'contract',
  'payment',
  'slack',
  'ad_linking',
  'complete'
);

-- Per-step status fields. Later-phase steps default to their "not started"
-- value and stay there until that phase is wired up.
create type contract_status as enum ('not_sent', 'sent', 'signed');       -- PandaDoc, Phase 2
create type payment_status  as enum ('unpaid', 'paid');                    -- Stripe, Phase 2
create type slack_status    as enum ('not_created', 'invited');            -- Slack, Phase 3
create type ad_link_status  as enum ('not_started', 'invited', 'approved'); -- Google Ads, Phase 4

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- clients — one row per PPC Mastery client (the core record)
-- ---------------------------------------------------------------------------
create table clients (
  id            uuid primary key default gen_random_uuid(),
  status        client_status not null default 'prospect',
  company_name  text not null,
  contact_name  text,
  contact_email text not null,
  -- Links the record to the client's Auth0 login once they sign up. Null until then.
  auth0_user_id text unique,
  -- Locked service tier they bought. Nullable text for now; becomes a locked enum
  -- (or FK to a tiers table) in Phase 1 when the tier names/prices are decided.
  service_tier  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- onboarding_state — wizard progress (one row per client)
-- ---------------------------------------------------------------------------
create table onboarding_state (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null unique references clients(id) on delete cascade,
  current_step       onboarding_step not null default 'questionnaire',
  questionnaire_data jsonb not null default '{}'::jsonb,
  contract_status    contract_status not null default 'not_sent',
  payment_status     payment_status  not null default 'unpaid',
  slack_status       slack_status    not null default 'not_created',
  ad_link_status     ad_link_status  not null default 'not_started',
  updated_at         timestamptz not null default now()
);

create index onboarding_state_client_id_idx on onboarding_state(client_id);

create trigger onboarding_state_set_updated_at
  before update on onboarding_state
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- activity_log — append-only event trail (INSERT only; never update/delete)
-- ---------------------------------------------------------------------------
-- The audit history of every client and the debugging trail when an
-- integration (e.g. a Stripe webhook) fires silently.
create table activity_log (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  event_type text not null,                 -- e.g. 'client_created', 'payment_received'
  actor      text not null default 'system', -- e.g. 'admin:jane@…', 'client', 'system:stripe-webhook'
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_client_id_idx  on activity_log(client_id);
create index activity_log_created_at_idx on activity_log(created_at);

-- =============================================================================
-- RLS — intentionally NOT enabled in v1.
-- When the SaaS phase arrives (end-clients log into scoped views), enable RLS and
-- add policies keyed on client_id. This is ADDITIVE — no table restructuring.
-- Example (do NOT run now):
--   alter table clients enable row level security;
--   create policy client_self_select on clients
--     for select using (auth0_user_id = auth.jwt() ->> 'sub');
-- =============================================================================

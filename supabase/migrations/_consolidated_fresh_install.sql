-- =============================================================================
-- CONSOLIDATED FRESH-INSTALL SCHEMA — for a NEW clone database only.
-- =============================================================================
-- This is the end-state of migrations 0001–0011 in a single paste, for standing
-- up a fresh clone (e.g. MCC Command Center). Run it ONCE in the new Supabase
-- project's SQL editor. Do NOT run on an existing database — use the numbered
-- migrations there. The ad_link_status enum is defined complete up front (the
-- 0006 ALTER TYPE ADD VALUE steps are folded in) so it runs cleanly in one go.
-- =============================================================================

-- --- Enums -------------------------------------------------------------------
create type client_status as enum (
  'prospect', 'onboarding', 'active', 'paused', 'churned', 'past_due'  -- past_due: 0013
);

create type onboarding_step as enum (
  'questionnaire', 'contract', 'payment', 'slack', 'ad_linking', 'complete'
);

create type contract_status as enum ('not_sent', 'sent', 'signed');
create type payment_status  as enum ('unpaid', 'paid');
create type slack_status    as enum ('not_created', 'invited');
-- Full lifecycle folded in from 0006 (requested/refused/cancelled):
create type ad_link_status  as enum (
  'not_started', 'invited', 'approved', 'requested', 'refused', 'cancelled'
);

-- --- updated_at trigger helper ----------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --- clients (all columns through 0011) -------------------------------------
create table clients (
  id                   uuid primary key default gen_random_uuid(),
  status               client_status not null default 'prospect',
  company_name         text not null,
  contact_name         text,
  contact_email        text not null,
  auth0_user_id        text unique,
  service_tier         text,
  stripe_customer_id     text,                                   -- 0002
  stripe_subscription_id text,                                   -- 0002
  custom_monthly_price integer,                                  -- 0004
  platforms            text[] not null default '{"Google Ads","Microsoft Ads"}', -- 0005
  access_tasks         text[] not null default '{ga4,gtm,gsc}',  -- 0007
  source               text not null default 'onboarding',       -- 0011 ('onboarding' | 'reporting_only')
  cancellation_effective_at timestamptz,                         -- 0013
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- --- onboarding_state (all columns through 0010) ----------------------------
create table onboarding_state (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null unique references clients(id) on delete cascade,
  current_step       onboarding_step not null default 'questionnaire',
  questionnaire_data jsonb not null default '{}'::jsonb,
  contract_status    contract_status not null default 'not_sent',
  payment_status     payment_status  not null default 'unpaid',
  slack_status       slack_status    not null default 'not_created',
  ad_link_status     ad_link_status  not null default 'not_started',
  pandadoc_document_id text,                                     -- 0003
  details_confirmed  boolean not null default false,            -- 0004
  slack_invite_email text,                                      -- 0004
  google_ads_customer_id   text,                                -- 0006
  google_ads_link_resource text,                                -- 0006
  checklist          jsonb not null default '{}'::jsonb,        -- 0007
  assets_drive_link  text,                                      -- 0007
  google_ads_reporting_customer_id text,                        -- 0010
  microsoft_ads_account_id text,                                -- 0012
  updated_at         timestamptz not null default now()
);

create index onboarding_state_client_id_idx on onboarding_state(client_id);

create trigger onboarding_state_set_updated_at
  before update on onboarding_state
  for each row execute function set_updated_at();

-- --- activity_log ------------------------------------------------------------
create table activity_log (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  event_type text not null,
  actor      text not null default 'system',
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_client_id_idx  on activity_log(client_id);
create index activity_log_created_at_idx on activity_log(created_at);

-- --- ads_report_cache (0008) -------------------------------------------------
create table ads_report_cache (
  client_id   uuid not null references clients(id) on delete cascade,
  window_days int not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (client_id, window_days)
);

-- --- weekly_reports (0009) ---------------------------------------------------
create table weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

create index weekly_reports_client_idx on weekly_reports (client_id, created_at desc);

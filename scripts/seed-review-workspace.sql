-- Seed for the Google-reviewer demo workspace (review deployment's OWN Supabase
-- project — never the operator database). Run AFTER the schema is in place
-- (_consolidated_fresh_install.sql + 0015..0019). Idempotent-ish: safe to run
-- once on a fresh database; re-running would duplicate the proposal/log rows.
--
-- Creates exactly one client — the controlled test account — plus one pending
-- executable proposal (the reviewer's approve -> apply demo) and clean
-- demo-setup activity entries. No UTF-8 BOM.

-- 1. The controlled test account (reporting-only: no funnel/billing surfaces).
with c as (
  insert into clients (company_name, contact_name, contact_email, status, source)
  values (
    'PPC Mastery Controlled Test Account',
    'PPC Mastery Ops',
    'amartin@ppcmastery.ai',
    'active',
    'reporting_only'
  )
  returning id
),
s as (
  insert into onboarding_state (
    client_id, current_step, details_confirmed, payment_status, ad_link_status,
    google_ads_customer_id, google_ads_reporting_customer_id
  )
  select id, 'complete', true, 'paid', 'approved', '2367242101', '2367242101' from c
  returning client_id
),
p as (
  -- 2. One pending executable proposal: add negative keyword "free" (PHRASE) to
  -- the paused Search campaign "POC Test Campaign - AdForge". The P5-Lite
  -- worker enforces the write allowlist (the test CID) at apply time.
  insert into optimization_proposals (client_id, type, title, rationale, details, status, created_by)
  select
    id,
    'negative_keywords',
    'Add negative keyword "free" (phrase match)',
    'Queries containing "free" show low commercial intent for a paid service and waste spend. Adding it as a phrase-match negative keeps the campaign focused on purchase-intent searches.',
    jsonb_build_object('action', jsonb_build_object(
      'kind', 'add_negative_keyword',
      'campaign', 'POC Test Campaign - AdForge',
      'text', 'free',
      'matchType', 'PHRASE'
    )),
    'pending',
    'demo-setup'
  from c
  returning id
)
-- 3. Clean demo-setup activity entries (the only history the reviewer sees).
insert into activity_log (client_id, event_type, actor, payload)
select id, 'demo_setup', 'system:demo-setup',
       jsonb_build_object('note', 'Review workspace provisioned: controlled test account linked (CID 236-724-2101).')
from c
union all
select client_id, 'demo_setup', 'system:demo-setup',
       jsonb_build_object('note', 'Demo proposal seeded: negative keyword "free" (phrase match), pending approval.')
from s;

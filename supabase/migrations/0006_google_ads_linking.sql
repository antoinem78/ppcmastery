-- Phase 4: Google Ads account linking (no client OAuth — client submits their
-- customer ID, admin approves, backend sends the MCC link invitation, client
-- accepts inside Google Ads).
-- Run in the Supabase SQL Editor.

-- Full link lifecycle: not_started -> requested (client submitted ID)
-- -> invited (invitation sent, PENDING at Google) -> approved (ACTIVE)
-- or refused / cancelled.
alter type ad_link_status add value if not exists 'requested';
alter type ad_link_status add value if not exists 'refused';
alter type ad_link_status add value if not exists 'cancelled';

alter table onboarding_state
  add column google_ads_customer_id text,
  add column google_ads_link_resource text; -- mutate result, used for status checks

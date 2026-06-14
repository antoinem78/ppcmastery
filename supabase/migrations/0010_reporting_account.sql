-- Phase 4/6: when the linked Google Ads account is a manager (MCC), the
-- account we REPORT on is a leaf inside it (managers have no campaigns). Store
-- the resolved leaf separately from the linked id. Run in the Supabase SQL Editor.

alter table onboarding_state
  add column google_ads_reporting_customer_id text;

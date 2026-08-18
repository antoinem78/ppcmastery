-- TARGET: PORTAL
-- Microsoft Ads: the client gives us their account number and we link it
-- manually (no API link like Google). Stored on onboarding_state alongside the
-- other access details. Run in the Supabase SQL Editor (both deployments).

alter table onboarding_state
  add column microsoft_ads_account_id text;

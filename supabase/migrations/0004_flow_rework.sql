-- Flow rework (decided June 11 2026): prospects arrive having verbally agreed
-- a quote, so the wizard becomes: confirm details -> contract -> payment ->
-- Slack invite -> onboarding questionnaire -> complete. The questionnaire moves
-- AFTER payment; a custom price can override the tier band for negotiated deals.
-- Run in the Supabase SQL Editor.

-- Negotiated/bespoke monthly price (whole units, deployment currency).
-- Null = use the tier band price.
alter table clients
  add column custom_monthly_price integer;

-- Pre-contract "confirm your details" micro-step (protects the contract merge
-- fields from admin typos).
alter table onboarding_state
  add column details_confirmed boolean not null default false;

-- Email the client wants invited to their Slack channel (may differ from the
-- signer email).
alter table onboarding_state
  add column slack_invite_email text;

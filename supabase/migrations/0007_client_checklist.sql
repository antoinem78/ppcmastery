-- Phase 5: post-payment client home / checklist. Once paid, the client returns
-- to their link and works a checklist (any order, over days) instead of a
-- linear flow.
-- Run in the Supabase SQL Editor.

-- Which guided access-grant tasks this client needs (admin picks at creation).
alter table clients
  add column access_tasks text[] not null default '{ga4,gtm,gsc}';

-- Self-attested task completions (e.g. {"ga4": true, "gtm": false}).
alter table onboarding_state
  add column checklist jsonb not null default '{}'::jsonb,
  -- Creative assets drive link — its own task, moved out of the questionnaire.
  add column assets_drive_link text;

-- Platform selection at client creation (Google Ads / Microsoft Ads / Meta
-- Ads, any combination) — drives the plan wording on quotes and contracts.
-- Existing clients default to the paid-search pair.
-- Run in the Supabase SQL Editor.

alter table clients
  add column platforms text[] not null default '{"Google Ads","Microsoft Ads"}';

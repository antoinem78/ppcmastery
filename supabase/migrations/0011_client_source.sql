-- Reporting-only clients: existing clients whose account already sits under our
-- MCC. They skip the onboarding funnel (no contract/payment) — we just want the
-- dashboard + weekly reports. Distinguish them so the admin view adapts and the
-- public wizard never shows for them. Run in the Supabase SQL Editor.

alter table clients
  add column source text not null default 'onboarding'; -- 'onboarding' | 'reporting_only'

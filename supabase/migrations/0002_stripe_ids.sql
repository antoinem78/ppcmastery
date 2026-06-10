-- Phase 2: store the Stripe identifiers on the client record so we can manage
-- the subscription later (cancellation with 31-day notice, payment failures).
-- Run in the Supabase SQL Editor.

alter table clients
  add column stripe_customer_id text,
  add column stripe_subscription_id text;

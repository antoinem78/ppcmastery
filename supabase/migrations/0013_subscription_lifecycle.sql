-- Subscription lifecycle: a dunning state for failed renewals, and the
-- scheduled cancellation date (31-day notice). Run in BOTH Supabase projects.

-- 'past_due' = a renewal payment failed; the client is in dunning, not churned.
alter type client_status add value if not exists 'past_due';

-- When a cancellation has been scheduled (now + 31 days), the date it takes
-- effect. Null = no cancellation pending. The client stays 'active' until
-- Stripe actually ends the subscription (then the webhook flips it to churned).
alter table clients
  add column cancellation_effective_at timestamptz;

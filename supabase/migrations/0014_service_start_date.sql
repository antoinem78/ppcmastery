-- 0014: customizable contract start date for bank-transfer clients.
-- Set when an admin marks a client paid manually (bank transfer) so onboarding
-- unlocks without Stripe; blank means the contract starts today.
alter table onboarding_state add column service_start_date date;

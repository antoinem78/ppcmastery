-- 0021_share_dashboard.sql
-- Hardened client-share links (ported from the app-wmi sibling's 0019 — the
-- numbering forked at 0019). Each client gets an unguessable share token,
-- separate from the client id (which also names the onboarding link), and
-- sharing is OFF until the admin enables it — so a link can be revoked by
-- flipping share_enabled without touching the client. /share/<token> renders
-- the read-only dashboard only while share_enabled is true.
-- Run in the Supabase SQL Editor. Idempotent.

alter table clients add column if not exists share_enabled boolean not null default false;
alter table clients add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists clients_share_token_idx on clients(share_token);

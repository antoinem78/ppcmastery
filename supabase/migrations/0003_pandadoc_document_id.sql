-- TARGET: PORTAL
-- Phase 2: track the PandaDoc document backing the contract step.
-- Run in the Supabase SQL Editor.

alter table onboarding_state
  add column pandadoc_document_id text;

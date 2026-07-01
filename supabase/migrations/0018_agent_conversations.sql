-- 0018: persistent AI-analyst conversations, keyed by scope (a client id, or
-- 'general'). Lets the chat carry a per-account memory across pages/sessions.
-- Run in BOTH Supabase projects. No UTF-8 BOM.

create table if not exists agent_conversations (
  scope       text primary key,          -- client id (uuid as text), or 'general'
  messages    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

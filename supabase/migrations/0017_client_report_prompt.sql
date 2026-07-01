-- 0017: per-account report narrative prompt. Optional account-specific guidance
-- appended to the LLM narrative system prompt (still subordinate to the hard
-- rules). Edited on the admin client page. Run in BOTH Supabase projects. No BOM.

alter table clients add column if not exists report_prompt text;

// Persistence for the AI-analyst chat. Conversations are stored per scope (a
// client id, or "general") so the chat has a per-account memory that survives
// navigation and reloads. Capped to the most recent turns to bound token cost.
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { ChatMessage } from "@/lib/integrations/anthropic/agent";

const MAX_STORED = 40; // keep the last N messages

export async function getConversation(scope: string): Promise<ChatMessage[]> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.from("agent_conversations").select("messages").eq("scope", scope).single();
  const msgs = (data?.messages as ChatMessage[] | undefined) ?? [];
  return Array.isArray(msgs) ? msgs : [];
}

export async function saveConversation(scope: string, messages: ChatMessage[]): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const trimmed = messages.slice(-MAX_STORED);
  await supabase.from("agent_conversations").upsert({ scope, messages: trimmed, updated_at: new Date().toISOString() });
}

export async function clearConversation(scope: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  await supabase.from("agent_conversations").delete().eq("scope", scope);
}

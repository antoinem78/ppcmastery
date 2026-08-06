// Durable per-agent memory. Deliberately separate from agent_conversations:
// clearing the chat drops the transcript and must leave what the agent KNOWS
// intact. Founder ruling 2026-07-30: these are senior strategists, so they carry
// client context and prior decisions across sessions indefinitely and forget only
// on instruction.
//
// Scoped by `agent` ('oscar' for Google Ads, 'bernard' for Meta). Memories are
// never shared implicitly: Bernard should not inherit Oscar's conclusions about a
// different platform.
//
// Best-effort throughout, matching agent-conversations: if migration 0020 has not
// been applied, reads return empty and writes report a failure the agent can
// relay, rather than throwing and killing the turn.
//
// ONE MIND, MANY OFFICES (option, unused here): an agent is one person however
// many portals he appears in, so his memory CAN live in a single shared store
// across entity deployments via MEMORY_SUPABASE_URL + MEMORY_SUPABASE_SECRET_KEY.
// This deployment deliberately leaves them unset (founder decision 2026-08-06:
// PPC Mastery's agents keep their own memory, separate from WMI's) — unset means
// the deployment's own database. Conversations stay per-deployment either way.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function memoryClient(): SupabaseClient {
  const url = process.env.MEMORY_SUPABASE_URL;
  const key = process.env.MEMORY_SUPABASE_SECRET_KEY;
  if (url && key) {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createSupabaseAdminClient();
}

export type MemoryKind =
  | "client"
  | "account"
  | "decision"
  | "preference"
  | "strategy"
  | "fact";

export const MEMORY_KINDS: MemoryKind[] = [
  "client",
  "account",
  "decision",
  "preference",
  "strategy",
  "fact",
];

export interface Memory {
  id: string;
  kind: MemoryKind;
  subject: string;
  content: string;
  createdAt: string;
  /** The agent that wrote it (owner; only the owner can revise or forget). */
  author: string;
  /** Visible to every agent when true. */
  shared: boolean;
}

/** Ceiling on what we inject into the system prompt. Memory is meant to grow
 *  for years; the prompt is not. When this bites, the fix is the agent pruning
 *  and consolidating rather than us silently truncating more. */
const MAX_MEMORIES = 150;
const MAX_CHARS = 24_000;

/** Every live memory, oldest first within each subject so a subject reads as a
 *  small narrative rather than a shuffled pile. */
export async function loadMemories(agent: string): Promise<Memory[]> {
  try {
    const supabase = memoryClient();
    // Own memories plus anything any agent marked shared.
    const { data, error } = await supabase
      .from("agent_memory")
      .select("id, kind, subject, content, created_at, agent, shared")
      .or(`agent.eq.${agent},shared.eq.true`)
      .is("forgotten_at", null)
      .order("subject", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(MAX_MEMORIES);
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      kind: r.kind as MemoryKind,
      subject: r.subject as string,
      content: r.content as string,
      createdAt: r.created_at as string,
      author: r.agent as string,
      shared: r.shared === true,
    }));
  } catch {
    return [];
  }
}

/** Render memories for the system prompt, grouped by subject, with ids so
 *  the agent can revise or forget a specific one by reference. */
export function renderMemories(memories: Memory[], viewer?: string): string {
  if (!memories.length) {
    return "Your memory is currently empty. As soon as you learn something durable, write it down with the remember tool.";
  }
  const bySubject = new Map<string, Memory[]>();
  for (const m of memories) {
    const list = bySubject.get(m.subject) ?? [];
    list.push(m);
    bySubject.set(m.subject, list);
  }
  const lines: string[] = [];
  let chars = 0;
  let dropped = 0;
  for (const [subject, list] of bySubject) {
    const header = `\n[${subject}]`;
    if (chars + header.length > MAX_CHARS) { dropped += list.length; continue; }
    lines.push(header);
    chars += header.length;
    for (const m of list) {
      const provenance = m.shared
        ? (viewer && m.author !== viewer ? `, SHARED by ${m.author}` : ", shared")
        : "";
      const line = `  (${m.kind}, ${m.createdAt.slice(0, 10)}, id ${m.id}${provenance}) ${m.content}`;
      if (chars + line.length > MAX_CHARS) { dropped++; continue; }
      lines.push(line);
      chars += line.length;
    }
  }
  if (dropped) {
    lines.push(
      `\n[${dropped} older memories omitted for length. Consolidate related memories so nothing important sits outside this window.]`,
    );
  }
  return lines.join("\n").trim();
}

export async function remember(
  agent: string,
  kind: MemoryKind,
  subject: string,
  content: string,
  actor: string,
  shared = false,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const text = content.trim();
  if (!text) return { ok: false, error: "Nothing to remember (empty content)." };
  try {
    const supabase = memoryClient();
    const { data, error } = await supabase
      .from("agent_memory")
      .insert({ agent, kind, subject: subject.trim() || "global", content: text, actor, ...(shared ? { shared: true } : {}) })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Memory write failed." };
    }
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Memory write failed." };
  }
}

/** Correct a memory in place. Used when a fact changes rather than turning out
 *  to have been wrong; for wrong, forget it and say why. */
export async function reviseMemory(
  agent: string,
  id: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const text = content.trim();
  if (!text) return { ok: false, error: "Nothing to write (empty content)." };
  try {
    const supabase = memoryClient();
    const { error, count } = await supabase
      .from("agent_memory")
      .update({ content: text, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", id)
      .eq("agent", agent)
      .is("forgotten_at", null);
    if (error) return { ok: false, error: error.message };
    if (!count) return { ok: false, error: "No live memory with that id for this agent." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Memory revision failed." };
  }
}

/** Soft delete. Nothing is destroyed: a memory the founder asked the agent to
 *  drop is still evidence of what he believed and when. */
export async function forgetMemory(
  agent: string,
  id: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = memoryClient();
    const { error, count } = await supabase
      .from("agent_memory")
      .update(
        { forgotten_at: new Date().toISOString(), forgotten_reason: reason.trim() || null },
        { count: "exact" },
      )
      .eq("id", id)
      .eq("agent", agent)
      .is("forgotten_at", null);
    if (error) return { ok: false, error: error.message };
    if (!count) return { ok: false, error: "No live memory with that id for this agent." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Forget failed." };
  }
}

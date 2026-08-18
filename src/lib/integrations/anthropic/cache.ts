// Prompt caching for the chat agents.
//
// Both agents run a tool loop of up to 8 iterations per user message, and every
// iteration re-sends the whole prefix: tool definitions, system brief, rendered
// memory block, and the transcript so far. Without caching that stable prefix
// (several thousand tokens before the transcript) is paid at full price on
// every iteration. Caching is transparent to behaviour, so if a reply changes
// after this lands, something is marked wrong.
//
// Breakpoint budget is FOUR. We spend: system brief, memory block, and one
// moving marker at the tail of the transcript. One spare. Anything added must
// free one first.
import type Anthropic from "@anthropic-ai/sdk";

/** Any message list, plain or beta: this only touches content blocks. */
type AnyMessages = { role: string; content: unknown }[];

const EPHEMERAL = { type: "ephemeral" as const };

/**
 * Move the conversation cache breakpoint to the tail of the transcript, which
 * is what makes the tool loop cheap: each iteration appends the assistant turn
 * and its tool results, so without a moving marker every iteration re-pays for
 * everything the previous ones sent.
 *
 * Old markers are cleared first, because the API caps breakpoints at four and
 * the two system blocks already hold two.
 */
export function markConversationCache(messages: AnyMessages): void {
  const asRecords = (c: unknown) => c as unknown as Record<string, unknown>[];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const block of asRecords(m.content)) {
      if (block && typeof block === "object") delete block.cache_control;
    }
  }
  const last = messages[messages.length - 1];
  if (!last) return;
  if (typeof last.content === "string") {
    last.content = [{ type: "text", text: last.content, cache_control: EPHEMERAL }];
    return;
  }
  const blocks = asRecords(last.content);
  const tail = blocks[blocks.length - 1];
  if (tail && typeof tail === "object") tail.cache_control = EPHEMERAL;
}

/**
 * The system prompt as cache-separated blocks.
 *
 * The brief is constant, so it caches together with the tool definitions ahead
 * of it in the prefix (tools need no marker of their own). The memory block
 * gets its own breakpoint because it changes whenever the agent writes a
 * memory: that then invalidates only the second block, and the brief still
 * reads back cheap.
 *
 * Anything that varies per request (the focus account, for instance) must go
 * AFTER the breakpoints as its own uncached block, never concatenated into the
 * brief, or every request is a cache miss.
 */
export function systemBlocks(
  base: string,
  memoryBlock: string | null,
  perRequest = "",
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    // The brief never changes, and the founder chats intermittently: with the
    // default 5-minute TTL the cache expired between messages and every message
    // re-paid the write. 1h costs a 2x write premium (vs 1.25x) but the brief
    // is written once an hour instead of once a message. The memory block stays
    // at 5m: it changes whenever the agent writes a memory, so a long TTL would
    // mostly buy invalidated entries. (Ported from app-wmi 4f1daec.)
    { type: "text", text: base, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
  if (memoryBlock !== null) {
    blocks.push({
      type: "text",
      text: `=== MEMORY (yours, written by you, persists across all sessions) ===\n${memoryBlock}\n=== END MEMORY ===`,
      cache_control: EPHEMERAL,
    });
  }
  if (perRequest) blocks.push({ type: "text", text: perRequest });
  return blocks;
}

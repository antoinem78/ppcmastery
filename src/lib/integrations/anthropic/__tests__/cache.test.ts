import { describe, it, expect } from "vitest";
import { markConversationCache, systemBlocks } from "../cache";

type Msg = { role: string; content: unknown };
const marks = (m: Msg) =>
  typeof m.content === "string"
    ? 0
    : (m.content as Record<string, unknown>[]).filter((b) => b.cache_control).length;
const total = (ms: Msg[]) => ms.reduce((n, m) => n + marks(m), 0);

describe("markConversationCache", () => {
  it("marks the last block of the last message", () => {
    const ms: Msg[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
    ];
    markConversationCache(ms);
    const blocks = ms[1].content as Record<string, unknown>[];
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("keeps exactly one marker as the loop appends turns", () => {
    const ms: Msg[] = [{ role: "user", content: [{ type: "text", text: "q" }] }];
    markConversationCache(ms);
    expect(total(ms)).toBe(1);

    // Iteration 2: assistant turn plus tool results appended.
    ms.push({ role: "assistant", content: [{ type: "tool_use", id: "t1" }] });
    ms.push({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] });
    markConversationCache(ms);
    expect(total(ms)).toBe(1);

    // Iteration 3: still one, and it has moved to the newest message.
    ms.push({ role: "assistant", content: [{ type: "text", text: "done" }] });
    markConversationCache(ms);
    expect(total(ms)).toBe(1);
    expect(marks(ms[ms.length - 1])).toBe(1);
  });

  it("converts a string-content message into a marked block", () => {
    const ms: Msg[] = [{ role: "user", content: "plain string" }];
    markConversationCache(ms);
    expect(ms[0].content).toEqual([
      { type: "text", text: "plain string", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("does not throw on an empty transcript", () => {
    expect(() => markConversationCache([])).not.toThrow();
  });
});

describe("systemBlocks", () => {
  it("caches the brief and the memory block separately", () => {
    const b = systemBlocks("BRIEF", "MEM");
    expect(b).toHaveLength(2);
    expect(b[0].cache_control).toEqual({ type: "ephemeral" });
    expect(b[1].cache_control).toEqual({ type: "ephemeral" });
    expect(b[1].text).toContain("MEM");
  });

  it("omits the memory block entirely when there is none (review mode)", () => {
    const b = systemBlocks("BRIEF", null);
    expect(b).toHaveLength(1);
    expect(b[0].text).toBe("BRIEF");
  });

  it("puts per-request context AFTER the breakpoints, uncached", () => {
    const b = systemBlocks("BRIEF", "MEM", "FOCUS: Acme");
    expect(b).toHaveLength(3);
    // An uncached tail is the whole point: cached, this would miss every request.
    expect(b[2].cache_control).toBeUndefined();
    expect(b[2].text).toBe("FOCUS: Acme");
    // ...and it must not have leaked into the cached brief.
    expect(b[0].text).toBe("BRIEF");
  });

  it("never exceeds the four-breakpoint cap, leaving one spare for the transcript", () => {
    const cached = systemBlocks("BRIEF", "MEM", "FOCUS").filter((x) => x.cache_control);
    expect(cached.length).toBeLessThanOrEqual(3);
  });
});

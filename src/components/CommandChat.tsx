"use client";
import { useRef, useState } from "react";

// Floating Command Center analyst. Streams the read-only agent (NDJSON: status |
// delta | reset | done | error). It analyses and files proposals; it never
// executes. Sits bottom-right so it doesn't disturb the dashboard layout.
interface Msg { role: "user" | "assistant"; content: string }

const SUGGESTIONS = [
  "Which accounts need attention this week?",
  "Summarise performance across all accounts.",
  "Any accounts spending with no conversions?",
];

export function CommandChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollDown = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setStatus(null);
    setBusy(true);
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    scrollDown();

    const setLastAssistant = (fn: (prev: string) => string) =>
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: fn(last.content) };
        return copy;
      });

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Chat failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as { type: string; text?: string };
          if (e.type === "status") setStatus(e.text ?? null);
          else if (e.type === "reset") { setLastAssistant(() => ""); setStatus(null); }
          else if (e.type === "delta") { setStatus(null); setLastAssistant((p) => p + (e.text ?? "")); scrollDown(); }
          else if (e.type === "error") setLastAssistant((p) => p || `Sorry, ${e.text}`);
        }
      }
    } catch (e) {
      setLastAssistant((p) => p || `Sorry, ${e instanceof Error ? e.message : "something went wrong."}`);
    } finally {
      setStatus(null);
      setBusy(false);
      scrollDown();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-[#0B1F3A] px-5 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105"
      >
        ✦ Ask the analyst
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[34rem] w-[24rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-[#0B1F3A] px-4 py-3 text-white">
        <div className="text-sm font-semibold">Command Center analyst</div>
        <button type="button" onClick={() => setOpen(false)} className="text-white/70 hover:text-white" aria-label="Close">✕</button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">Ask about the accounts. I read live figures and can file optimisation proposals for your approval. I never make changes myself.</p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-blue-400 hover:bg-zinc-50">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-800"}`}>
              {m.content || (busy && i === messages.length - 1 ? <span className="text-zinc-400">…</span> : "")}
            </div>
          </div>
        ))}
        {status && <div className="flex items-center gap-2 text-xs text-zinc-400"><span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />{status}</div>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex items-center gap-2 border-t border-zinc-200 p-3"
      >
        <input
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 focus:border-blue-400 focus:outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the accounts…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-[#0B1F3A] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Send</button>
      </form>
    </div>
  );
}

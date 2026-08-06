"use client";
import { useEffect, useRef, useState } from "react";
import { ACCEPT_ATTR, MAX_FILES } from "@/lib/attachment-limits";

// Bernard's full-page chat. Same NDJSON contract as the Oscar panel
// (status | delta | reset | artifact | done | error), plus file attachments:
// a brief, a client PDF or a spreadsheet can be dropped straight into the
// conversation. The transcript lives server-side under the "bernard" scope, so
// the route hydrates it on load and persists each turn (including what was
// attached) without the client having to hold it.
interface Msg { role: "user" | "assistant"; content: string }
interface Artifact { href: string; label: string }

const SUGGESTIONS = [
  "Which Meta accounts can you see?",
  "Audit the main account for the last 30 days.",
  "Read the live ad copy and flag anything off-brand.",
];

export function BernardChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A send in flight must not be clobbered by a late hydration GET.
  const streamingRef = useRef(false);

  const scrollDown = () => requestAnimationFrame(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  });

  useEffect(() => {
    fetch("/api/bernard/chat")
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => { if (!streamingRef.current) { setMessages(d.messages ?? []); scrollDown(); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function clearThread() {
    if (!window.confirm("Clear this conversation? Bernard's memory is separate and is not affected.")) return;
    setMessages([]);
    setArtifacts([]);
    setStatus(null);
    try { await fetch("/api/bernard/chat", { method: "DELETE" }); } catch { /* best-effort */ }
  }

  async function send(text: string) {
    const q = text.trim();
    if ((!q && files.length === 0) || busy) return;
    setInput("");
    setError(null);
    setStatus(null);
    setArtifacts([]);
    setBusy(true);
    streamingRef.current = true;

    const sent = files;
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    const shown = sent.length ? [q, `(attached: ${sent.map((f) => f.name).join(", ")})`].filter(Boolean).join("\n") : q;
    const history: Msg[] = [...messages, { role: "user", content: q || "(see attached)" }];
    setMessages([...messages, { role: "user", content: shown }, { role: "assistant", content: "" }]);
    scrollDown();

    let assistant = "";
    const paint = () => setMessages([...messages, { role: "user", content: shown }, { role: "assistant", content: assistant }]);

    try {
      let res: Response;
      if (sent.length) {
        const form = new FormData();
        form.append("messages", JSON.stringify({ messages: history }));
        for (const f of sent) form.append("files", f);
        res = await fetch("/api/bernard/chat", { method: "POST", body: form });
      } else {
        res = await fetch("/api/bernard/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Bernard failed (${res.status}).`);
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
          const e = JSON.parse(line) as { type: string; text?: string; label?: string };
          if (e.type === "status") setStatus(e.text ?? null);
          else if (e.type === "artifact" && e.text) {
            const href = e.text;
            const label = e.label ?? "Download";
            setArtifacts((prev) => (prev.some((a) => a.href === href) ? prev : [...prev, { href, label }]));
          } else if (e.type === "reset") { assistant = ""; setStatus(null); paint(); }
          else if (e.type === "delta") { assistant += e.text ?? ""; setStatus(null); paint(); scrollDown(); }
          else if (e.type === "error") { assistant = assistant || `Sorry, ${e.text}`; paint(); }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setError(msg);
      assistant = assistant || `Sorry, ${msg}`;
      paint();
    } finally {
      setStatus(null);
      setBusy(false);
      streamingRef.current = false;
      setMessages([...messages, { role: "user", content: shown }, { role: "assistant", content: assistant }]);
      scrollDown();
    }
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Bernard</h2>
          <p className="text-xs text-zinc-500">Meta strategist. Reads accounts, audits and drafts. He cannot change anything on Meta.</p>
        </div>
        <button type="button" onClick={clearThread} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
          Clear conversation
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400"><span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              Ask Bernard about any Meta ad account the system user can see. He reads performance, the live ad copy, audiences,
              ad set configuration and pixel volume, and writes a full audit document. Attach a brief or a PDF and he will read it.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-blue-400 hover:bg-zinc-50">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-800"}`}>
                {m.content || (busy && i === messages.length - 1 ? <span className="text-zinc-400">…</span> : "")}
              </div>
            </div>
          ))
        )}
        {artifacts.map((a) => (
          <a key={a.href} href={a.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:border-blue-400 hover:bg-zinc-50">
            ⬇ {a.label}
          </a>
        ))}
        {status && <div className="flex items-center gap-2 text-xs text-zinc-400"><span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />{status}</div>}
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-5 py-2">
          {files.map((f) => (
            <span key={f.name} className="flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
              {f.name}
              <button type="button" onClick={() => setFiles((prev) => prev.filter((x) => x !== f))} className="text-zinc-400 hover:text-zinc-700" aria-label={`Remove ${f.name}`}>×</button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 border-t border-zinc-200 p-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []).slice(0, MAX_FILES);
            setFiles(picked);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          title="Attach a PDF, Word document, Markdown, text or CSV file"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
        >
          📎
        </button>
        <input
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 focus:border-blue-400 focus:outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Bernard about a Meta account…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || (!input.trim() && files.length === 0)} className="rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Send</button>
      </form>
    </div>
  );
}

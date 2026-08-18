"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ACCEPT_ATTR, MAX_FILES } from "@/lib/attachment-limits";

// Floating chat with Oscar, the Google Ads analyst, mounted in the admin layout
// so it stays open across pages (the layout persists across navigations).
// Conversations are stored server-side per scope (an account, or "general"), so
// switching pages keeps the thread and reopening an account recalls the prior
// conversation. Oscar reads any account under the MCC, files proposals, and can
// apply or build on the founder's explicit word, behind the same machine gates
// as the Proposals page.
interface Msg { role: "user" | "assistant"; content: string }
interface Account { clientId: string; company: string }
/** A downloadable deliverable the agent produced this turn (e.g. an audit). */
interface Artifact { href: string; label: string }

const SUGGESTIONS = [
  "Which accounts need attention this week?",
  "Summarise performance across all accounts.",
  "Any accounts spending with no conversions?",
];

// /clients/<uuid> (not /new, /import, /reporting, and any subpage like /report).
function clientIdFromPath(path: string): string | null {
  const m = path.match(/^\/clients\/([0-9a-fA-F-]{36})(?:\/|$)/);
  return m ? m[1] : null;
}

export function CommandChat({ reviewMode = false }: { reviewMode?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [scope, setScope] = useState("general");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  // Artifacts are per-answer, not persisted with the transcript (the document is
  // regenerated from live data on open, so a stale link in history would mislead).
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Files staged for the next send (PDF, Word, Markdown, text; same ceilings
  // as Bernard via the shared attachment-limits module).
  const [pending, setPending] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks the CURRENT scope so an in-flight reply for account A never paints
  // into (or persists under) account B after a mid-stream switch.
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  // Scope with a send in flight (null = none): the hydration GET must never
  // clobber a conversation that is streaming right now (switching away and
  // back mid-answer re-runs the load effect, and a slow response would land
  // AFTER the live paints and blank the reply).
  const streamingScopeRef = useRef<string | null>(null);

  const scrollDown = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  // Restore open state; load the account roster once.
  useEffect(() => {
    setOpen(localStorage.getItem("cc_open") === "1");
    fetch("/api/agent/accounts").then((r) => (r.ok ? r.json() : { accounts: [] })).then((d) => setAccounts(d.accounts ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem("cc_open", open ? "1" : "0");
  }, [open]);

  // Auto-follow the account you're viewing.
  useEffect(() => {
    const pid = clientIdFromPath(pathname);
    if (pid && pid !== scope) setScope(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Load the stored conversation whenever the scope changes — unless a reply
  // is streaming into this very scope (the live thread wins; it persists
  // itself when the stream finishes).
  useEffect(() => {
    if (streamingScopeRef.current === scope) return;
    let cancelled = false;
    setLoadingHistory(true);
    fetch(`/api/agent/conversation?scope=${encodeURIComponent(scope)}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => {
        if (!cancelled && streamingScopeRef.current !== scope) { setMessages(d.messages ?? []); scrollDown(); }
      })
      .catch(() => { if (!cancelled && streamingScopeRef.current !== scope) setMessages([]); })
      .finally(() => { if (!cancelled) setLoadingHistory(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const scopeLabel = scope === "general" ? "All accounts" : accounts.find((a) => a.clientId === scope)?.company || "This account";

  async function persist(toScope: string, msgs: Msg[]) {
    try {
      await fetch("/api/agent/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: toScope, messages: msgs }),
      });
    } catch { /* best-effort */ }
  }

  async function reset() {
    if (!window.confirm(`Clear this ${scope === "general" ? "conversation" : "account's conversation"}?`)) return;
    setMessages([]);
    setStatus(null);
    setArtifacts([]);
    try {
      await fetch(`/api/agent/conversation?scope=${encodeURIComponent(scope)}`, { method: "DELETE" });
    } catch { /* best-effort */ }
  }

  // Copy eagerly: a FileList is live-bound to its input element, so resetting
  // the input's value (done straight after, to allow re-picking the same file)
  // empties it before a deferred setState updater would read it.
  function addFiles(list: FileList | null) {
    const incoming = list ? Array.from(list) : [];
    if (!incoming.length) return;
    setPending((p) => [...p, ...incoming].slice(0, MAX_FILES));
  }

  async function send(text: string) {
    const q = text.trim();
    const files = pending;
    // A file on its own is a valid turn; give Oscar a default instruction.
    if ((!q && files.length === 0) || busy) return;
    const shown =
      q ||
      (files.length === 1
        ? "Read this and tell me what you make of it."
        : "Read these and tell me what you make of them.");
    // On screen the turn shows the filenames; the API gets the plain text (the
    // files ride as multipart parts and become document blocks server-side).
    const label = files.length
      ? `${shown}\n\n${files.map((f) => `[attached ${f.name}]`).join("\n")}`
      : shown;
    setInput("");
    setPending([]);
    setStatus(null);
    setArtifacts([]);
    setBusy(true);
    const sendScope = scope; // freeze: replies belong to the scope they were asked in
    streamingScopeRef.current = sendScope;
    const history: Msg[] = [...messages, { role: "user", content: shown }];
    const display: Msg[] = [...messages, { role: "user", content: label }];
    // What the user turn persists as. The route upgrades it via user_stored
    // (attachment transcript notes + text) so extracted text survives into
    // later sessions; the live view keeps the compact filename markers.
    let storedUser = label;
    setMessages([...display, { role: "assistant", content: "" }]);
    scrollDown();

    let assistant = ""; // accumulates the final answer (reset drops tool preamble)
    const paint = () => {
      if (scopeRef.current === sendScope) setMessages([...display, { role: "assistant", content: assistant }]);
    };

    try {
      const focusClientId = sendScope === "general" ? null : sendScope;
      let res: Response;
      if (files.length) {
        const form = new FormData();
        form.set("messages", JSON.stringify({ messages: history, focusClientId }));
        if (focusClientId) form.set("focusClientId", focusClientId);
        for (const f of files) form.append("files", f);
        res = await fetch("/api/agent/chat", { method: "POST", body: form });
      } else {
        res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, focusClientId }),
        });
      }
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
          const e = JSON.parse(line) as { type: string; text?: string; label?: string };
          if (e.type === "status") setStatus(e.text ?? null);
          else if (e.type === "user_stored" && e.text) storedUser = e.text;
          else if (e.type === "artifact" && e.text) {
            const href = e.text;
            const label = e.label ?? "Download";
            setArtifacts((prev) => (prev.some((a) => a.href === href) ? prev : [...prev, { href, label }]));
          }
          else if (e.type === "reset") { assistant = ""; setStatus(null); paint(); }
          else if (e.type === "delta") { assistant += e.text ?? ""; setStatus(null); paint(); scrollDown(); }
          else if (e.type === "error") { assistant = assistant || `Sorry, ${e.text}`; paint(); }
        }
      }
    } catch (e) {
      assistant = assistant || `Sorry, ${e instanceof Error ? e.message : "something went wrong."}`;
      paint();
    } finally {
      setStatus(null);
      setBusy(false);
      streamingScopeRef.current = null;
      if (scopeRef.current === sendScope) {
        setMessages([...display, { role: "assistant", content: assistant }]);
        scrollDown();
      }
      // Always persist under the ORIGINATING scope, even if the user switched.
      // The persisted user turn carries the attachment transcript notes
      // (storedUser), so what a file said is still in the thread next session.
      const final: Msg[] = [...messages, { role: "user", content: storedUser }, { role: "assistant", content: assistant }];
      if (assistant.trim()) void persist(sendScope, final);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-[#0B1F3A] px-5 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 print:hidden"
      >
        ✦ Ask the analyst
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[36rem] w-[25rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl print:hidden">
      <div className="border-b border-zinc-200 bg-[#0B1F3A] px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Analyst · {scopeLabel}</div>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={reset} className="text-white/60 hover:text-white" title="Clear this conversation">Reset</button>
            <button type="button" onClick={() => setOpen(false)} className="text-white/70 hover:text-white" aria-label="Close">✕</button>
          </div>
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="mt-2 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white focus:outline-none"
        >
          <option value="general" className="text-zinc-800">All accounts</option>
          {accounts.map((a) => (
            <option key={a.clientId} value={a.clientId} className="text-zinc-800">{a.company || a.clientId}</option>
          ))}
        </select>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loadingHistory ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400"><span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              {scope !== "general"
                ? `Chatting about ${scopeLabel}. Ask anything, I'll pick up where we left off.`
                : reviewMode
                  ? "Ask about the accounts. I read live figures and can file optimisation proposals for your approval. I never make changes myself."
                  : "Ask Oscar about any account under the MCC. He reads live figures, files optimisation proposals, and on your explicit word can apply them or build a campaign, behind the same guardrails as the Proposals page."}
            </p>
            {scope === "general" && (
              <div className="flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-blue-400 hover:bg-zinc-50">{s}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-800"}`}>
                {m.content || (busy && i === messages.length - 1 ? <span className="text-zinc-400">…</span> : "")}
              </div>
            </div>
          ))
        )}
        {artifacts.map((a) => (
          <a
            key={a.href}
            href={a.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:border-blue-400 hover:bg-zinc-50"
          >
            ⬇ {a.label}
          </a>
        ))}
        {status && <div className="flex items-center gap-2 text-xs text-zinc-400"><span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />{status}</div>}
      </div>

      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 px-3 pt-2">
          {pending.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700"
            >
              <span className="max-w-[14rem] truncate">{f.name}</span>
              <span className="text-zinc-400">{(f.size / 1000).toFixed(0)}KB</span>
              <button
                type="button"
                onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="ml-0.5 text-zinc-400 hover:text-zinc-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 border-t border-zinc-200 p-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Attach a PDF, Word document, Markdown or text file"
          aria-label="Attach a file"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
        >
          📎
        </button>
        <input
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 focus:border-blue-400 focus:outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${scope === "general" ? "the accounts" : scopeLabel}…`}
          disabled={busy}
        />
        <button type="submit" disabled={busy || (!input.trim() && pending.length === 0)} className="rounded-lg bg-[#0B1F3A] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Send</button>
      </form>
    </div>
  );
}

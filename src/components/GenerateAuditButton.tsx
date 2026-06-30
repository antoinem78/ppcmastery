"use client";
import { useState } from "react";

// Triggers the audit .docx generation and downloads it. Used on the client page
// and (compact) on the Command Center. Generation takes ~1-2 min (12-month pull
// + LLM prose), so it shows a working state and surfaces errors.
export function GenerateAuditButton({
  clientId,
  company,
  compact = false,
}: {
  clientId: string;
  company: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/audit/${clientId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Audit failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${company} Google Ads Audit.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Audit failed.");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title={err ?? "Generate Google Ads audit"}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
      >
        {busy ? "Generating…" : "Audit"}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90 disabled:opacity-50"
      >
        {busy ? "Generating audit… (~1-2 min)" : "⬇ Generate Google Ads audit"}
      </button>
      {err && <span className="max-w-xs text-right text-xs text-red-600">{err}</span>}
    </div>
  );
}

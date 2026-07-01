"use client";
import { useState, useTransition } from "react";
import { sendReportToSlackAction } from "@/app/(admin)/clients/actions";

// Client-level range picker + "Send to Slack". Builds the report for the chosen
// range and posts a draft to the review channel for human review.
const RANGES = [
  { key: "mon_sun", label: "Last week (Mon-Sun)" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "Last month" },
];

export function ReportSender({ clientId }: { clientId: string }) {
  const [range, setRange] = useState("mon_sun");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await sendReportToSlackAction(clientId, range);
      setMsg("error" in res ? { ok: false, text: res.error } : { ok: true, text: res.message });
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          disabled={pending}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-800 focus:border-blue-400 focus:outline-none"
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send report to Slack"}
        </button>
      </div>
      {msg && <span className={`max-w-xs text-right text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
    </div>
  );
}

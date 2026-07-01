"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Dashboard date-range selector: the same set as the Slack report sender, plus a
// Custom range with from/to dates and an Apply button that freezes the selection
// and reloads the dashboard data (soft navigation re-renders the server page).
const PRESETS = [
  { key: "mon_sun", label: "Week" },
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
  { key: "month", label: "Month" },
];

export function RangeControls({
  basePath,
  range,
  customStart,
  customEnd,
}: {
  basePath: string;
  range: string;
  customStart?: string;
  customEnd?: string;
}) {
  const router = useRouter();
  const [showCustom, setShowCustom] = useState(range === "custom");
  const [start, setStart] = useState(customStart ?? "");
  const [end, setEnd] = useState(customEnd ?? "");

  const go = (key: string) => router.push(`${basePath}?range=${key}`);
  const applyCustom = () => {
    if (start && end) router.push(`${basePath}?range=custom&start=${start}&end=${end}`);
  };
  const btn = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-white text-[#0B1F3A]" : "text-white/70 hover:text-white"}`;

  return (
    <div className="flex flex-col items-end gap-1.5 print:hidden">
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white/10 p-1">
        {PRESETS.map((r) => (
          <button key={r.key} type="button" onClick={() => go(r.key)} className={btn(r.key === range)}>{r.label}</button>
        ))}
        <button type="button" onClick={() => setShowCustom((v) => !v)} className={btn(range === "custom")}>Custom</button>
      </div>
      {showCustom && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/10 p-1.5">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded bg-white px-2 py-1 text-xs text-zinc-800" aria-label="From date" />
          <span className="text-xs text-white/60">to</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded bg-white px-2 py-1 text-xs text-zinc-800" aria-label="To date" />
          <button type="button" onClick={applyCustom} disabled={!start || !end} className="rounded-md bg-white px-3 py-1 text-xs font-semibold text-[#0B1F3A] disabled:opacity-40">Apply</button>
        </div>
      )}
    </div>
  );
}

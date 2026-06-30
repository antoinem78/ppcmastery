"use client";
import { useState, useTransition } from "react";
import { dryRunProposalAction, applyProposalAction, rollbackProposalAction } from "@/app/(admin)/proposals/actions";
import type { ExecResult } from "@/lib/proposals-execute";

// P5-Lite controls on an executable proposal. Dry-run validates against Google
// (no write); Apply writes the single op (guarded server-side); Rollback reverses
// an applied op. All three are inert until the env guardrails are set — Apply
// then returns the guard reason, which we show.
export function ProposalExecuteControls({ id, status }: { id: string; status: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: (id: string) => Promise<ExecResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await fn(id);
      setMsg("error" in res ? { ok: false, text: res.error } : { ok: true, text: res.message });
    });
  };

  return (
    <div className="mt-4 border-t border-zinc-100 pt-3">
      <div className="flex flex-wrap gap-2">
        {status === "approved" && (
          <>
            <button type="button" disabled={pending} onClick={() => run(dryRunProposalAction)} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
              {pending ? "…" : "Dry-run (validate)"}
            </button>
            <button type="button" disabled={pending} onClick={() => run(applyProposalAction, "Apply this change to the live Google Ads account?")} className="rounded-md bg-[#0B1F3A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0B1F3A]/90 disabled:opacity-50">
              {pending ? "…" : "Apply"}
            </button>
          </>
        )}
        {status === "applied" && (
          <button type="button" disabled={pending} onClick={() => run(rollbackProposalAction, "Roll back this applied change?")} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">
            {pending ? "…" : "Rollback"}
          </button>
        )}
      </div>
      {msg && <div className={`mt-2 rounded-md px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
    </div>
  );
}

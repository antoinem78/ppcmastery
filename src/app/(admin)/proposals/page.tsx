// Proposals — the structured approval queue. The AI analyst files optimisation
// proposals here; an admin approves or dismisses them. Executable proposals
// (those with details.action) carry the single operation P5-Lite can apply once
// it is enabled (Phase D); everything else is advisory.
import Link from "next/link";
import { listProposals, type Proposal, type ProposalAction } from "@/lib/proposals";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { writeEnabled } from "@/lib/integrations/google-ads/write";
import { ProposalExecuteControls } from "@/components/ProposalExecuteControls";
import { approveProposal, dismissProposal } from "./actions";

export const dynamic = "force-dynamic";

function actionLabel(a: ProposalAction): string {
  switch (a.kind) {
    case "add_negative_keyword": return `Add negative "${a.text}" (${a.matchType ?? "BROAD"}) to ${a.campaign}`;
    case "pause_campaign": return `Pause campaign ${a.campaign}`;
    case "set_campaign_budget": return `Set ${a.campaign} daily budget to ${a.dailyBudget}`;
    default: return "Executable action";
  }
}

async function companyNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.from("clients").select("id, company_name").in("id", [...new Set(ids)]);
  return Object.fromEntries((data ?? []).map((c) => [c.id as string, (c.company_name as string) ?? ""]));
}

function ProposalCard({ p, company, pending }: { p: Proposal; company: string; pending: boolean }) {
  const action = p.details?.action;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900">{p.title}</h3>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">{p.type}</span>
            {action ? (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Executable</span>
            ) : (
              <span className="rounded-full bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-500">Advisory</span>
            )}
          </div>
          <Link href={`/clients/${p.client_id}`} className="text-xs text-zinc-500 hover:text-blue-600">{company || p.client_id}</Link>
        </div>
        {!pending && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${p.status === "approved" || p.status === "applied" ? "bg-emerald-50 text-emerald-700" : p.status === "dismissed" ? "bg-zinc-100 text-zinc-500" : "bg-amber-50 text-amber-700"}`}>{p.status}</span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{p.rationale}</p>
      {action && <div className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-600">{actionLabel(action)}</div>}

      {pending ? (
        <div className="mt-4 flex gap-2">
          <form action={approveProposal.bind(null, p.id)}>
            <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700">Approve</button>
          </form>
          <form action={dismissProposal.bind(null, p.id)}>
            <button type="submit" className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50">Dismiss</button>
          </form>
        </div>
      ) : (
        <div className="mt-3 text-xs text-zinc-400">
          {p.status} {p.decided_by ? `by ${p.decided_by}` : ""} {p.decided_at ? `· ${new Date(p.decided_at).toLocaleString("en-GB")}` : ""}
        </div>
      )}

      {/* P5-Lite execution controls (executable proposals only). */}
      {action && (p.status === "approved" || p.status === "applied") && (
        <ProposalExecuteControls id={p.id} status={p.status} />
      )}
    </div>
  );
}

export default async function ProposalsPage() {
  const all = await listProposals();
  const pending = all.filter((p) => p.status === "pending");
  // Surface execute-ready (approved) and applied proposals first.
  const rank = (s: string) => (s === "approved" ? 0 : s === "applied" ? 1 : 2);
  const decided = all.filter((p) => p.status !== "pending").sort((a, b) => rank(a.status) - rank(b.status)).slice(0, 20);
  const names = await companyNames(all.map((p) => p.client_id));
  const writesOn = writeEnabled();

  return (
    <div className="p-8 lg:p-10">
      <h1 className="text-2xl font-semibold text-zinc-900">Proposals</h1>
      <p className="mt-1 text-sm text-zinc-500">Optimisation proposals filed by the AI analyst, awaiting your decision. Approving an advisory proposal records the decision; executable proposals can be applied once controlled writes are enabled.</p>

      <div className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${writesOn ? "bg-amber-50 text-amber-700" : "bg-zinc-100 text-zinc-500"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${writesOn ? "bg-amber-500" : "bg-zinc-400"}`} />
        Controlled writes: {writesOn ? "ENABLED (allowlisted accounts only)" : "OFF"}
      </div>

      <h2 className="mt-8 text-sm font-semibold text-zinc-900">Pending ({pending.length})</h2>
      {pending.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          No pending proposals. Ask the Command Center analyst to review an account and it can file proposals here.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {pending.map((p) => <ProposalCard key={p.id} p={p} company={names[p.client_id] ?? ""} pending />)}
        </div>
      )}

      {decided.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold text-zinc-900">Recently decided</h2>
          <div className="mt-3 space-y-3">
            {decided.map((p) => <ProposalCard key={p.id} p={p} company={names[p.client_id] ?? ""} pending={false} />)}
          </div>
        </>
      )}
    </div>
  );
}

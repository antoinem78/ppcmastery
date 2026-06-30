// Command Center — the agency overview. Replaces the Phase-0 placeholder.
// Pulls a week-over-week summary for every approved account, surfaces alerts,
// and rolls totals up per currency. Action-first so the accounts that need
// attention sit at the top.
import Link from "next/link";
import { getCommandCenter, type CommandCenterAccount } from "@/lib/command-center";
import { GenerateAuditButton } from "@/components/GenerateAuditButton";
import { entityConfig } from "@/lib/config";
import type { Kpi } from "@/lib/integrations/google-ads/reporting";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const money = (n: number, cur: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: cur || "USD", maximumFractionDigits: 0 }).format(n);
const dec = (n: number, dp = 0) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: dp }).format(n);

// Delta chip. `goodWhenUp` colours the direction (conversions up = good; CPA up = bad).
function Delta({ kpi, goodWhenUp = true }: { kpi: Kpi; goodWhenUp?: boolean }) {
  if (kpi.deltaPct == null) return <span className="text-zinc-400">·</span>;
  const up = kpi.deltaPct >= 0;
  const good = goodWhenUp ? up : !up;
  return (
    <span className={good ? "text-emerald-600" : "text-red-600"}>
      {up ? "▲" : "▼"} {dec(Math.abs(kpi.deltaPct))}%
    </span>
  );
}

export default async function DashboardPage() {
  let cc;
  try {
    cc = await getCommandCenter();
  } catch (e) {
    return (
      <div className="p-10">
        <h1 className="text-2xl font-semibold text-zinc-900">Command Center</h1>
        <div className="mt-6 max-w-lg rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Could not load the Command Center: {e instanceof Error ? e.message : "unknown error"}
        </div>
      </div>
    );
  }

  const actionAccounts = cc.accounts.filter((a) => a.status === "action");

  return (
    <div className="p-8 lg:p-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Command Center</h1>
          <p className="mt-1 text-sm text-zinc-500">{entityConfig.brandName} — {cc.accounts.length} account{cc.accounts.length === 1 ? "" : "s"}, last completed week</p>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="rounded-full bg-red-50 px-3 py-1 font-medium text-red-700">{cc.openAlerts.critical} critical</span>
          <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">{cc.openAlerts.warning} warning</span>
        </div>
      </div>

      {/* per-currency totals */}
      {cc.totalsByCurrency.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cc.totalsByCurrency.map((t) => (
            <div key={t.currency} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-500">{t.currency} · {t.accounts} acct{t.accounts === 1 ? "" : "s"}</div>
              </div>
              <div className="mt-2 text-3xl font-semibold text-zinc-900">{money(t.spend, t.currency)}</div>
              <div className="mt-1 text-xs text-zinc-500">spend this week</div>
              <div className="mt-3 flex gap-5 text-sm text-zinc-700">
                <span><b>{dec(t.conversions, 1)}</b> conv</span>
                {t.convValue > 0 && <span><b>{money(t.convValue, t.currency)}</b> value</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* alerts panel */}
      {actionAccounts.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-900">Alerts &amp; Monitoring</h2>
          <div className="mt-3 space-y-2">
            {actionAccounts.map((a) => (
              <div key={a.clientId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5">
                <Link href={`/clients/${a.clientId}`} className="font-medium text-zinc-900 hover:text-blue-600">{a.company || a.customerId}</Link>
                <div className="flex flex-wrap gap-2">
                  {a.error ? (
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{a.error}</span>
                  ) : (
                    a.alerts.map((al, i) => (
                      <span key={i} className={`rounded-md px-2 py-0.5 text-xs ${al.severity === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{al.message}</span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* all accounts */}
      <div className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Account</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Spend</th>
              <th className="px-4 py-2.5 text-right font-medium">Conv</th>
              <th className="px-4 py-2.5 text-right font-medium">CPA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {cc.accounts.map((a: CommandCenterAccount) => (
              <tr key={a.clientId} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/clients/${a.clientId}`} className="font-medium text-zinc-900 hover:text-blue-600">{a.company || a.customerId}</Link>
                    <GenerateAuditButton clientId={a.clientId} company={a.company || a.customerId} compact />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${a.status === "action" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${a.status === "action" ? "bg-amber-500" : "bg-emerald-500"}`} />
                    {a.status === "action" ? "Action" : "Healthy"}
                  </span>
                </td>
                {a.summary ? (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(a.summary.spend.value, a.currency)} <span className="ml-1 text-xs"><Delta kpi={a.summary.spend} goodWhenUp /></span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {dec(a.summary.conversions.value, 1)} <span className="ml-1 text-xs"><Delta kpi={a.summary.conversions} goodWhenUp /></span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {a.summary.conversions.value > 0 ? money(a.summary.costPerConv.value, a.currency) : <span className="text-zinc-400">·</span>}
                    </td>
                  </>
                ) : (
                  <td className="px-4 py-3 text-right text-xs text-zinc-400" colSpan={3}>could not load</td>
                )}
              </tr>
            ))}
            {cc.accounts.length === 0 && (
              <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={5}>No approved accounts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

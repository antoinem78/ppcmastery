// Google Ads performance dashboard (Phase 6.1). Renders a verified payload from
// the reporting data layer — KPI cards, a daily spend/conversions trend line,
// and three top-N breakdowns. Account currency, Search campaigns only.
import type { DashboardPayload, Kpi } from "@/lib/integrations/google-ads/reporting";
import { REPORT_WINDOWS } from "@/lib/integrations/google-ads/reporting";

export function AdsDashboard({
  payload,
  basePath,
  range,
}: {
  payload: DashboardPayload | null;
  basePath: string;
  range: number;
}) {
  if (!payload) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Performance</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Performance data is temporarily unavailable — please refresh shortly.
        </p>
      </section>
    );
  }

  const money = (n: number, dp = 0) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: payload.currency,
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }).format(n);
  const int = (n: number) => new Intl.NumberFormat("en").format(Math.round(n));
  const dec = (n: number, dp = 1) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: dp }).format(n);
  const pct = (n: number) => `${dec(n)}%`;
  const guard = payload.hasConversionValue;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Performance</h2>
          <p className="text-xs text-zinc-400">
            Search campaigns · {payload.range.start} → {payload.range.end} ·{" "}
            {payload.currency}
          </p>
        </div>
        <div className="flex gap-1">
          {REPORT_WINDOWS.map((w) => (
            <a
              key={w}
              href={`${basePath}?range=${w}`}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                w === range
                  ? "bg-[#0B1F3A] text-white"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {w}d
            </a>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Card label="Spend" value={money(payload.kpis.spend.value)} k={payload.kpis.spend} costMetric />
        <Card label="Impressions" value={int(payload.kpis.impressions.value)} k={payload.kpis.impressions} />
        <Card label="Clicks" value={int(payload.kpis.clicks.value)} k={payload.kpis.clicks} />
        <Card label="CTR" value={pct(payload.kpis.ctr.value)} k={payload.kpis.ctr} />
        <Card label="Avg CPC" value={money(payload.kpis.avgCpc.value, 2)} k={payload.kpis.avgCpc} costMetric />
        <Card label="Conversions" value={dec(payload.kpis.conversions.value)} k={payload.kpis.conversions} />
        <Card label="Conv. rate" value={pct(payload.kpis.convRate.value)} k={payload.kpis.convRate} />
        <Card label="Cost / conv." value={money(payload.kpis.costPerConv.value, 2)} k={payload.kpis.costPerConv} costMetric />
        <Card
          label="Conv. value"
          value={guard ? money(payload.kpis.convValue.value) : "—"}
          k={guard ? payload.kpis.convValue : undefined}
        />
        <Card
          label="ROAS"
          value={guard ? `${dec(payload.kpis.roas.value, 2)}×` : "—"}
          k={guard ? payload.kpis.roas : undefined}
        />
        <Card label="Search impr. share" value={pct(payload.kpis.searchImprShare.value)} k={payload.kpis.searchImprShare} />
      </div>

      {/* Trend */}
      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Daily spend &amp; conversions
        </h3>
        <TrendChart trend={payload.trend} currency={payload.currency} />
      </div>

      {/* Breakdowns */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <BreakdownTable
          title="By campaign"
          cols={["Campaign", "Spend", "Conv.", "Cost/conv.", ...(guard ? ["ROAS"] : [])]}
          rows={payload.byCampaign.map((c) => [
            c.name,
            money(c.spend),
            dec(c.conversions),
            money(c.costPerConv, 2),
            ...(guard ? [`${dec(c.roas, 2)}×`] : []),
          ])}
        />
        <BreakdownTable
          title="By device"
          cols={["Device", "Spend", "Conv."]}
          rows={payload.byDevice.map((d) => [d.device, money(d.spend), dec(d.conversions)])}
        />
        <BreakdownTable
          title="Top search terms"
          cols={["Term", "Spend", "Conv."]}
          rows={payload.topSearchTerms.map((t) => [t.term, money(t.spend), dec(t.conversions)])}
        />
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  k,
  costMetric,
}: {
  label: string;
  value: string;
  k?: Kpi;
  costMetric?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-900">{value}</div>
      {k?.deltaPct != null && <Delta deltaPct={k.deltaPct} costMetric={costMetric} />}
    </div>
  );
}

// Neutral arrow + magnitude. For cost metrics, a rise is tinted amber (worth a
// glance), a fall green; for the rest, rise green / fall zinc — light-touch, not
// a verdict.
function Delta({ deltaPct, costMetric }: { deltaPct: number; costMetric?: boolean }) {
  const up = deltaPct >= 0;
  const good = costMetric ? !up : up;
  const color = deltaPct === 0 ? "text-zinc-400" : good ? "text-emerald-600" : "text-amber-600";
  return (
    <div className={`mt-0.5 text-xs ${color}`}>
      {up ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}%
    </div>
  );
}

function TrendChart({
  trend,
  currency,
}: {
  trend: { date: string; spend: number; conversions: number }[];
  currency: string;
}) {
  if (trend.length < 2) {
    return <p className="mt-2 text-sm text-zinc-400">Not enough data to chart yet.</p>;
  }
  const W = 720, H = 160, P = 8;
  const maxSpend = Math.max(...trend.map((t) => t.spend), 1);
  const maxConv = Math.max(...trend.map((t) => t.conversions), 1);
  const x = (i: number) => P + (i * (W - 2 * P)) / (trend.length - 1);
  const ySpend = (v: number) => H - P - (v / maxSpend) * (H - 2 * P);
  const yConv = (v: number) => H - P - (v / maxConv) * (H - 2 * P);
  const line = (sel: (t: (typeof trend)[number]) => number, y: (v: number) => number) =>
    trend.map((t, i) => `${x(i)},${y(sel(t))}`).join(" ");

  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <polyline fill="none" stroke="#0B1F3A" strokeWidth="2" points={line((t) => t.spend, ySpend)} />
        <polyline fill="none" stroke="#10b981" strokeWidth="2" points={line((t) => t.conversions, yConv)} />
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-[#0B1F3A]" /> Spend ({currency})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" /> Conversions
        </span>
      </div>
    </div>
  );
}

function BreakdownTable({
  title,
  cols,
  rows,
}: {
  title: string;
  cols: string[];
  rows: string[][];
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">No data in this window.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-400">
              {cols.map((c, i) => (
                <th key={c} className={i === 0 ? "py-1 text-left font-medium" : "py-1 text-right font-medium"}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-zinc-100">
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-1.5 ${ci === 0 ? "max-w-[10rem] truncate pr-2 text-zinc-800" : "text-right text-zinc-600"}`}
                    title={ci === 0 ? cell : undefined}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

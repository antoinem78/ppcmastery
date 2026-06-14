// Google Ads performance dashboard (Phase 6.1, redesigned). Premium, agency-grade
// client view — verified payload from the reporting data layer. Account currency,
// Search campaigns only. Server-rendered, inline SVG, no client JS.
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
      <section className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
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
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {/* Header band */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-gradient-to-r from-[#0B1F3A] to-[#13315c] px-6 py-5">
        <div>
          <h2 className="text-base font-semibold text-white">Performance</h2>
          <p className="text-xs text-white/60">
            Search campaigns · {payload.range.start} → {payload.range.end} ·{" "}
            {payload.currency}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-white/10 p-1">
          {REPORT_WINDOWS.map((w) => (
            <a
              key={w}
              href={`${basePath}?range=${w}`}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                w === range ? "bg-white text-[#0B1F3A]" : "text-white/70 hover:text-white"
              }`}
            >
              {w}d
            </a>
          ))}
        </div>
      </div>

      <div className="p-6">
        {/* This week — hero banner */}
        <WeekBanner weekly={payload.weekly} money={(n) => money(n)} dec={dec} />

        {/* Hero KPIs */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroCard label="Spend" value={money(payload.kpis.spend.value)} k={payload.kpis.spend} cost accent="navy" />
          <HeroCard label="Conversions" value={dec(payload.kpis.conversions.value)} k={payload.kpis.conversions} accent="emerald" />
          <HeroCard label="Cost / conv." value={money(payload.kpis.costPerConv.value, 2)} k={payload.kpis.costPerConv} cost accent="navy" />
          {guard ? (
            <HeroCard label="ROAS" value={`${dec(payload.kpis.roas.value, 2)}×`} k={payload.kpis.roas} accent="violet" />
          ) : (
            <HeroCard label="Conv. rate" value={pct(payload.kpis.convRate.value)} k={payload.kpis.convRate} accent="violet" />
          )}
        </div>

        {/* Secondary KPIs */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MiniCard label="Impressions" value={int(payload.kpis.impressions.value)} k={payload.kpis.impressions} />
          <MiniCard label="Clicks" value={int(payload.kpis.clicks.value)} k={payload.kpis.clicks} />
          <MiniCard label="CTR" value={pct(payload.kpis.ctr.value)} k={payload.kpis.ctr} />
          <MiniCard label="Avg CPC" value={money(payload.kpis.avgCpc.value, 2)} k={payload.kpis.avgCpc} cost />
          <MiniCard label="Conv. value" value={guard ? money(payload.kpis.convValue.value) : "—"} k={guard ? payload.kpis.convValue : undefined} />
          <MiniCard label="Search impr. share" value={pct(payload.kpis.searchImprShare.value)} k={payload.kpis.searchImprShare} />
        </div>

        {/* Trend */}
        <div className="mt-7">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Daily spend &amp; conversions
          </h3>
          <TrendChart trend={payload.trend} />
          <div className="mt-2 flex gap-4 text-xs text-zinc-500">
            <Legend color="#0B1F3A" label={`Spend (${payload.currency})`} />
            <Legend color="#10b981" label="Conversions" />
          </div>
        </div>

        {/* Breakdowns */}
        <div className="mt-7 grid gap-6 lg:grid-cols-3">
          <Breakdown
            title="By campaign"
            cols={["Campaign", "Spend", "Conv.", ...(guard ? ["ROAS"] : ["Cost/conv."])]}
            rows={payload.byCampaign.map((c) => ({
              label: c.name,
              spend: c.spend,
              cells: [
                money(c.spend),
                dec(c.conversions),
                guard ? `${dec(c.roas, 2)}×` : money(c.costPerConv, 2),
              ],
            }))}
            maxSpend={Math.max(...payload.byCampaign.map((c) => c.spend), 1)}
          />
          <Breakdown
            title="By device"
            cols={["Device", "Spend", "Conv."]}
            rows={payload.byDevice.map((d) => ({
              label: d.device,
              spend: d.spend,
              cells: [money(d.spend), dec(d.conversions)],
            }))}
            maxSpend={Math.max(...payload.byDevice.map((d) => d.spend), 1)}
          />
          <Breakdown
            title="Top search terms"
            cols={["Term", "Spend", "Conv."]}
            rows={payload.topSearchTerms.map((t) => ({
              label: t.term,
              spend: t.spend,
              cells: [money(t.spend), dec(t.conversions)],
            }))}
            maxSpend={Math.max(...payload.topSearchTerms.map((t) => t.spend), 1)}
          />
        </div>
      </div>
    </section>
  );
}

function WeekBanner({
  weekly,
  money,
  dec,
}: {
  weekly: DashboardPayload["weekly"];
  money: (n: number) => string;
  dec: (n: number, dp?: number) => string;
}) {
  const chip = (label: string, value: string, k: Kpi) => (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-zinc-900">{value}</span>
        {k.deltaPct != null && (
          <span className={`text-xs font-medium ${k.deltaPct >= 0 ? "text-emerald-600" : "text-amber-600"}`}>
            {k.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(k.deltaPct).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
  return (
    <div className="rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-[#0B1F3A]">
        This week · {weekly.start} → {weekly.end}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
        {chip("Spend", money(weekly.spend.value), weekly.spend)}
        {chip("Conversions", dec(weekly.conversions.value), weekly.conversions)}
      </div>
      <div className="mt-3 border-t border-zinc-200/70 pt-3 text-sm text-zinc-600">
        {weekly.changeLines.length ? (
          <>
            <span className="font-medium text-zinc-500">Changes this week: </span>
            {weekly.changeLines.join(", ")}.
          </>
        ) : (
          <span className="text-zinc-400">No account changes this week.</span>
        )}
      </div>
    </div>
  );
}

const ACCENTS: Record<string, string> = {
  navy: "from-[#0B1F3A]/[0.04] to-transparent",
  emerald: "from-emerald-500/[0.06] to-transparent",
  violet: "from-violet-500/[0.06] to-transparent",
};

function HeroCard({
  label,
  value,
  k,
  cost,
  accent,
}: {
  label: string;
  value: string;
  k?: Kpi;
  cost?: boolean;
  accent: keyof typeof ACCENTS | string;
}) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-gradient-to-br ${ACCENTS[accent] ?? ACCENTS.navy} p-4`}>
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{value}</div>
      {k?.deltaPct != null && <Delta deltaPct={k.deltaPct} cost={cost} />}
    </div>
  );
}

function MiniCard({
  label,
  value,
  k,
  cost,
}: {
  label: string;
  value: string;
  k?: Kpi;
  cost?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-zinc-900">{value}</div>
      {k?.deltaPct != null && <Delta deltaPct={k.deltaPct} cost={cost} />}
    </div>
  );
}

function Delta({ deltaPct, cost }: { deltaPct: number; cost?: boolean }) {
  const up = deltaPct >= 0;
  const good = cost ? !up : up;
  const color = deltaPct === 0 ? "text-zinc-400" : good ? "text-emerald-600" : "text-amber-600";
  return (
    <div className={`mt-1 text-xs font-medium ${color}`}>
      {up ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}%
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}

function TrendChart({ trend }: { trend: { date: string; spend: number; conversions: number }[] }) {
  if (trend.length < 2) {
    return <p className="mt-2 text-sm text-zinc-400">Not enough data to chart yet.</p>;
  }
  const W = 760, H = 180, P = 10;
  const maxSpend = Math.max(...trend.map((t) => t.spend), 1);
  const maxConv = Math.max(...trend.map((t) => t.conversions), 1);
  const x = (i: number) => P + (i * (W - 2 * P)) / (trend.length - 1);
  const ys = (v: number) => H - P - (v / maxSpend) * (H - 2 * P);
  const yc = (v: number) => H - P - (v / maxConv) * (H - 2 * P);
  const spendPts = trend.map((t, i) => `${x(i)},${ys(t.spend)}`).join(" ");
  const convPts = trend.map((t, i) => `${x(i)},${yc(t.conversions)}`).join(" ");
  const area = `${P},${H - P} ${spendPts} ${x(trend.length - 1)},${H - P}`;
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0B1F3A" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#0B1F3A" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={P} x2={W - P} y1={P + g * (H - 2 * P)} y2={P + g * (H - 2 * P)} stroke="#f1f5f9" strokeWidth="1" />
        ))}
        <polygon points={area} fill="url(#spendFill)" />
        <polyline fill="none" stroke="#0B1F3A" strokeWidth="2.5" points={spendPts} />
        <polyline fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="1 0" points={convPts} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>{trend[0].date}</span>
        <span>{trend[trend.length - 1].date}</span>
      </div>
    </div>
  );
}

function Breakdown({
  title,
  cols,
  rows,
  maxSpend,
}: {
  title: string;
  cols: string[];
  rows: { label: string; spend: number; cells: string[] }[];
  maxSpend: number;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">No data in this window.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-[11px] text-zinc-400">
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
                <td className="relative max-w-[10rem] truncate py-1.5 pr-2 text-zinc-800" title={r.label}>
                  <span
                    className="absolute inset-y-1 left-0 -z-0 rounded-sm bg-[#0B1F3A]/[0.05]"
                    style={{ width: `${Math.max(4, (r.spend / maxSpend) * 100)}%` }}
                  />
                  <span className="relative">{r.label}</span>
                </td>
                {r.cells.map((cell, ci) => (
                  <td key={ci} className="py-1.5 text-right text-zinc-600">
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

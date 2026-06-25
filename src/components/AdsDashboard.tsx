// Google Ads performance dashboard (Phase 6.1, redesigned). Premium, agency-grade
// client view — verified payload from the reporting data layer. Account currency,
// all campaign types. Conversions shown on both bases (interaction date + By-Time).
// Search impression-share suite + search terms stay search-only and are labelled.
// Server-rendered, inline SVG, no client JS.
import type {
  DashboardPayload,
  Kpi,
  CampaignPerf,
  TopAd,
  MonthRow,
  ImpressionShare,
} from "@/lib/integrations/google-ads/reporting";
import { REPORT_WINDOWS } from "@/lib/integrations/google-ads/reporting";

function makeFmt(currency: string) {
  return {
    money: (n: number, dp = 0) =>
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      }).format(n),
    int: (n: number) => new Intl.NumberFormat("en").format(Math.round(n)),
    dec: (n: number, dp = 1) => new Intl.NumberFormat("en", { maximumFractionDigits: dp }).format(n),
    pct: (n: number) => `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n)}%`,
  };
}

const rangeLabel = (w: number) => (w === 7 ? "Week" : `${w}d`);

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

  const { money, int, dec, pct } = makeFmt(payload.currency);
  const guard = payload.hasConversionValue;
  const k = payload.kpis;

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {/* Header band */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-gradient-to-r from-[#0B1F3A] to-[#13315c] px-6 py-5">
        <div>
          <h2 className="text-base font-semibold text-white">Performance</h2>
          <p className="text-xs text-white/60">
            All campaigns · {payload.range.start} → {payload.range.end} · {payload.currency}
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
              {rangeLabel(w)}
            </a>
          ))}
        </div>
      </div>

      <div className="p-6">
        {/* This week — hero banner */}
        <WeekBanner weekly={payload.weekly} money={(n) => money(n)} dec={dec} />

        {/* Hero KPIs */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroCard label="Spend" value={money(k.spend.value)} k={k.spend} cost accent="navy" />
          <HeroCard label="Conversions" value={dec(k.conversions.value)} k={k.conversions} accent="emerald" />
          <HeroCard label="Cost / conv." value={money(k.costPerConv.value, 2)} k={k.costPerConv} cost accent="navy" />
          {guard ? (
            <HeroCard label="ROAS" value={`${dec(k.roas.value, 2)}×`} k={k.roas} accent="violet" />
          ) : (
            <HeroCard label="Conv. rate" value={pct(k.convRate.value)} k={k.convRate} accent="violet" />
          )}
        </div>

        {/* Secondary KPIs */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MiniCard label="Impressions" value={int(k.impressions.value)} k={k.impressions} />
          <MiniCard label="Clicks" value={int(k.clicks.value)} k={k.clicks} />
          <MiniCard label="CTR" value={pct(k.ctr.value)} k={k.ctr} />
          <MiniCard label="Avg CPC" value={money(k.avgCpc.value, 2)} k={k.avgCpc} cost />
          <MiniCard label="Conv. value" value={guard ? money(k.convValue.value) : "—"} k={guard ? k.convValue : undefined} />
          <MiniCard label="Search impr. share" value={pct(k.searchImprShare.value)} k={k.searchImprShare} />
        </div>

        {/* By conversion date (By-Time) */}
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            By conversion date
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <MiniCard label="Conversions (by time)" value={dec(k.conversionsByTime.value)} k={k.conversionsByTime} />
            {guard && (
              <>
                <MiniCard label="Value (by time)" value={money(k.convValueByTime.value)} k={k.convValueByTime} />
                <MiniCard label="ROAS (by time)" value={`${dec(k.roasByTime.value, 2)}×`} k={k.roasByTime} />
                <MiniCard label="Avg order value" value={money(k.aov.value, 2)} k={k.aov} cost />
              </>
            )}
          </div>
        </div>

        {/* Trend */}
        <div className="mt-7">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Daily spend &amp; conversions
          </h3>
          <TrendChart trend={payload.trend} currency={payload.currency} />
          <div className="mt-2 flex gap-4 text-xs text-zinc-500">
            <Legend color="#0B1F3A" label="Spend — line (left axis)" />
            <Legend color="#10b981" label="Conversions/day — bars (right axis)" />
          </div>
        </div>

        {/* Campaign performance grid (full width) */}
        {payload.campaignPerformance.length > 0 && (
          <CampaignGrid rows={payload.campaignPerformance} currency={payload.currency} />
        )}

        {/* Top performing ads */}
        {payload.topAds.length > 0 && (
          <TopAdsTable ads={payload.topAds} currency={payload.currency} guard={guard} />
        )}

        {/* Auction insights (impression-share suite) */}
        {payload.impressionShare.impressionShare > 0 && (
          <AuctionInsights share={payload.impressionShare} />
        )}

        {/* Month performance */}
        {payload.monthPerformance.length > 0 && (
          <MonthTable rows={payload.monthPerformance} currency={payload.currency} />
        )}

        {/* Smaller breakdowns — scroll for detail */}
        <div className="mt-7 grid gap-6 lg:grid-cols-2">
          {payload.byConversionAction.length > 0 && (
            <Breakdown
              title="Conversions by action"
              cols={["Action", "Conv.", ...(guard ? ["Value"] : [])]}
              rows={payload.byConversionAction.map((a) => ({
                label: a.action,
                weight: a.conversions,
                cells: [dec(a.conversions), ...(guard ? [money(a.value)] : [])],
              }))}
              maxWeight={Math.max(...payload.byConversionAction.map((a) => a.conversions), 1)}
            />
          )}
          <Breakdown
            title="By device"
            cols={["Device", "Spend", "Conv."]}
            rows={payload.byDevice.map((d) => ({
              label: d.device,
              weight: d.spend,
              cells: [money(d.spend), dec(d.conversions)],
            }))}
            maxWeight={Math.max(...payload.byDevice.map((d) => d.spend), 1)}
          />
          <Breakdown
            title="Top search terms (Search only)"
            cols={["Term", "Spend", "Conv."]}
            rows={payload.topSearchTerms.map((t) => ({
              label: t.term,
              weight: t.spend,
              cells: [money(t.spend), dec(t.conversions)],
            }))}
            maxWeight={Math.max(...payload.topSearchTerms.map((t) => t.spend), 1)}
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
  const chip = (label: string, value: string, kp: Kpi) => (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-zinc-900">{value}</span>
        {kp.deltaPct != null && (
          <span className={`text-xs font-medium ${kp.deltaPct >= 0 ? "text-emerald-600" : "text-amber-600"}`}>
            {kp.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(kp.deltaPct).toFixed(0)}%
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

function MiniCard({ label, value, k, cost }: { label: string; value: string; k?: Kpi; cost?: boolean }) {
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

function DeltaInline({ deltaPct, cost }: { deltaPct: number | null; cost?: boolean }) {
  if (deltaPct == null) return null;
  const up = deltaPct >= 0;
  const good = cost ? !up : up;
  const color = deltaPct === 0 ? "text-zinc-400" : good ? "text-emerald-600" : "text-amber-600";
  return (
    <span className={`ml-1 text-[10px] font-medium ${color}`}>
      {up ? "▲" : "▼"}{Math.abs(deltaPct).toFixed(0)}%
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}

// Dual-axis: conversions/day as scaled bars (right axis), spend as a line
// (left axis). Both axes are labelled so the magnitudes are readable.
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
  const W = 760, H = 220, ML = 56, MR = 48, MT = 12, MB = 28;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;
  const n = trend.length;
  const maxSpend = Math.max(...trend.map((t) => t.spend), 1);
  const maxConv = Math.max(...trend.map((t) => t.conversions), 1);
  const band = plotW / n;
  const barW = Math.max(2, band * 0.55);
  const xc = (i: number) => ML + band * i + band / 2;
  const ySpend = (v: number) => MT + plotH - (v / maxSpend) * plotH;
  const spendPts = trend.map((t, i) => `${xc(i)},${ySpend(t.spend)}`).join(" ");
  const fracs = [0, 0.5, 1];
  const moneyAxis = (v: number) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  const convAxis = (v: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(v);
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {fracs.map((f) => {
          const y = MT + plotH - f * plotH;
          return (
            <g key={f}>
              <line x1={ML} x2={W - MR} y1={y} y2={y} stroke="#f1f5f9" strokeWidth="1" />
              <text x={ML - 6} y={y + 3} textAnchor="end" className="fill-zinc-400" fontSize="10">
                {moneyAxis(maxSpend * f)}
              </text>
              <text x={W - MR + 6} y={y + 3} textAnchor="start" className="fill-emerald-500" fontSize="10">
                {convAxis(maxConv * f)}
              </text>
            </g>
          );
        })}
        {trend.map((t, i) => {
          const h = (t.conversions / maxConv) * plotH;
          return (
            <rect
              key={i}
              x={xc(i) - barW / 2}
              y={MT + plotH - h}
              width={barW}
              height={Math.max(0, h)}
              rx="1"
              fill="#10b981"
              opacity="0.85"
            />
          );
        })}
        <polyline fill="none" stroke="#0B1F3A" strokeWidth="2.5" points={spendPts} />
        <text x={ML} y={H - 8} textAnchor="start" className="fill-zinc-400" fontSize="10">
          {trend[0].date}
        </text>
        <text x={W - MR} y={H - 8} textAnchor="end" className="fill-zinc-400" fontSize="10">
          {trend[trend.length - 1].date}
        </text>
      </svg>
    </div>
  );
}

// Full-width campaign-performance grid: each metric cell = value + %Δ.
function CampaignGrid({ rows, currency }: { rows: CampaignPerf[]; currency: string }) {
  const { money, int, dec, pct } = makeFmt(currency);
  return (
    <div className="mt-7">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Campaign performance</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-[11px] text-zinc-400">
              <th className="w-[22rem] py-1 text-left font-medium">Campaign</th>
              {["Clicks", "Impr.", "CTR", "Avg CPC", "Cost", "Conv.", "Cost/conv.", "Conv. rate"].map((c) => (
                <th key={c} className="py-1 pl-3 text-right font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-zinc-100 align-top">
                <td className="w-[22rem] break-words py-2 pr-3 text-zinc-800">
                  {r.name}
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-zinc-400">{r.channel}</span>
                </td>
                <Cell v={int(r.clicks.value)} k={r.clicks} />
                <Cell v={int(r.impressions.value)} k={r.impressions} />
                <Cell v={pct(r.ctr.value)} k={r.ctr} />
                <Cell v={money(r.avgCpc.value, 2)} k={r.avgCpc} cost />
                <Cell v={money(r.cost.value)} k={r.cost} cost />
                <Cell v={dec(r.conversions.value)} k={r.conversions} />
                <Cell v={r.conversions.value > 0 ? money(r.costPerConv.value, 2) : "—"} k={r.costPerConv} cost />
                <Cell v={pct(r.convRate.value)} k={r.convRate} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ v, k, cost }: { v: string; k: Kpi; cost?: boolean }) {
  return (
    <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">
      {v}
      <DeltaInline deltaPct={k.deltaPct} cost={cost} />
    </td>
  );
}

function TopAdsTable({ ads, currency, guard }: { ads: TopAd[]; currency: string; guard: boolean }) {
  const { money, int, dec, pct } = makeFmt(currency);
  return (
    <div className="mt-7">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Top performing ads</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-[11px] text-zinc-400">
              <th className="w-[26rem] py-1 text-left font-medium">Ad</th>
              {["Impr.", "Clicks", "CTR", "Conv.", "Cost", ...(guard ? ["Value"] : [])].map((c) => (
                <th key={c} className="py-1 pl-3 text-right font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ads.map((a, i) => (
              <tr key={i} className="border-t border-zinc-100 align-top">
                <td className="w-[26rem] py-2 pr-3">
                  <div className="break-words text-zinc-800">{a.headline}</div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                    {a.campaign}
                    {a.finalUrl ? ` · ${a.finalUrl}` : ""}
                  </div>
                </td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{int(a.impressions)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{int(a.clicks)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{pct(a.ctr)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{dec(a.conversions)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{money(a.cost)}</td>
                {guard && <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{money(a.convValue)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuctionInsights({ share }: { share: ImpressionShare }) {
  const { pct } = makeFmt("USD"); // % only — currency irrelevant
  const tiles: { label: string; value: number; lost?: boolean }[] = [
    { label: "Impression share", value: share.impressionShare },
    { label: "Abs. top IS", value: share.absoluteTop },
    { label: "Top IS", value: share.top },
    { label: "Lost to rank", value: share.rankLost, lost: true },
    { label: "Lost to budget", value: share.budgetLost, lost: true },
  ];
  return (
    <div className="mt-7">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Auction insights <span className="font-normal text-zinc-400">(Search only)</span>
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-zinc-200 p-3">
            <div className="text-[11px] text-zinc-500">{t.label}</div>
            <div className={`mt-0.5 text-base font-semibold ${t.lost ? "text-amber-600" : "text-zinc-900"}`}>
              {pct(t.value)}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Competitor domains / overlap / outranking are not available via the Google Ads API; this is the
        impression-share equivalent.
      </p>
    </div>
  );
}

function MonthTable({ rows, currency }: { rows: MonthRow[]; currency: string }) {
  const { money, int, dec, pct } = makeFmt(currency);
  return (
    <div className="mt-7">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Month performance</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-[11px] text-zinc-400">
              <th className="py-1 text-left font-medium">Month</th>
              {["Clicks", "Impr.", "CTR", "Avg CPC", "Cost", "Conv.", "Cost/conv."].map((c) => (
                <th key={c} className="py-1 pl-3 text-right font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-zinc-100">
                <td className="whitespace-nowrap py-2 pr-3 text-zinc-800">{r.label}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{int(r.clicks)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{int(r.impressions)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{pct(r.ctr)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{money(r.avgCpc, 2)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{money(r.cost)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">{dec(r.conversions)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-700">
                  {r.conversions > 0 ? money(r.costPerConv, 2) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Breakdown({
  title,
  cols,
  rows,
  maxWeight,
}: {
  title: string;
  cols: string[];
  rows: { label: string; weight: number; cells: string[] }[];
  maxWeight: number;
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
                <td className="relative max-w-[12rem] truncate py-1.5 pr-2 text-zinc-800" title={r.label}>
                  <span
                    className="absolute inset-y-1 left-0 -z-0 rounded-sm bg-[#0B1F3A]/[0.05]"
                    style={{ width: `${Math.max(4, (r.weight / maxWeight) * 100)}%` }}
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

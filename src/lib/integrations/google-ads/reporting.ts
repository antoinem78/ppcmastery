// Phase 6.1: Google Ads performance dashboard data layer.
// Search campaigns only, removed entities excluded, account timezone + currency,
// last 28 vs prior 28 (or 7/90) excluding today. Whole payload cached per
// client+window (~30 min) so client refreshes don't drain the shared API quota.
//
// All figures come from here (the data layer). Any future LLM summary only
// rewords these verified numbers — it never generates them.
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { gaqlSearch } from "./index";

export const REPORT_WINDOWS = [7, 28, 90] as const;
export type ReportWindow = (typeof REPORT_WINDOWS)[number];
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface Kpi {
  value: number;
  prev: number;
  /** % change vs prior period; null when prior is 0 (can't divide). */
  deltaPct: number | null;
}
export interface WeeklySummary {
  start: string;
  end: string;
  spend: Kpi;
  conversions: Kpi;
  /** Human-readable change lines, e.g. "3 keywords added". */
  changeLines: string[];
  changeCount: number;
}

export interface DashboardPayload {
  currency: string;
  timeZone: string;
  window: number;
  range: { start: string; end: string };
  hasConversionValue: boolean;
  weekly: WeeklySummary;
  kpis: {
    spend: Kpi; impressions: Kpi; clicks: Kpi; ctr: Kpi; avgCpc: Kpi;
    conversions: Kpi; costPerConv: Kpi; convValue: Kpi; roas: Kpi;
    convRate: Kpi; searchImprShare: Kpi;
  };
  trend: { date: string; spend: number; conversions: number }[];
  byCampaign: { name: string; spend: number; conversions: number; costPerConv: number; roas: number }[];
  byDevice: { device: string; spend: number; conversions: number }[];
  topSearchTerms: { term: string; spend: number; conversions: number }[];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const micros = (v: unknown) => num(v) / 1_000_000;

function ymdInTz(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

function windows(tz: string, windowDays: number) {
  const today = new Date(`${ymdInTz(new Date(), tz)}T00:00:00Z`);
  const end = addDays(today, -1); // exclude today
  const start = addDays(end, -(windowDays - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(windowDays - 1));
  return {
    start: fmt(start),
    end: fmt(end),
    prevStart: fmt(prevStart),
    prevEnd: fmt(prevEnd),
  };
}

function kpi(value: number, prev: number): Kpi {
  return { value, prev, deltaPct: prev > 0 ? ((value - prev) / prev) * 100 : null };
}

const SEARCH_FILTER =
  "campaign.advertising_channel_type = 'SEARCH' AND campaign.status != 'REMOVED'";

// Aggregate campaign metrics for a date range → totals + per-campaign rows.
async function campaignTotals(customerId: string, start: string, end: string) {
  const rows = await gaqlSearch(
    customerId,
    `SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.conversions, metrics.conversions_value
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}' AND ${SEARCH_FILTER}`,
  );
  let spend = 0, impressions = 0, clicks = 0, conversions = 0, convValue = 0;
  const byName: Record<string, { spend: number; conversions: number; convValue: number }> = {};
  for (const r of rows) {
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const c = micros(m.costMicros);
    const cv = num(m.conversionsValue);
    const cn = num(m.conversions);
    spend += c; impressions += num(m.impressions); clicks += num(m.clicks);
    conversions += cn; convValue += cv;
    const name = ((r.campaign ?? {}) as { name?: string }).name ?? "(unnamed)";
    byName[name] ??= { spend: 0, conversions: 0, convValue: 0 };
    byName[name].spend += c; byName[name].conversions += cn; byName[name].convValue += cv;
  }
  return { spend, impressions, clicks, conversions, convValue, byName };
}

async function searchImpressionShare(customerId: string, start: string, end: string) {
  const rows = await gaqlSearch(
    customerId,
    `SELECT metrics.impressions, metrics.search_impression_share
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}' AND ${SEARCH_FILTER}`,
  );
  // Impression-weighted average across campaigns that report a share.
  let weighted = 0, imprWithShare = 0;
  for (const r of rows) {
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const share = m.searchImpressionShare;
    if (share == null) continue;
    const impr = num(m.impressions);
    weighted += num(share) * impr;
    imprWithShare += impr;
  }
  return imprWithShare > 0 ? (weighted / imprWithShare) * 100 : 0;
}

const RESOURCE_LABEL: Record<string, string> = {
  CAMPAIGN: "campaign",
  CAMPAIGN_BUDGET: "budget",
  CAMPAIGN_CRITERION: "campaign targeting",
  AD_GROUP: "ad group",
  AD_GROUP_AD: "ad",
  AD_GROUP_CRITERION: "keyword",
  AD_GROUP_BID_MODIFIER: "bid adjustment",
  AD: "ad",
  AD_GROUP_ASSET: "asset",
  CAMPAIGN_ASSET: "asset",
};
const OP_VERB: Record<string, string> = {
  CREATE: "added",
  UPDATE: "updated",
  REMOVE: "removed",
};
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Aggregate the account's change history into plain-English lines (template,
// not LLM): groups by (operation, resource type) and counts.
async function changeSummary(customerId: string, start: string, end: string) {
  const rows = await gaqlSearch(
    customerId,
    `SELECT change_event.change_resource_type, change_event.resource_change_operation
     FROM change_event
     WHERE change_event.change_date_time >= '${start} 00:00:00'
       AND change_event.change_date_time <= '${end} 23:59:59'
     ORDER BY change_event.change_date_time DESC LIMIT 1000`,
  );
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const ce = (r.changeEvent ?? {}) as {
      changeResourceType?: string;
      resourceChangeOperation?: string;
    };
    const noun = RESOURCE_LABEL[ce.changeResourceType ?? ""] ?? "item";
    const verb = OP_VERB[ce.resourceChangeOperation ?? ""] ?? "changed";
    counts[`${verb}|${noun}`] = (counts[`${verb}|${noun}`] ?? 0) + 1;
  }
  const lines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const [verb, noun] = key.split("|");
      return `${plural(n, noun)} ${verb}`;
    });
  return { count: rows.length, lines };
}

// Classify one change_event into a specific, plain-English optimisation label,
// using the resource type, the operation, the changed field mask, and the new
// resource (to distinguish negative keywords / pauses / resumes). Returns null
// for noise we don't want to surface. These are FACTS (what changed); any
// rationale ("to improve lead quality") is added later by the narrative LLM.
function classifyChange(ce: {
  changeResourceType?: string;
  resourceChangeOperation?: string;
  changedFields?: string;
  newResource?: Record<string, Record<string, unknown>>;
}): string | null {
  const type = ce.changeResourceType ?? "";
  const op = ce.resourceChangeOperation ?? "";
  const fields = ce.changedFields ?? "";
  const has = (f: string) => fields.toLowerCase().includes(f.toLowerCase());
  const nr = ce.newResource ?? {};
  const statusOf = (k: string) => String((nr[k]?.status as string) ?? "");

  switch (type) {
    case "CAMPAIGN": {
      if (has("status")) {
        const s = statusOf("campaign");
        return s === "PAUSED" ? "campaigns paused" : s === "ENABLED" ? "campaigns resumed" : s === "REMOVED" ? "campaigns removed" : "campaign status changed";
      }
      if (has("targetCpa") || has("targetRoas") || has("biddingStrategy") || has("maximizeConversion")) return "bid-strategy targets adjusted";
      return "campaign settings updated";
    }
    case "AD_GROUP": {
      if (has("status")) {
        const s = statusOf("adGroup");
        return s === "PAUSED" ? "ad groups paused" : s === "ENABLED" ? "ad groups resumed" : "ad group status changed";
      }
      if (has("cpcBid")) return "ad group bids adjusted";
      return "ad groups updated";
    }
    case "CAMPAIGN_BUDGET":
      return "budgets adjusted";
    case "AD_GROUP_CRITERION": {
      const neg = Boolean((nr.adGroupCriterion?.negative as boolean) ?? false);
      if (has("negative") || neg) return "negative keywords added";
      if (op === "CREATE") return "keywords added";
      if (op === "REMOVE") return "keywords removed";
      if (has("cpcBid")) return "keyword bids adjusted";
      if (has("status")) return "keyword status changed";
      return "keywords updated";
    }
    case "CAMPAIGN_CRITERION": {
      const neg = Boolean((nr.campaignCriterion?.negative as boolean) ?? false);
      if (has("negative") || neg) return "campaign-level negatives added";
      return "campaign targeting updated";
    }
    case "AD_GROUP_AD":
    case "AD":
      return op === "CREATE" ? "ads added" : op === "REMOVE" ? "ads removed" : "ads updated";
    case "AD_GROUP_BID_MODIFIER":
      return "bid adjustments set";
    case "AD_GROUP_ASSET":
    case "CAMPAIGN_ASSET":
      return "assets updated";
    default:
      return null;
  }
}

/**
 * Detailed weekly optimisations, grouped by campaign + action with counts —
 * the raw material for the report's "Optimisations Made" section. Facts only;
 * the narrative layer turns them into client-facing sentences.
 */
export async function getWeeklyOptimisations(
  customerId: string,
  start: string,
  end: string,
): Promise<string[]> {
  const [campRows, changeRows] = await Promise.all([
    gaqlSearch(customerId, "SELECT campaign.id, campaign.name FROM campaign"),
    gaqlSearch(
      customerId,
      `SELECT change_event.change_resource_type, change_event.resource_change_operation,
              change_event.changed_fields, change_event.campaign, change_event.new_resource
       FROM change_event
       WHERE change_event.change_date_time >= '${start} 00:00:00'
         AND change_event.change_date_time <= '${end} 23:59:59'
       ORDER BY change_event.change_date_time DESC LIMIT 2000`,
    ),
  ]);

  const nameById: Record<string, string> = {};
  for (const r of campRows) {
    const c = (r.campaign ?? {}) as { id?: string | number; name?: string };
    if (c.id != null) nameById[String(c.id)] = c.name ?? "";
  }

  const counts: Record<string, number> = {};
  for (const r of changeRows) {
    const ce = (r.changeEvent ?? {}) as Parameters<typeof classifyChange>[0] & {
      campaign?: string;
    };
    const action = classifyChange(ce);
    if (!action) continue;
    const campId = (ce.campaign?.match(/campaigns\/(\d+)/) ?? [])[1];
    const camp = (campId && nameById[campId]) || "account-level";
    counts[`${camp}|||${action}`] = (counts[`${camp}|||${action}`] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const [camp, action] = key.split("|||");
      return camp === "account-level"
        ? `${action} (${n})`
        : `${camp} — ${action} (${n})`;
    });
}

async function buildWeekly(
  customerId: string,
  tz: string,
): Promise<WeeklySummary> {
  const w = windows(tz, 7);
  const [cur, prev, changes] = await Promise.all([
    campaignTotals(customerId, w.start, w.end),
    campaignTotals(customerId, w.prevStart, w.prevEnd),
    changeSummary(customerId, w.start, w.end),
  ]);
  return {
    start: w.start,
    end: w.end,
    spend: kpi(cur.spend, prev.spend),
    conversions: kpi(cur.conversions, prev.conversions),
    changeLines: changes.lines,
    changeCount: changes.count,
  };
}

async function buildDashboard(
  customerId: string,
  windowDays: number,
): Promise<DashboardPayload> {
  // Account meta first (timezone drives the date math, currency drives display).
  const metaRows = await gaqlSearch(
    customerId,
    "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  const cust = ((metaRows[0]?.customer ?? {}) as {
    currencyCode?: string;
    timeZone?: string;
  });
  const currency = cust.currencyCode ?? "USD";
  const timeZone = cust.timeZone ?? "Etc/UTC";
  const w = windows(timeZone, windowDays);

  const [cur, prev, sis, deviceRows, trendRows, termRows, weekly] = await Promise.all([
    campaignTotals(customerId, w.start, w.end),
    campaignTotals(customerId, w.prevStart, w.prevEnd),
    searchImpressionShare(customerId, w.start, w.end),
    gaqlSearch(
      customerId,
      `SELECT segments.device, metrics.cost_micros, metrics.conversions
       FROM campaign WHERE segments.date BETWEEN '${w.start}' AND '${w.end}' AND ${SEARCH_FILTER}`,
    ),
    gaqlSearch(
      customerId,
      `SELECT segments.date, metrics.cost_micros, metrics.conversions
       FROM campaign WHERE segments.date BETWEEN '${w.start}' AND '${w.end}' AND ${SEARCH_FILTER}
       ORDER BY segments.date`,
    ),
    gaqlSearch(
      customerId,
      `SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions
       FROM search_term_view WHERE segments.date BETWEEN '${w.start}' AND '${w.end}'
       ORDER BY metrics.cost_micros DESC LIMIT 10`,
    ),
    buildWeekly(customerId, timeZone),
  ]);

  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

  // Trend (daily) — sum by date.
  const trendMap: Record<string, { spend: number; conversions: number }> = {};
  for (const r of trendRows) {
    const date = ((r.segments ?? {}) as { date?: string }).date ?? "";
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    trendMap[date] ??= { spend: 0, conversions: 0 };
    trendMap[date].spend += micros(m.costMicros);
    trendMap[date].conversions += num(m.conversions);
  }
  const trend = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  // Device — sum by device.
  const devMap: Record<string, { spend: number; conversions: number }> = {};
  for (const r of deviceRows) {
    const device = String(((r.segments ?? {}) as { device?: string }).device ?? "UNKNOWN");
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    devMap[device] ??= { spend: 0, conversions: 0 };
    devMap[device].spend += micros(m.costMicros);
    devMap[device].conversions += num(m.conversions);
  }
  const byDevice = Object.entries(devMap)
    .map(([device, v]) => ({ device: prettyDevice(device), ...v }))
    .sort((a, b) => b.spend - a.spend);

  const byCampaign = Object.entries(cur.byName)
    .map(([name, v]) => ({
      name,
      spend: v.spend,
      conversions: v.conversions,
      costPerConv: ratio(v.spend, v.conversions),
      roas: ratio(v.convValue, v.spend),
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  const topSearchTerms = termRows.map((r) => {
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    return {
      term: ((r.searchTermView ?? {}) as { searchTerm?: string }).searchTerm ?? "—",
      spend: micros(m.costMicros),
      conversions: num(m.conversions),
    };
  });

  return {
    currency,
    timeZone,
    window: windowDays,
    range: { start: w.start, end: w.end },
    hasConversionValue: cur.convValue > 0,
    weekly,
    kpis: {
      spend: kpi(cur.spend, prev.spend),
      impressions: kpi(cur.impressions, prev.impressions),
      clicks: kpi(cur.clicks, prev.clicks),
      ctr: kpi(ratio(cur.clicks, cur.impressions) * 100, ratio(prev.clicks, prev.impressions) * 100),
      avgCpc: kpi(ratio(cur.spend, cur.clicks), ratio(prev.spend, prev.clicks)),
      conversions: kpi(cur.conversions, prev.conversions),
      costPerConv: kpi(ratio(cur.spend, cur.conversions), ratio(prev.spend, prev.conversions)),
      convValue: kpi(cur.convValue, prev.convValue),
      roas: kpi(ratio(cur.convValue, cur.spend), ratio(prev.convValue, prev.spend)),
      convRate: kpi(ratio(cur.conversions, cur.clicks) * 100, ratio(prev.conversions, prev.clicks) * 100),
      searchImprShare: { value: sis, prev: 0, deltaPct: null }, // no prior IS → no delta
    },
    trend,
    byCampaign,
    byDevice,
    topSearchTerms,
  };
}

/**
 * Generate the weekly report for one account: the verified weekly numbers, plus
 * a plain-text rendering for Slack (template — words only, never figures).
 */
export async function generateWeeklyReport(customerId: string): Promise<{
  currency: string;
  timeZone: string;
  weekly: WeeklySummary;
  text: string;
}> {
  const metaRows = await gaqlSearch(
    customerId,
    "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  const cust = (metaRows[0]?.customer ?? {}) as {
    currencyCode?: string;
    timeZone?: string;
  };
  const currency = cust.currencyCode ?? "USD";
  const timeZone = cust.timeZone ?? "Etc/UTC";
  const weekly = await buildWeekly(customerId, timeZone);
  return { currency, timeZone, weekly, text: formatWeeklyText(weekly, currency) };
}

/**
 * The bulleted weekly-update text (Slack fallback when no LLM narrative). Pure
 * formatting over an already-computed WeeklySummary — so callers that already
 * have the dashboard payload (which contains `weekly`) can reuse it without
 * re-querying.
 */
export function formatWeeklyText(weekly: WeeklySummary, currency: string): string {
  const money = (n: number) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  const dec1 = (n: number) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
  const delta = (k: Kpi) =>
    k.deltaPct == null
      ? ""
      : ` (${k.deltaPct >= 0 ? "▲" : "▼"}${Math.abs(k.deltaPct).toFixed(0)}% vs prior week)`;
  const changes = weekly.changeLines.length
    ? `Changes this week: ${weekly.changeLines.join(", ")}.`
    : "No account changes this week.";
  return [
    `📈 *Weekly update* (${weekly.start} → ${weekly.end})`,
    `• Spend: ${money(weekly.spend.value)}${delta(weekly.spend)}`,
    `• Conversions: ${dec1(weekly.conversions.value)}${delta(weekly.conversions)}`,
    `• ${changes}`,
  ].join("\n");
}

function prettyDevice(d: string): string {
  const map: Record<string, string> = {
    MOBILE: "Mobile",
    DESKTOP: "Desktop",
    TABLET: "Tablet",
    CONNECTED_TV: "Connected TV",
    OTHER: "Other",
  };
  return map[d] ?? "Other";
}

/**
 * Cached dashboard fetch. Reads a fresh-enough payload from ads_report_cache;
 * otherwise queries Google, writes the cache, and returns. Cache failures
 * (e.g. table not migrated yet) degrade gracefully to a live query.
 */
export async function getDashboard(
  clientId: string,
  customerId: string,
  windowDays: ReportWindow,
): Promise<DashboardPayload> {
  const supabase = createSupabaseAdminClient();
  try {
    const { data } = await supabase
      .from("ads_report_cache")
      .select("payload, fetched_at")
      .eq("client_id", clientId)
      .eq("window_days", windowDays)
      .single();
    if (data && Date.now() - new Date(data.fetched_at).getTime() < CACHE_TTL_MS) {
      return data.payload as DashboardPayload;
    }
  } catch {
    /* cache miss / table missing — fall through to live */
  }

  const payload = await buildDashboard(customerId, windowDays);

  try {
    await supabase
      .from("ads_report_cache")
      .upsert({ client_id: clientId, window_days: windowDays, payload, fetched_at: new Date().toISOString() });
  } catch {
    /* cache write best-effort */
  }
  return payload;
}

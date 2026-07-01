// Phase 6.1: Google Ads performance dashboard data layer.
// ALL campaign types (Search, Performance Max, Demand Gen, Shopping, Display,
// Video, ...), removed campaigns excluded. Account timezone + currency. The
// 7-day window is the most recent COMPLETE Mon-Sun week; 28/90 stay rolling.
// Conversions are reported on BOTH bases: interaction date (the primary KPIs,
// they mature over time) and conversion date ("By-Time", what happened in the
// period). A few inherently search-only signals (impression-share suite, search
// terms) stay search-scoped and are labelled as such. Whole payload cached per
// client+window (~30 min). NOTE: after any change to the payload SHAPE, clear
// ads_report_cache so the portal re-pulls.
//
// All figures come from here (the data layer). Any LLM summary only rewords
// these verified numbers — it never generates them.
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { gaqlSearch } from "./index";

export const REPORT_WINDOWS = [7, 28, 90] as const;
export const MONTH_WINDOW = 0; // sentinel: last complete calendar month vs the month before
export type ReportWindow = (typeof REPORT_WINDOWS)[number] | typeof MONTH_WINDOW;

// Named report ranges for the on-demand "send to Slack" push. Distinguishes the
// Mon-Sun week from a rolling 7 days (the numeric window cannot).
export type ReportRange = "mon_sun" | "7d" | "14d" | "30d" | "month";
export const REPORT_RANGES: { key: ReportRange; label: string }[] = [
  { key: "mon_sun", label: "Last week (Mon-Sun)" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "Last month" },
];

// Internal window descriptor — the single source of truth for date math.
type WindowSpec =
  | { mode: "mon_sun" }
  | { mode: "rolling"; days: number }
  | { mode: "month" }
  | { mode: "custom"; start: string; end: string };
const specFor = (range: ReportRange): WindowSpec =>
  range === "mon_sun" ? { mode: "mon_sun" }
  : range === "month" ? { mode: "month" }
  : { mode: "rolling", days: range === "7d" ? 7 : range === "14d" ? 14 : 30 };
const specFromWindow = (windowDays: number): WindowSpec =>
  windowDays === MONTH_WINDOW ? { mode: "month" } : windowDays === 7 ? { mode: "mon_sun" } : { mode: "rolling", days: windowDays };
// Range -> narrative cadence wording.
export const cadenceFor = (range: ReportRange): "weekly" | "monthly" =>
  range === "month" || range === "30d" ? "monthly" : "weekly";
// Stable integer cache key per range (ads_report_cache.window_days is an int;
// distinct values, so rolling-7 doesn't collide with the Mon-Sun week).
const RANGE_CACHE_KEY: Record<ReportRange, number> = { mon_sun: 7, "7d": 1, "14d": 14, "30d": 30, month: 0 };
// Query-param <-> range for the dashboard selector + pages.
export const parseReportRange = (raw: string | undefined): ReportRange =>
  raw === "7d" || raw === "14d" || raw === "30d" || raw === "month" ? raw : "mon_sun";
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
  /** Human-readable change lines, e.g. "keywords added (3)". */
  changeLines: string[];
  changeCount: number;
}

export interface CampaignRow {
  name: string;
  channel: string;
  spend: number;
  conversions: number;
  costPerConv: number;
  roas: number;
}
export interface ChannelRow {
  channel: string;
  spend: number;
  conversions: number;
  convValue: number;
  costPerConv: number;
  roas: number;
}
export interface CampaignPerf {
  name: string;
  channel: string;
  clicks: Kpi;
  impressions: Kpi;
  ctr: Kpi;
  avgCpc: Kpi;
  cost: Kpi;
  conversions: Kpi;
  costPerConv: Kpi;
  convRate: Kpi;
}
export interface ConversionAction {
  action: string;
  conversions: number;
  value: number;
}
export interface TopAd {
  campaign: string;
  adGroup: string;
  headline: string;
  finalUrl: string;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  cost: number;
  convValue: number;
}
export interface ImpressionShare {
  impressionShare: number;
  absoluteTop: number;
  top: number;
  rankLost: number;
  budgetLost: number;
}
export interface MonthRow {
  month: string; // YYYY-MM-01
  label: string; // "June 2026"
  clicks: number;
  impressions: number;
  ctr: number;
  avgCpc: number;
  cost: number;
  conversions: number;
  costPerConv: number;
}

export interface DashboardPayload {
  currency: string;
  timeZone: string;
  window: number;
  range: { start: string; end: string };
  prevRange: { start: string; end: string };
  hasConversionValue: boolean;
  weekly: WeeklySummary;
  kpis: {
    spend: Kpi; impressions: Kpi; clicks: Kpi; ctr: Kpi; avgCpc: Kpi;
    conversions: Kpi; costPerConv: Kpi; convValue: Kpi; roas: Kpi; convRate: Kpi;
    searchImprShare: Kpi;
    // By-Time (conversion-date basis), shown alongside the interaction-date figures.
    conversionsByTime: Kpi; convValueByTime: Kpi; roasByTime: Kpi; aov: Kpi;
  };
  avgOrdersPerDay: number;
  avgRevenuePerDay: number;
  trend: { date: string; spend: number; conversions: number }[];
  byCampaign: CampaignRow[];
  byChannel: ChannelRow[];
  campaignPerformance: CampaignPerf[];
  byConversionAction: ConversionAction[];
  topAds: TopAd[];
  impressionShare: ImpressionShare;
  monthPerformance: MonthRow[];
  byDevice: { device: string; spend: number; conversions: number }[];
  topSearchTerms: { term: string; spend: number; conversions: number }[];
}

// Lightweight per-account summary for the Command Center roll-up: the most
// recent complete Mon-Sun week vs the prior week. Cheap (one meta query + two
// totals queries) so it can fan out across many accounts.
export interface AccountSummary {
  customerId: string;
  currency: string;
  timeZone: string;
  range: { start: string; end: string };
  hasConversionValue: boolean;
  spend: Kpi;
  conversions: Kpi;
  costPerConv: Kpi;
  convValue: Kpi;
  roas: Kpi;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const micros = (v: unknown) => num(v) / 1_000_000;
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
const ctrOf = (clicks: number, impressions: number) => ratio(clicks, impressions) * 100;
const cvrOf = (conversions: number, clicks: number) => ratio(conversions, clicks) * 100;

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

// The 7-day window is special-cased to the most recent COMPLETE Mon-Sun week
// (the weekly report period); 28/90 stay rolling "last N days excluding today".
function windowsSpec(tz: string, spec: WindowSpec) {
  const today = new Date(`${ymdInTz(new Date(), tz)}T00:00:00Z`);
  if (spec.mode === "month") {
    // Last COMPLETE calendar month vs the month before it.
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const start = fmt(new Date(Date.UTC(y, m - 1, 1))); // first of last month
    const end = fmt(new Date(Date.UTC(y, m, 0))); // last day of last month
    const prevStart = fmt(new Date(Date.UTC(y, m - 2, 1))); // first of the month before
    const prevEnd = fmt(new Date(Date.UTC(y, m - 1, 0))); // last day of the month before
    return { start, end, prevStart, prevEnd };
  }
  if (spec.mode === "custom") {
    // Arbitrary start/end; compare against the equal-length preceding period.
    const s = new Date(`${spec.start}T00:00:00Z`);
    const e = new Date(`${spec.end}T00:00:00Z`);
    const len = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
    const prevEnd = addDays(s, -1);
    const prevStart = addDays(prevEnd, -(len - 1));
    return { start: fmt(s), end: fmt(e), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
  }
  if (spec.mode === "mon_sun") {
    const dow = today.getUTCDay(); // 0=Sun … 6=Sat
    const backToSunday = dow === 0 ? 7 : dow; // days back to last completed Sunday
    const end = addDays(today, -backToSunday); // Sunday
    const start = addDays(end, -6); // Monday
    const prevEnd = addDays(start, -1); // previous Sunday
    const prevStart = addDays(prevEnd, -6); // previous Monday
    return { start: fmt(start), end: fmt(end), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
  }
  // rolling: last N days excluding today, vs the N days before that.
  const n = spec.days;
  const end = addDays(today, -1);
  const start = addDays(end, -(n - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(n - 1));
  return { start: fmt(start), end: fmt(end), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
}

// Back-compat numeric wrapper (7 = Mon-Sun, 0 = month, else rolling N).
const windows = (tz: string, windowDays: number) => windowsSpec(tz, specFromWindow(windowDays));

function kpi(value: number, prev: number): Kpi {
  return { value, prev, deltaPct: prev > 0 ? ((value - prev) / prev) * 100 : null };
}

// All-channel: only removed campaigns are excluded. Search-only metrics use the
// stricter filter below.
const ACTIVE_FILTER = "campaign.status != 'REMOVED'";
const SEARCH_ONLY_FILTER =
  "campaign.advertising_channel_type = 'SEARCH' AND campaign.status != 'REMOVED'";

const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: "Search",
  PERFORMANCE_MAX: "Performance Max",
  DEMAND_GEN: "Demand Gen",
  DISCOVERY: "Demand Gen",
  DISPLAY: "Display",
  SHOPPING: "Shopping",
  VIDEO: "Video",
  MULTI_CHANNEL: "App",
  LOCAL_SERVICES: "Local Services",
  SMART: "Smart",
  HOTEL: "Hotel",
  TRAVEL: "Travel",
  LOCAL: "Local",
};
function channelLabel(t?: string): string {
  const key = t ?? "";
  if (CHANNEL_LABEL[key]) return CHANNEL_LABEL[key];
  if (!key) return "Other";
  return key
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface CampaignAgg {
  channel: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  convValue: number;
}
interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  convValue: number;
  convByTime: number;
  convValueByTime: number;
  byName: Record<string, CampaignAgg>;
  byChannel: Record<string, Omit<CampaignAgg, "channel">>;
}

// Aggregate campaign metrics across ALL channels for a date range. Tracks both
// conversion bases (interaction date + by-conversion-date) and retains
// impressions/clicks per campaign (the Campaign-performance grid needs them).
async function campaignTotals(customerId: string, start: string, end: string): Promise<Totals> {
  const rows = await gaqlSearch(
    customerId,
    `SELECT campaign.name, campaign.advertising_channel_type,
            metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.conversions, metrics.conversions_value,
            metrics.conversions_by_conversion_date, metrics.conversions_value_by_conversion_date
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}' AND ${ACTIVE_FILTER}`,
  );

  const t: Totals = {
    spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0,
    convByTime: 0, convValueByTime: 0, byName: {}, byChannel: {},
  };
  for (const r of rows) {
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const c = micros(m.costMicros);
    const im = num(m.impressions);
    const ck = num(m.clicks);
    const cn = num(m.conversions);
    const cv = num(m.conversionsValue);
    const cnt = num(m.conversionsByConversionDate);
    const cvt = num(m.conversionsValueByConversionDate);
    const channel = channelLabel(String(((r.campaign ?? {}) as { advertisingChannelType?: string }).advertisingChannelType ?? ""));
    const name = ((r.campaign ?? {}) as { name?: string }).name ?? "(unnamed)";

    t.spend += c; t.impressions += im; t.clicks += ck;
    t.conversions += cn; t.convValue += cv;
    t.convByTime += cnt; t.convValueByTime += cvt;

    t.byName[name] ??= { channel, spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 };
    t.byName[name].spend += c; t.byName[name].impressions += im; t.byName[name].clicks += ck;
    t.byName[name].conversions += cn; t.byName[name].convValue += cv;

    t.byChannel[channel] ??= { spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 };
    t.byChannel[channel].spend += c; t.byChannel[channel].impressions += im; t.byChannel[channel].clicks += ck;
    t.byChannel[channel].conversions += cn; t.byChannel[channel].convValue += cv;
  }
  return t;
}

// Impression-share suite (Search-only; impression-weighted). NOTE: the Google
// Ads API does NOT expose the real Auction Insights report (competitor domains /
// overlap / outranking) — there is no queryable resource. This is the only
// programmatic equivalent; the UI labels it as such.
async function impressionShareSuite(customerId: string, start: string, end: string): Promise<ImpressionShare> {
  const rows = await gaqlSearch(
    customerId,
    `SELECT metrics.impressions, metrics.search_impression_share,
            metrics.search_absolute_top_impression_share, metrics.search_top_impression_share,
            metrics.search_rank_lost_impression_share, metrics.search_budget_lost_impression_share
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}' AND ${SEARCH_ONLY_FILTER}`,
  );
  let imprDenom = 0;
  const w = { impressionShare: 0, absoluteTop: 0, top: 0, rankLost: 0, budgetLost: 0 };
  for (const r of rows) {
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    if (m.searchImpressionShare == null) continue;
    const impr = num(m.impressions);
    imprDenom += impr;
    w.impressionShare += num(m.searchImpressionShare) * impr;
    w.absoluteTop += num(m.searchAbsoluteTopImpressionShare) * impr;
    w.top += num(m.searchTopImpressionShare) * impr;
    w.rankLost += num(m.searchRankLostImpressionShare) * impr;
    w.budgetLost += num(m.searchBudgetLostImpressionShare) * impr;
  }
  const pct = (x: number) => (imprDenom > 0 ? (x / imprDenom) * 100 : 0);
  return {
    impressionShare: pct(w.impressionShare),
    absoluteTop: pct(w.absoluteTop),
    top: pct(w.top),
    rankLost: pct(w.rankLost),
    budgetLost: pct(w.budgetLost),
  };
}

// Map one campaign id -> { name, channel } so change events can be labelled
// with the correct campaign AND channel.
async function campaignChannelMap(customerId: string): Promise<Record<string, { name: string; channel: string }>> {
  const rows = await gaqlSearch(
    customerId,
    "SELECT campaign.id, campaign.name, campaign.advertising_channel_type FROM campaign",
  );
  const map: Record<string, { name: string; channel: string }> = {};
  for (const r of rows) {
    const c = (r.campaign ?? {}) as { id?: string | number; name?: string; advertisingChannelType?: string };
    if (c.id != null) map[String(c.id)] = { name: c.name ?? "", channel: String(c.advertisingChannelType ?? "") };
  }
  return map;
}

// Classify one change_event into a specific, plain-English optimisation label,
// channel-aware so criterion/asset changes in PMax / Demand Gen / Shopping are
// not mislabelled as "keywords". Returns null for noise. FACTS only.
function classifyChange(
  ce: {
    changeResourceType?: string;
    resourceChangeOperation?: string;
    changedFields?: string;
    newResource?: Record<string, Record<string, unknown>>;
  },
  channel?: string,
): string | null {
  const type = ce.changeResourceType ?? "";
  const op = ce.resourceChangeOperation ?? "";
  const fields = ce.changedFields ?? "";
  const has = (f: string) => fields.toLowerCase().includes(f.toLowerCase());
  const nr = ce.newResource ?? {};
  const statusOf = (k: string) => String((nr[k]?.status as string) ?? "");
  const isSearch = !channel || channel === "SEARCH";

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
      const critType = String((nr.adGroupCriterion?.type as string) ?? "");
      const neg = Boolean((nr.adGroupCriterion?.negative as boolean) ?? false);
      if (critType === "LISTING_GROUP")
        return op === "CREATE" ? "product groups added" : op === "REMOVE" ? "product groups removed" : "product groups updated";
      if (has("negative") || neg) return "negative keywords added";
      if (critType && critType !== "KEYWORD")
        return op === "CREATE" ? "audience targeting added" : op === "REMOVE" ? "audience targeting removed" : "audience targeting updated";
      if (!isSearch && !critType)
        return op === "CREATE" ? "targeting added" : op === "REMOVE" ? "targeting removed" : "targeting updated";
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
    case "ASSET":
    case "AD_GROUP_ASSET":
    case "CAMPAIGN_ASSET":
    case "CUSTOMER_ASSET":
      return op === "CREATE" ? "assets added" : op === "REMOVE" ? "assets removed" : "assets updated";
    case "ASSET_SET":
    case "ASSET_SET_ASSET":
    case "CAMPAIGN_ASSET_SET":
      return "asset/feed sets updated";
    case "FEED":
    case "FEED_ITEM":
    case "CAMPAIGN_FEED":
    case "AD_GROUP_FEED":
      return op === "CREATE" ? "feed items added" : op === "REMOVE" ? "feed items removed" : "feed items updated";
    default:
      return null;
  }
}

const CHANGE_EVENT_SELECT =
  `SELECT change_event.change_resource_type, change_event.resource_change_operation,
          change_event.changed_fields, change_event.campaign, change_event.new_resource
   FROM change_event`;

const campIdFrom = (ce: { campaign?: string }) => (ce.campaign?.match(/campaigns\/(\d+)/) ?? [])[1];

// Channel-aware change summary (template fallback): grouped by action, counted.
// NOTE: the Google Ads change_event resource only returns the last 30 days, so
// we clamp the start date. For a monthly/long report this means the change log
// covers the most recent 30 days of the period (a Google limit, not an error).
async function changeSummary(customerId: string, start: string, end: string) {
  const floor = fmt(addDays(new Date(), -29)); // change_event: last 30 days only
  const qStart = start < floor ? floor : start;
  const [chanMap, rows] = await Promise.all([
    campaignChannelMap(customerId),
    gaqlSearch(
      customerId,
      `${CHANGE_EVENT_SELECT}
       WHERE change_event.change_date_time >= '${qStart} 00:00:00'
         AND change_event.change_date_time <= '${end} 23:59:59'
       ORDER BY change_event.change_date_time DESC LIMIT 1000`,
    ),
  ]);
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const ce = (r.changeEvent ?? {}) as Parameters<typeof classifyChange>[0] & { campaign?: string };
    const campId = campIdFrom(ce);
    const action = classifyChange(ce, campId ? chanMap[campId]?.channel : undefined);
    if (!action) continue;
    counts[action] = (counts[action] ?? 0) + 1;
  }
  const lines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([action, n]) => `${action} (${n})`);
  return { count: rows.length, lines };
}

/**
 * Detailed weekly optimisations, grouped by campaign (+ channel) + action.
 */
export async function getWeeklyOptimisations(
  customerId: string,
  start: string,
  end: string,
): Promise<string[]> {
  // change_event only returns the last 30 days — clamp the start or Google
  // rejects the query ("start date too old") for monthly/long ranges.
  const floor = fmt(addDays(new Date(), -29));
  const qStart = start < floor ? floor : start;
  const [chanMap, changeRows] = await Promise.all([
    campaignChannelMap(customerId),
    gaqlSearch(
      customerId,
      `${CHANGE_EVENT_SELECT}
       WHERE change_event.change_date_time >= '${qStart} 00:00:00'
         AND change_event.change_date_time <= '${end} 23:59:59'
       ORDER BY change_event.change_date_time DESC LIMIT 2000`,
    ),
  ]);

  const counts: Record<string, number> = {};
  for (const r of changeRows) {
    const ce = (r.changeEvent ?? {}) as Parameters<typeof classifyChange>[0] & { campaign?: string };
    const campId = campIdFrom(ce);
    const info = campId ? chanMap[campId] : undefined;
    const action = classifyChange(ce, info?.channel);
    if (!action) continue;
    const label = info?.name ? `${info.name} [${channelLabel(info.channel)}]` : "account-level";
    counts[`${label}|||${action}`] = (counts[`${label}|||${action}`] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const [label, action] = key.split("|||");
      return label === "account-level" ? `${action} (${n})` : `${label}: ${action} (${n})`;
    });
}

async function buildWeekly(customerId: string, tz: string): Promise<WeeklySummary> {
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

async function buildDashboard(customerId: string, spec: WindowSpec): Promise<DashboardPayload> {
  // Account meta first (timezone drives the date math, currency drives display).
  const metaRows = await gaqlSearch(
    customerId,
    "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  const cust = (metaRows[0]?.customer ?? {}) as { currencyCode?: string; timeZone?: string };
  const currency = cust.currencyCode ?? "USD";
  const timeZone = cust.timeZone ?? "Etc/UTC";
  const w = windowsSpec(timeZone, spec);
  // A representative numeric window for the payload (rolling N, 7 mon-sun, else 0).
  const windowNum = spec.mode === "rolling" ? spec.days : spec.mode === "mon_sun" ? 7 : 0;
  // Actual number of days in the window (drives per-day averages).
  const spanDays = Math.max(1, Math.round((new Date(w.end).getTime() - new Date(w.start).getTime()) / 86_400_000) + 1);

  // Month-performance range: first of the month 5 months ago → yesterday.
  const todayTz = new Date(`${ymdInTz(new Date(), timeZone)}T00:00:00Z`);
  const monthStart = fmt(new Date(Date.UTC(todayTz.getUTCFullYear(), todayTz.getUTCMonth() - 5, 1)));
  const monthEnd = fmt(addDays(todayTz, -1));

  const [cur, prev, impr, deviceRows, trendRows, termRows, convActionRows, adRows, monthRows, weekly] =
    await Promise.all([
      campaignTotals(customerId, w.start, w.end),
      campaignTotals(customerId, w.prevStart, w.prevEnd),
      impressionShareSuite(customerId, w.start, w.end),
      // Device split: all channels, interaction-date conversions (by-time is
      // incompatible with the device segment).
      gaqlSearch(
        customerId,
        `SELECT segments.device, metrics.cost_micros, metrics.conversions
         FROM campaign WHERE segments.date BETWEEN '${w.start}' AND '${w.end}' AND ${ACTIVE_FILTER}`,
      ),
      // Daily trend: all channels, conversions by conversion date (date segment OK).
      gaqlSearch(
        customerId,
        `SELECT segments.date, metrics.cost_micros,
                metrics.conversions, metrics.conversions_by_conversion_date
         FROM campaign WHERE segments.date BETWEEN '${w.start}' AND '${w.end}' AND ${ACTIVE_FILTER}
         ORDER BY segments.date`,
      ),
      // Top search terms (inherently Search-only) — ranked by conversion volume.
      gaqlSearch(
        customerId,
        `SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions
         FROM search_term_view WHERE segments.date BETWEEN '${w.start}' AND '${w.end}'
         ORDER BY metrics.conversions DESC, metrics.cost_micros DESC LIMIT 10`,
      ),
      // Conversions by action (account-wide).
      gaqlSearch(
        customerId,
        `SELECT segments.conversion_action_name, metrics.conversions, metrics.conversions_value
         FROM campaign WHERE segments.date BETWEEN '${w.start}' AND '${w.end}' AND ${ACTIVE_FILTER}`,
      ),
      // Top performing ads (rank by conversions).
      gaqlSearch(
        customerId,
        `SELECT campaign.name, ad_group.name, ad_group_ad.ad.type, ad_group_ad.ad.name,
                ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.final_urls,
                metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.conversions, metrics.conversions_value
         FROM ad_group_ad
         WHERE segments.date BETWEEN '${w.start}' AND '${w.end}'
           AND ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'
         ORDER BY metrics.conversions DESC LIMIT 25`,
      ),
      // Month performance (last 6 calendar months incl. current partial).
      gaqlSearch(
        customerId,
        `SELECT segments.month, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
         FROM campaign WHERE segments.date BETWEEN '${monthStart}' AND '${monthEnd}' AND ${ACTIVE_FILTER}
         ORDER BY segments.month`,
      ),
      buildWeekly(customerId, timeZone),
    ]);

  // Trend (daily) — prefer by-conversion-date per day.
  const trendMap: Record<string, { spend: number; conversions: number }> = {};
  for (const r of trendRows) {
    const date = ((r.segments ?? {}) as { date?: string }).date ?? "";
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const cbd = num(m.conversionsByConversionDate);
    const cin = num(m.conversions);
    trendMap[date] ??= { spend: 0, conversions: 0 };
    trendMap[date].spend += micros(m.costMicros);
    trendMap[date].conversions += cbd > 0 ? cbd : cin;
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

  const byCampaign: CampaignRow[] = Object.entries(cur.byName)
    .map(([name, v]) => ({
      name,
      channel: v.channel,
      spend: v.spend,
      conversions: v.conversions,
      costPerConv: ratio(v.spend, v.conversions),
      roas: ratio(v.convValue, v.spend),
    }))
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  const byChannel: ChannelRow[] = Object.entries(cur.byChannel)
    .map(([channel, v]) => ({
      channel,
      spend: v.spend,
      conversions: v.conversions,
      convValue: v.convValue,
      costPerConv: ratio(v.spend, v.conversions),
      roas: ratio(v.convValue, v.spend),
    }))
    .sort((a, b) => b.spend - a.spend);

  // Campaign-performance grid: join cur/prev by name, each metric a Kpi.
  const empty: CampaignAgg = { channel: "", spend: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 };
  const campaignPerformance: CampaignPerf[] = Array.from(
    new Set([...Object.keys(cur.byName), ...Object.keys(prev.byName)]),
  )
    .map((name) => {
      const c = cur.byName[name] ?? empty;
      const p = prev.byName[name] ?? empty;
      return {
        name,
        channel: (cur.byName[name] ?? prev.byName[name] ?? empty).channel,
        clicks: kpi(c.clicks, p.clicks),
        impressions: kpi(c.impressions, p.impressions),
        ctr: kpi(ctrOf(c.clicks, c.impressions), ctrOf(p.clicks, p.impressions)),
        avgCpc: kpi(ratio(c.spend, c.clicks), ratio(p.spend, p.clicks)),
        cost: kpi(c.spend, p.spend),
        conversions: kpi(c.conversions, p.conversions),
        costPerConv: kpi(ratio(c.spend, c.conversions), ratio(p.spend, p.conversions)),
        convRate: kpi(cvrOf(c.conversions, c.clicks), cvrOf(p.conversions, p.clicks)),
      };
    })
    .filter((r) => r.cost.value > 0) // ignore 0-spend campaigns
    .sort((a, b) => b.cost.value - a.cost.value)
    .slice(0, 15);

  // Conversions by action.
  const actionMap: Record<string, { conversions: number; value: number }> = {};
  for (const r of convActionRows) {
    const action = String(((r.segments ?? {}) as { conversionActionName?: string }).conversionActionName ?? "—");
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    actionMap[action] ??= { conversions: 0, value: 0 };
    actionMap[action].conversions += num(m.conversions);
    actionMap[action].value += num(m.conversionsValue);
  }
  const byConversionAction: ConversionAction[] = Object.entries(actionMap)
    .map(([action, v]) => ({ action, conversions: v.conversions, value: v.value }))
    .filter((a) => a.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions);

  // Top ads (parse RSA headlines; fall back to ad name/type). Ignore 0-spend ads
  // and cap at 10 after filtering.
  const topAds: TopAd[] = adRows
    .map((r) => {
      const aga = (r.adGroupAd ?? {}) as {
        ad?: {
          type?: string;
          name?: string;
          responsiveSearchAd?: { headlines?: { text?: string }[] };
          finalUrls?: string[];
        };
      };
      const ad = aga.ad ?? {};
      const headlines = (ad.responsiveSearchAd?.headlines ?? [])
        .map((h) => h.text)
        .filter(Boolean) as string[];
      const headline = headlines.slice(0, 3).join(" · ") || ad.name || channelLabel(ad.type) || "(ad)";
      const m = (r.metrics ?? {}) as Record<string, unknown>;
      const impressions = num(m.impressions);
      const clicks = num(m.clicks);
      return {
        campaign: ((r.campaign ?? {}) as { name?: string }).name ?? "—",
        adGroup: ((r.adGroup ?? {}) as { name?: string }).name ?? "",
        headline,
        finalUrl: ad.finalUrls?.[0] ?? "",
        impressions,
        clicks,
        ctr: ctrOf(clicks, impressions),
        conversions: num(m.conversions),
        cost: micros(m.costMicros),
        convValue: num(m.conversionsValue),
      };
    })
    .filter((a) => a.cost > 0)
    .slice(0, 10);

  // Month performance.
  const monthMap: Record<string, { impressions: number; clicks: number; cost: number; conversions: number }> = {};
  for (const r of monthRows) {
    const month = String(((r.segments ?? {}) as { month?: string }).month ?? "");
    if (!month) continue;
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    monthMap[month] ??= { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    monthMap[month].impressions += num(m.impressions);
    monthMap[month].clicks += num(m.clicks);
    monthMap[month].cost += micros(m.costMicros);
    monthMap[month].conversions += num(m.conversions);
  }
  const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
  const monthPerformance: MonthRow[] = Object.entries(monthMap)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, v]) => ({
      month,
      label: monthFmt.format(new Date(`${month}T00:00:00Z`)),
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: ctrOf(v.clicks, v.impressions),
      avgCpc: ratio(v.cost, v.clicks),
      cost: v.cost,
      conversions: v.conversions,
      costPerConv: ratio(v.cost, v.conversions),
    }));

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
    window: windowNum,
    range: { start: w.start, end: w.end },
    prevRange: { start: w.prevStart, end: w.prevEnd },
    hasConversionValue: cur.convValue > 0 || cur.convValueByTime > 0,
    weekly,
    kpis: {
      spend: kpi(cur.spend, prev.spend),
      impressions: kpi(cur.impressions, prev.impressions),
      clicks: kpi(cur.clicks, prev.clicks),
      ctr: kpi(ctrOf(cur.clicks, cur.impressions), ctrOf(prev.clicks, prev.impressions)),
      avgCpc: kpi(ratio(cur.spend, cur.clicks), ratio(prev.spend, prev.clicks)),
      conversions: kpi(cur.conversions, prev.conversions),
      costPerConv: kpi(ratio(cur.spend, cur.conversions), ratio(prev.spend, prev.conversions)),
      convValue: kpi(cur.convValue, prev.convValue),
      roas: kpi(ratio(cur.convValue, cur.spend), ratio(prev.convValue, prev.spend)),
      convRate: kpi(cvrOf(cur.conversions, cur.clicks), cvrOf(prev.conversions, prev.clicks)),
      searchImprShare: { value: impr.impressionShare, prev: 0, deltaPct: null },
      conversionsByTime: kpi(cur.convByTime, prev.convByTime),
      convValueByTime: kpi(cur.convValueByTime, prev.convValueByTime),
      roasByTime: kpi(ratio(cur.convValueByTime, cur.spend), ratio(prev.convValueByTime, prev.spend)),
      aov: kpi(ratio(cur.convValue, cur.conversions), ratio(prev.convValue, prev.conversions)),
    },
    avgOrdersPerDay: cur.conversions / spanDays,
    avgRevenuePerDay: cur.convValue / spanDays,
    trend,
    byCampaign,
    byChannel,
    campaignPerformance,
    byConversionAction,
    topAds,
    impressionShare: impr,
    monthPerformance,
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
  const cust = (metaRows[0]?.customer ?? {}) as { currencyCode?: string; timeZone?: string };
  const currency = cust.currencyCode ?? "USD";
  const timeZone = cust.timeZone ?? "Etc/UTC";
  const weekly = await buildWeekly(customerId, timeZone);
  return { currency, timeZone, weekly, text: formatWeeklyText(weekly, currency) };
}

/**
 * The bulleted weekly-update text (Slack fallback when no LLM narrative).
 */
export function formatWeeklyText(weekly: WeeklySummary, currency: string): string {
  const money = (n: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  const dec1 = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
  const delta = (k: Kpi) =>
    k.deltaPct == null ? "" : ` (${k.deltaPct >= 0 ? "▲" : "▼"}${Math.abs(k.deltaPct).toFixed(0)}% vs prior week)`;
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
 * degrade gracefully to a live query.
 */
// Cross-account roll-up source. One customer-meta query + two campaignTotals
// queries (current vs prior Mon-Sun week). Much cheaper than getDashboard.
export async function getAccountSummary(customerId: string): Promise<AccountSummary> {
  const metaRows = await gaqlSearch(
    customerId,
    "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  const cust = (metaRows[0]?.customer ?? {}) as { currencyCode?: string; timeZone?: string };
  const currency = cust.currencyCode ?? "USD";
  const timeZone = cust.timeZone ?? "Etc/UTC";
  const w = windows(timeZone, 7);
  const [cur, prev] = await Promise.all([
    campaignTotals(customerId, w.start, w.end),
    campaignTotals(customerId, w.prevStart, w.prevEnd),
  ]);
  const cpc = (t: Totals) => (t.conversions > 0 ? t.spend / t.conversions : 0);
  const roasOf = (t: Totals) => (t.spend > 0 ? t.convValue / t.spend : 0);
  return {
    customerId,
    currency,
    timeZone,
    range: { start: w.start, end: w.end },
    hasConversionValue: cur.convValue > 0 || prev.convValue > 0,
    spend: kpi(cur.spend, prev.spend),
    conversions: kpi(cur.conversions, prev.conversions),
    costPerConv: kpi(cpc(cur), cpc(prev)),
    convValue: kpi(cur.convValue, prev.convValue),
    roas: kpi(roasOf(cur), roasOf(prev)),
  };
}

export async function getDashboard(
  clientId: string,
  customerId: string,
  range: ReportRange,
): Promise<DashboardPayload> {
  const supabase = createSupabaseAdminClient();
  const cacheKey = RANGE_CACHE_KEY[range];
  try {
    const { data } = await supabase
      .from("ads_report_cache")
      .select("payload, fetched_at")
      .eq("client_id", clientId)
      .eq("window_days", cacheKey)
      .single();
    if (data && Date.now() - new Date(data.fetched_at).getTime() < CACHE_TTL_MS) {
      return data.payload as DashboardPayload;
    }
  } catch {
    /* cache miss / table missing — fall through to live */
  }

  const payload = await buildDashboard(customerId, specFor(range));

  try {
    await supabase
      .from("ads_report_cache")
      .upsert({ client_id: clientId, window_days: cacheKey, payload, fetched_at: new Date().toISOString() });
  } catch {
    /* cache write best-effort */
  }
  return payload;
}

// Live (uncached) dashboard for a named range — used by the on-demand Slack push,
// which supports ranges (rolling 7/14/30) the cached dashboard window does not.
export async function getDashboardForRange(customerId: string, range: ReportRange): Promise<DashboardPayload> {
  return buildDashboard(customerId, specFor(range));
}

// Live dashboard for an arbitrary date range (e.g. a specific past month).
// Metrics work for any historical range; only the change log is 30-day capped.
export async function getDashboardForCustomRange(customerId: string, start: string, end: string): Promise<DashboardPayload> {
  return buildDashboard(customerId, { mode: "custom", start, end });
}

// Resolve a dashboard payload + the active range key from URL search params.
// Handles ?range=custom&start=&end= (live) and the named ranges (cached).
export async function resolveDashboard(
  clientId: string,
  customerId: string,
  q: { range?: string; start?: string; end?: string },
): Promise<{ payload: DashboardPayload; rangeKey: string }> {
  if (q.range === "custom" && q.start && q.end) {
    const [start, end] = q.start <= q.end ? [q.start, q.end] : [q.end, q.start];
    return { payload: await getDashboardForCustomRange(customerId, start, end), rangeKey: "custom" };
  }
  const range = parseReportRange(q.range);
  return { payload: await getDashboard(clientId, customerId, range), rangeKey: range };
}

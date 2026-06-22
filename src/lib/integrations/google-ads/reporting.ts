// Phase 6.1: Google Ads performance dashboard data layer.
// ALL campaign types (Search, Performance Max, Demand Gen, Shopping, Display,
// Video, ...), removed campaigns excluded, account timezone + currency, last
// 28 vs prior 28 (or 7/90) excluding today. Conversions are counted by
// CONVERSION DATE (what happened this week), with an interaction-date fallback
// for the documented case where conversions_by_conversion_date returns empty.
// A few inherently search-only metrics (search impression share, search terms)
// stay search-scoped and are labelled as such. Whole payload cached per
// client+window (~30 min) so client refreshes don't drain the shared API quota.
//
// All figures come from here (the data layer). Any LLM summary only rewords
// these verified numbers — it never generates them.
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
  /** Human-readable change lines, e.g. "keywords added (3)". */
  changeLines: string[];
  changeCount: number;
}

export interface DashboardPayload {
  currency: string;
  timeZone: string;
  window: number;
  range: { start: string; end: string };
  hasConversionValue: boolean;
  /** True when conversions are attributed by conversion date (the default);
   *  false when we fell back to interaction-date because the by-date metric
   *  came back empty. */
  convByConversionDate: boolean;
  weekly: WeeklySummary;
  kpis: {
    spend: Kpi; impressions: Kpi; clicks: Kpi; ctr: Kpi; avgCpc: Kpi;
    conversions: Kpi; costPerConv: Kpi; convValue: Kpi; roas: Kpi;
    convRate: Kpi; searchImprShare: Kpi;
  };
  trend: { date: string; spend: number; conversions: number }[];
  byCampaign: { name: string; channel: string; spend: number; conversions: number; costPerConv: number; roas: number }[];
  byChannel: { channel: string; spend: number; conversions: number; convValue: number; costPerConv: number; roas: number }[];
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
function prettyChannel(t: string): string {
  if (CHANNEL_LABEL[t]) return CHANNEL_LABEL[t];
  if (!t) return "Other";
  // Title-case an unmapped enum (e.g. SOME_NEW_TYPE -> "Some New Type").
  return t
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  convValue: number;
  /** false when we fell back to interaction-date (by-date metric was empty). */
  byConversionDate: boolean;
  byName: Record<string, { spend: number; conversions: number; convValue: number; channel: string }>;
  byChannel: Record<string, { spend: number; impressions: number; clicks: number; conversions: number; convValue: number }>;
}

// Aggregate campaign metrics across ALL channels for a date range. Reads both
// conversion bases and prefers by-conversion-date (what happened in the week),
// falling back to interaction-date only if by-date is entirely empty.
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

  let spend = 0, impressions = 0, clicks = 0;
  let convByDate = 0, convInt = 0, valByDate = 0, valInt = 0;
  // Per-bucket we keep both conversion bases, then resolve once we know which to use.
  const rawName: Record<string, { spend: number; convByDate: number; convInt: number; valByDate: number; valInt: number; channel: string }> = {};
  const rawChan: Record<string, { spend: number; impressions: number; clicks: number; convByDate: number; convInt: number; valByDate: number; valInt: number }> = {};

  for (const r of rows) {
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const c = micros(m.costMicros);
    const imp = num(m.impressions);
    const clk = num(m.clicks);
    const cbd = num(m.conversionsByConversionDate);
    const cin = num(m.conversions);
    const vbd = num(m.conversionsValueByConversionDate);
    const vin = num(m.conversionsValue);
    const channel = String(((r.campaign ?? {}) as { advertisingChannelType?: string }).advertisingChannelType ?? "");
    const name = ((r.campaign ?? {}) as { name?: string }).name ?? "(unnamed)";

    spend += c; impressions += imp; clicks += clk;
    convByDate += cbd; convInt += cin; valByDate += vbd; valInt += vin;

    rawName[name] ??= { spend: 0, convByDate: 0, convInt: 0, valByDate: 0, valInt: 0, channel: prettyChannel(channel) };
    rawName[name].spend += c; rawName[name].convByDate += cbd; rawName[name].convInt += cin;
    rawName[name].valByDate += vbd; rawName[name].valInt += vin;

    const ch = prettyChannel(channel);
    rawChan[ch] ??= { spend: 0, impressions: 0, clicks: 0, convByDate: 0, convInt: 0, valByDate: 0, valInt: 0 };
    rawChan[ch].spend += c; rawChan[ch].impressions += imp; rawChan[ch].clicks += clk;
    rawChan[ch].convByDate += cbd; rawChan[ch].convInt += cin;
    rawChan[ch].valByDate += vbd; rawChan[ch].valInt += vin;
  }

  // Prefer by-conversion-date; fall back to interaction-date if the by-date
  // metric came back empty while interaction-date conversions exist.
  const useByDate = convByDate > 0 || convInt === 0;
  const pickConv = (bd: number, it: number) => (useByDate ? bd : it);

  const byName: Totals["byName"] = {};
  for (const [name, v] of Object.entries(rawName)) {
    byName[name] = { spend: v.spend, conversions: pickConv(v.convByDate, v.convInt), convValue: pickConv(v.valByDate, v.valInt), channel: v.channel };
  }
  const byChannel: Totals["byChannel"] = {};
  for (const [ch, v] of Object.entries(rawChan)) {
    byChannel[ch] = { spend: v.spend, impressions: v.impressions, clicks: v.clicks, conversions: pickConv(v.convByDate, v.convInt), convValue: pickConv(v.valByDate, v.valInt) };
  }

  return {
    spend,
    impressions,
    clicks,
    conversions: pickConv(convByDate, convInt),
    convValue: pickConv(valByDate, valInt),
    byConversionDate: useByDate,
    byName,
    byChannel,
  };
}

// Search impression share is an inherently search-only metric (PMax/Demand Gen
// have no equivalent). Kept search-scoped and labelled as such in the report.
async function searchImpressionShare(customerId: string, start: string, end: string) {
  const rows = await gaqlSearch(
    customerId,
    `SELECT metrics.impressions, metrics.search_impression_share
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}' AND ${SEARCH_ONLY_FILTER}`,
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

const OP_VERB: Record<string, string> = {
  CREATE: "added",
  REMOVE: "removed",
  UPDATE: "updated",
};

// Map one campaign id -> { name, channel } so change events can be labelled
// with the correct campaign AND channel (a Demand Gen edit must not read as a
// Search edit).
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
// using the resource type, the operation, the changed field mask, the new
// resource, AND the campaign's channel. Channel-aware so that criterion/asset
// changes in PMax / Demand Gen / Shopping are not mislabelled as "keywords".
// Returns null for noise we don't want to surface. These are FACTS (what
// changed); any rationale is added later by the narrative LLM.
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
      // Shopping / PMax listing groups (product partitions) — the "product IDs
      // reported as keywords" bug. Distinguish by criterion type.
      if (critType === "LISTING_GROUP")
        return op === "CREATE" ? "product groups added" : op === "REMOVE" ? "product groups removed" : "product groups updated";
      if (has("negative") || neg) return "negative keywords added";
      // Non-keyword criteria (audiences, webpages, user lists) — common outside Search.
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

// Aggregate the account's change history into plain-English lines (template,
// not LLM): channel-aware classification, grouped by action and counted.
async function changeSummary(customerId: string, start: string, end: string) {
  const [chanMap, rows] = await Promise.all([
    campaignChannelMap(customerId),
    gaqlSearch(
      customerId,
      `${CHANGE_EVENT_SELECT}
       WHERE change_event.change_date_time >= '${start} 00:00:00'
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
 * Detailed weekly optimisations, grouped by campaign (+ channel) + action with
 * counts — the raw material for the report's "Optimisations Made" section.
 * Channel-aware so PMax / Demand Gen changes are labelled correctly. Facts only;
 * the narrative layer turns them into client-facing sentences.
 */
export async function getWeeklyOptimisations(
  customerId: string,
  start: string,
  end: string,
): Promise<string[]> {
  const [chanMap, changeRows] = await Promise.all([
    campaignChannelMap(customerId),
    gaqlSearch(
      customerId,
      `${CHANGE_EVENT_SELECT}
       WHERE change_event.change_date_time >= '${start} 00:00:00'
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
    const label = info?.name
      ? `${info.name} [${prettyChannel(info.channel)}]`
      : "account-level";
    counts[`${label}|||${action}`] = (counts[`${label}|||${action}`] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const [label, action] = key.split("|||");
      return label === "account-level"
        ? `${action} (${n})`
        : `${label} — ${action} (${n})`;
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
    // Device split: all channels. Interaction-date conversions (by-conversion-
    // date is incompatible with the device segment).
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
    // Top search terms are inherently Search-only (search_term_view).
    gaqlSearch(
      customerId,
      `SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions
       FROM search_term_view WHERE segments.date BETWEEN '${w.start}' AND '${w.end}'
       ORDER BY metrics.cost_micros DESC LIMIT 10`,
    ),
    buildWeekly(customerId, timeZone),
  ]);

  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

  // Trend (daily) — sum by date; prefer by-conversion-date per day.
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

  const byCampaign = Object.entries(cur.byName)
    .map(([name, v]) => ({
      name,
      channel: v.channel,
      spend: v.spend,
      conversions: v.conversions,
      costPerConv: ratio(v.spend, v.conversions),
      roas: ratio(v.convValue, v.spend),
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  const byChannel = Object.entries(cur.byChannel)
    .map(([channel, v]) => ({
      channel,
      spend: v.spend,
      conversions: v.conversions,
      convValue: v.convValue,
      costPerConv: ratio(v.spend, v.conversions),
      roas: ratio(v.convValue, v.spend),
    }))
    .sort((a, b) => b.spend - a.spend);

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
    convByConversionDate: cur.byConversionDate,
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
    byChannel,
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

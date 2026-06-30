// Audit findings — a read-only artifact pulled from the Google Ads API over the
// trailing ~12 months. Every section is independent and resilient: a failing
// query yields an empty section, never a failed audit. Pure data; the prose and
// the document are built downstream (generate.ts / docx.ts).
import { gaqlSearch } from "@/lib/integrations/google-ads";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const micros = (v: unknown) => num(v) / 1_000_000;

export type AccountType = "ecommerce" | "lead_gen";

export interface AuditFindings {
  customerId: string;
  company: string;
  currency: string;
  accountType: AccountType;
  range: { start: string; end: string };
  hasConversionValue: boolean;
  totals: {
    cost: number; impressions: number; clicks: number; conversions: number; convValue: number;
    ctr: number; avgCpc: number; cpa: number; roas: number;
  };
  months: { label: string; cost: number; clicks: number; conversions: number; convValue: number }[];
  campaigns: { name: string; channel: string; cost: number; conversions: number; convValue: number; cpa: number }[];
  network: { network: string; cost: number; clicks: number; conversions: number; convValue: number }[];
  conversionActions: { name: string; category: string; status: string; conversions: number; value: number }[];
  impressionShare: { impressionShare: number; rankLost: number; budgetLost: number };
  searchTerms: { term: string; cost: number; clicks: number; conversions: number }[];
  junkTerms: { term: string; cost: number; clicks: number }[];
  assets: string[];
}

const CHANNEL: Record<string, string> = {
  SEARCH: "Search", PERFORMANCE_MAX: "Performance Max", DEMAND_GEN: "Demand Gen", DISCOVERY: "Demand Gen",
  DISPLAY: "Display", SHOPPING: "Shopping", VIDEO: "Video", MULTI_CHANNEL: "App", LOCAL_SERVICES: "Local Services",
};
const NETWORK: Record<string, string> = {
  SEARCH: "Google Search", SEARCH_PARTNERS: "Search Partners", CONTENT: "Display Network",
  YOUTUBE_SEARCH: "YouTube Search", YOUTUBE_WATCH: "YouTube", MIXED: "Cross-network",
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`Audit section "${label}" failed:`, e);
    return fallback;
  }
}

export async function extractFindings(customerId: string, company: string): Promise<AuditFindings> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 12);
  const range = { start: ymd(start), end: ymd(end) };
  const between = `segments.date BETWEEN '${range.start}' AND '${range.end}'`;
  const ACTIVE = "campaign.status != 'REMOVED'";

  const currency = await safe(
    "currency",
    async () => {
      const rows = await gaqlSearch(customerId, "SELECT customer.currency_code FROM customer LIMIT 1");
      return ((rows[0]?.customer ?? {}) as { currencyCode?: string }).currencyCode ?? "USD";
    },
    "USD",
  );

  // Totals + monthly trend (one query).
  const monthly = await safe(
    "months",
    async () => {
      const rows = await gaqlSearch(
        customerId,
        `SELECT segments.month, metrics.cost_micros, metrics.impressions, metrics.clicks,
                metrics.conversions, metrics.conversions_value
         FROM campaign WHERE ${between} AND ${ACTIVE} ORDER BY segments.month`,
      );
      const byMonth = new Map<string, { cost: number; clicks: number; conversions: number; convValue: number }>();
      const tot = { cost: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 };
      for (const r of rows) {
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        const month = String(((r.segments ?? {}) as { month?: string }).month ?? "").slice(0, 7);
        const cost = micros(m.costMicros);
        tot.cost += cost; tot.impressions += num(m.impressions); tot.clicks += num(m.clicks);
        tot.conversions += num(m.conversions); tot.convValue += num(m.conversionsValue);
        const e = byMonth.get(month) ?? { cost: 0, clicks: 0, conversions: 0, convValue: 0 };
        e.cost += cost; e.clicks += num(m.clicks); e.conversions += num(m.conversions); e.convValue += num(m.conversionsValue);
        byMonth.set(month, e);
      }
      const months = [...byMonth.entries()].map(([month, v]) => ({
        label: new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { timeZone: "UTC", month: "short", year: "numeric" }),
        ...v,
      }));
      return { tot, months };
    },
    { tot: { cost: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 }, months: [] },
  );

  const t = monthly.tot;
  const totals = {
    ...t,
    ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
    avgCpc: t.clicks > 0 ? t.cost / t.clicks : 0,
    cpa: t.conversions > 0 ? t.cost / t.conversions : 0,
    roas: t.cost > 0 ? t.convValue / t.cost : 0,
  };

  const campaigns = await safe(
    "campaigns",
    async () => {
      const rows = await gaqlSearch(
        customerId,
        `SELECT campaign.name, campaign.advertising_channel_type, metrics.cost_micros,
                metrics.conversions, metrics.conversions_value
         FROM campaign WHERE ${between} AND ${ACTIVE}`,
      );
      const by = new Map<string, { name: string; channel: string; cost: number; conversions: number; convValue: number }>();
      for (const r of rows) {
        const c = (r.campaign ?? {}) as { name?: string; advertisingChannelType?: string };
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        const name = c.name ?? "(unnamed)";
        const e = by.get(name) ?? { name, channel: CHANNEL[c.advertisingChannelType ?? ""] ?? c.advertisingChannelType ?? "Other", cost: 0, conversions: 0, convValue: 0 };
        e.cost += micros(m.costMicros); e.conversions += num(m.conversions); e.convValue += num(m.conversionsValue);
        by.set(name, e);
      }
      return [...by.values()]
        .map((e) => ({ ...e, cpa: e.conversions > 0 ? e.cost / e.conversions : 0 }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 15);
    },
    [],
  );

  const network = await safe(
    "network",
    async () => {
      const rows = await gaqlSearch(
        customerId,
        `SELECT segments.ad_network_type, metrics.cost_micros, metrics.clicks,
                metrics.conversions, metrics.conversions_value
         FROM campaign WHERE ${between} AND ${ACTIVE}`,
      );
      const by = new Map<string, { network: string; cost: number; clicks: number; conversions: number; convValue: number }>();
      for (const r of rows) {
        const nt = String(((r.segments ?? {}) as { adNetworkType?: string }).adNetworkType ?? "MIXED");
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        const e = by.get(nt) ?? { network: NETWORK[nt] ?? nt, cost: 0, clicks: 0, conversions: 0, convValue: 0 };
        e.cost += micros(m.costMicros); e.clicks += num(m.clicks); e.conversions += num(m.conversions); e.convValue += num(m.conversionsValue);
        by.set(nt, e);
      }
      return [...by.values()].sort((a, b) => b.cost - a.cost);
    },
    [],
  );

  const conversionActions = await safe(
    "conversionActions",
    async () => {
      const [cfg, perf] = await Promise.all([
        gaqlSearch(customerId, "SELECT conversion_action.name, conversion_action.category, conversion_action.status FROM conversion_action"),
        gaqlSearch(customerId, `SELECT segments.conversion_action_name, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${between} AND ${ACTIVE}`),
      ]);
      const perfBy = new Map<string, { conversions: number; value: number }>();
      for (const r of perf) {
        const name = String(((r.segments ?? {}) as { conversionActionName?: string }).conversionActionName ?? "");
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        const e = perfBy.get(name) ?? { conversions: 0, value: 0 };
        e.conversions += num(m.conversions); e.value += num(m.conversionsValue);
        perfBy.set(name, e);
      }
      return cfg.map((r) => {
        const a = (r.conversionAction ?? {}) as { name?: string; category?: string; status?: string };
        const p = perfBy.get(a.name ?? "") ?? { conversions: 0, value: 0 };
        return { name: a.name ?? "", category: a.category ?? "", status: a.status ?? "", conversions: p.conversions, value: p.value };
      }).sort((x, y) => y.conversions - x.conversions);
    },
    [],
  );

  const impressionShare = await safe(
    "impressionShare",
    async () => {
      const rows = await gaqlSearch(
        customerId,
        `SELECT metrics.impressions, metrics.search_impression_share,
                metrics.search_rank_lost_impression_share, metrics.search_budget_lost_impression_share
         FROM campaign WHERE ${between} AND campaign.advertising_channel_type = 'SEARCH' AND ${ACTIVE}`,
      );
      let denom = 0; const w = { is: 0, rank: 0, budget: 0 };
      for (const r of rows) {
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        if (m.searchImpressionShare == null) continue;
        const im = num(m.impressions); denom += im;
        w.is += num(m.searchImpressionShare) * im;
        w.rank += num(m.searchRankLostImpressionShare) * im;
        w.budget += num(m.searchBudgetLostImpressionShare) * im;
      }
      const pct = (x: number) => (denom > 0 ? (x / denom) * 100 : 0);
      return { impressionShare: pct(w.is), rankLost: pct(w.rank), budgetLost: pct(w.budget) };
    },
    { impressionShare: 0, rankLost: 0, budgetLost: 0 },
  );

  const searchData = await safe(
    "searchTerms",
    async () => {
      const rows = await gaqlSearch(
        customerId,
        `SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions
         FROM search_term_view WHERE ${between} ORDER BY metrics.cost_micros DESC LIMIT 60`,
      );
      const terms = rows.map((r) => {
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        return {
          term: String(((r.searchTermView ?? {}) as { searchTerm?: string }).searchTerm ?? ""),
          cost: micros(m.costMicros), clicks: num(m.clicks), conversions: num(m.conversions),
        };
      });
      return {
        searchTerms: terms.slice(0, 20),
        junkTerms: terms.filter((x) => x.conversions === 0 && x.cost > 0).slice(0, 15).map(({ term, cost, clicks }) => ({ term, cost, clicks })),
      };
    },
    { searchTerms: [], junkTerms: [] },
  );

  const assets = await safe(
    "assets",
    async () => {
      const rows = await gaqlSearch(customerId, "SELECT asset_field_type_view.field_type FROM asset_field_type_view");
      return [...new Set(rows.map((r) => String(((r.assetFieldTypeView ?? {}) as { fieldType?: string }).fieldType ?? "")).filter(Boolean))];
    },
    [],
  );

  const hasConversionValue = totals.convValue > 0;
  // Account-type detection (handover A4): ecommerce if a purchase-category action
  // exists, or value is tracked with ROAS >= 1; else lead-gen.
  const hasPurchase = conversionActions.some((a) => /PURCHASE|ECOMMERCE|SALE/i.test(a.category));
  const accountType: AccountType = hasPurchase || (hasConversionValue && totals.roas >= 1) ? "ecommerce" : "lead_gen";

  return {
    customerId, company, currency, accountType, range, hasConversionValue,
    totals, months: monthly.months, campaigns, network, conversionActions,
    impressionShare, searchTerms: searchData.searchTerms, junkTerms: searchData.junkTerms, assets,
  };
}

// Google Shopping / feed audit — the data layer. Built on the Google Ads API we
// already have (adwords scope): product-level performance from
// shopping_performance_view + the Shopping/PMax channel split. It answers "which
// products are working / wasting / dead weight", NOT Merchant Center feed HEALTH
// (disapprovals, item errors) — that needs the Content API (see merchantCenter
// seam below), which requires the `content` OAuth scope.
import { gaqlSearch } from "@/lib/integrations/google-ads";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const micros = (v: unknown) => num(v) / 1_000_000;
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

export interface FeedProduct {
  itemId: string;
  title: string;
  brand: string;
  type: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  convValue: number;
  roas: number;
}
export interface FeedGroup {
  label: string;
  spend: number;
  conversions: number;
  convValue: number;
  roas: number;
}
export interface FeedDiagnosis {
  severity: "critical" | "high" | "medium" | "low";
  pattern: string;
  evidence: string;
  fix: string;
}

// Placeholder for the later Content/Merchant API layer (item disapprovals, policy
// errors, missing attributes). Null until the `content` scope is provisioned.
export interface MerchantCenterHealth {
  merchantId: string;
  totalItems: number;
  disapproved: number;
  warnings: number;
  topIssues: { code: string; description: string; count: number }[];
}

export interface FeedAudit {
  currency: string;
  window: { start: string; end: string; days: number };
  hasShopping: boolean;
  totals: {
    products: number;
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
    convValue: number;
    roas: number;
    nonConvertingSpend: number;
    nonConvertingSpendPct: number;
    zeroClickProducts: number;
    missingBrand: number;
  };
  channelSplit: FeedGroup[];
  topProducts: FeedProduct[];
  wastedProducts: FeedProduct[]; // cost > 0, conversions 0 (by cost desc)
  spendConcentrationTop10Pct: number; // share of spend in the top 10% of products
  byBrand: FeedGroup[];
  byType: FeedGroup[];
  diagnoses: FeedDiagnosis[];
  merchantCenter: MerchantCenterHealth | null; // seam — populated once Content API is wired
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getFeedAudit(customerId: string, days = 30): Promise<FeedAudit> {
  const span = Math.min(180, Math.max(7, Math.round(days)));
  const end = new Date(Date.now() - 86_400_000); // exclude today
  const start = new Date(end.getTime() - (span - 1) * 86_400_000);
  const window = { start: ymd(start), end: ymd(end), days: span };
  const dateWhere = `segments.date BETWEEN '${window.start}' AND '${window.end}'`;

  const metaRows = await gaqlSearch(customerId, "SELECT customer.currency_code FROM customer LIMIT 1");
  const currency = ((metaRows[0]?.customer ?? {}) as { currencyCode?: string }).currencyCode ?? "USD";

  // Channel split across the retail channels (Shopping + Performance Max).
  const campRows = await gaqlSearch(
    customerId,
    `SELECT campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM campaign
     WHERE ${dateWhere} AND campaign.status != 'REMOVED'
       AND campaign.advertising_channel_type IN ('SHOPPING', 'PERFORMANCE_MAX')`,
  );
  const chan: Record<string, { spend: number; conversions: number; convValue: number }> = {};
  for (const r of campRows) {
    const t = String(((r.campaign ?? {}) as { advertisingChannelType?: string }).advertisingChannelType ?? "");
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    chan[t] ??= { spend: 0, conversions: 0, convValue: 0 };
    chan[t].spend += micros(m.costMicros);
    chan[t].conversions += num(m.conversions);
    chan[t].convValue += num(m.conversionsValue);
  }
  const CHAN_LABEL: Record<string, string> = { SHOPPING: "Shopping", PERFORMANCE_MAX: "Performance Max" };
  const channelSplit: FeedGroup[] = Object.entries(chan)
    .map(([k, v]) => ({ label: CHAN_LABEL[k] ?? k, spend: v.spend, conversions: v.conversions, convValue: v.convValue, roas: ratio(v.convValue, v.spend) }))
    .sort((a, b) => b.spend - a.spend);

  // Product-level performance (Shopping; PMax retail increasingly included).
  const prodRows = await gaqlSearch(
    customerId,
    `SELECT segments.product_item_id, segments.product_title, segments.product_brand, segments.product_type_l1,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM shopping_performance_view
     WHERE ${dateWhere}
     ORDER BY metrics.cost_micros DESC
     LIMIT 5000`,
  );

  const prodMap: Record<string, FeedProduct> = {};
  for (const r of prodRows) {
    const s = (r.segments ?? {}) as { productItemId?: string; productTitle?: string; productBrand?: string; productTypeL1?: string };
    const itemId = s.productItemId ?? "";
    if (!itemId) continue;
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    prodMap[itemId] ??= { itemId, title: s.productTitle ?? "", brand: s.productBrand ?? "", type: s.productTypeL1 ?? "", impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0, roas: 0 };
    const p = prodMap[itemId];
    p.impressions += num(m.impressions);
    p.clicks += num(m.clicks);
    p.cost += micros(m.costMicros);
    p.conversions += num(m.conversions);
    p.convValue += num(m.conversionsValue);
    if (!p.title && s.productTitle) p.title = s.productTitle;
    if (!p.brand && s.productBrand) p.brand = s.productBrand;
    if (!p.type && s.productTypeL1) p.type = s.productTypeL1;
  }
  const products = Object.values(prodMap).map((p) => ({ ...p, roas: ratio(p.convValue, p.cost) }));
  const hasShopping = products.length > 0 || channelSplit.length > 0;

  const totalSpend = products.reduce((s, p) => s + p.cost, 0);
  const totalConv = products.reduce((s, p) => s + p.conversions, 0);
  const totalValue = products.reduce((s, p) => s + p.convValue, 0);
  const totalImpr = products.reduce((s, p) => s + p.impressions, 0);
  const totalClicks = products.reduce((s, p) => s + p.clicks, 0);
  const nonConverting = products.filter((p) => p.conversions === 0);
  const nonConvertingSpend = nonConverting.reduce((s, p) => s + p.cost, 0);
  const zeroClickProducts = products.filter((p) => p.impressions > 0 && p.clicks === 0).length;
  const missingBrand = products.filter((p) => !p.brand).length;

  // Spend concentration: share of spend held by the top 10% of products by cost.
  const byCost = [...products].sort((a, b) => b.cost - a.cost);
  const top10Count = Math.max(1, Math.ceil(byCost.length * 0.1));
  const top10Spend = byCost.slice(0, top10Count).reduce((s, p) => s + p.cost, 0);
  const spendConcentrationTop10Pct = totalSpend > 0 ? (top10Spend / totalSpend) * 100 : 0;

  const groupBy = (key: (p: FeedProduct) => string): FeedGroup[] => {
    const g: Record<string, { spend: number; conversions: number; convValue: number }> = {};
    for (const p of products) {
      const label = key(p) || "(unlabelled)";
      g[label] ??= { spend: 0, conversions: 0, convValue: 0 };
      g[label].spend += p.cost;
      g[label].conversions += p.conversions;
      g[label].convValue += p.convValue;
    }
    return Object.entries(g)
      .map(([label, v]) => ({ label, spend: v.spend, conversions: v.conversions, convValue: v.convValue, roas: ratio(v.convValue, v.spend) }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 12);
  };

  const totals = {
    products: products.length,
    impressions: totalImpr,
    clicks: totalClicks,
    spend: totalSpend,
    conversions: totalConv,
    convValue: totalValue,
    roas: ratio(totalValue, totalSpend),
    nonConvertingSpend,
    nonConvertingSpendPct: totalSpend > 0 ? (nonConvertingSpend / totalSpend) * 100 : 0,
    zeroClickProducts,
    missingBrand,
  };

  return {
    currency,
    window,
    hasShopping,
    totals,
    channelSplit,
    topProducts: [...products].sort((a, b) => b.convValue - a.convValue || b.conversions - a.conversions).slice(0, 15),
    wastedProducts: nonConverting.filter((p) => p.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 20),
    spendConcentrationTop10Pct,
    byBrand: groupBy((p) => p.brand),
    byType: groupBy((p) => p.type),
    diagnoses: diagnoseFeed(totals, spendConcentrationTop10Pct, channelSplit, products),
    merchantCenter: null,
  };
}

function diagnoseFeed(
  totals: FeedAudit["totals"],
  concentration: number,
  channelSplit: FeedGroup[],
  products: FeedProduct[],
): FeedDiagnosis[] {
  const d: FeedDiagnosis[] = [];
  const money = (n: number) => Math.round(n).toLocaleString();

  if (totals.nonConvertingSpendPct >= 40) {
    d.push({
      severity: "high",
      pattern: "non-converting-spend",
      evidence: `${totals.nonConvertingSpendPct.toFixed(0)}% of feed spend (${money(totals.nonConvertingSpend)}) went to products with zero conversions.`,
      fix: "Segment converting vs non-converting products (custom labels / listing groups); cap or exclude persistent zero-converters and reallocate to proven winners.",
    });
  }
  if (concentration >= 80 && totals.products >= 20) {
    d.push({
      severity: "medium",
      pattern: "spend-concentration",
      evidence: `The top 10% of products carry ${concentration.toFixed(0)}% of feed spend — a long tail of products barely serves.`,
      fix: "Split the catalogue by performance tier so bidding can push the tail and protect the head; check the tail for feed/price/title issues suppressing it.",
    });
  }
  if (totals.roas > 0 && totals.roas < 1 && totals.convValue > 0) {
    d.push({
      severity: "critical",
      pattern: "unprofitable-feed",
      evidence: `Feed ROAS is ${totals.roas.toFixed(2)}x — the catalogue is losing money at current bids.`,
      fix: "Move to value/ROAS-based bidding, exclude loss-making products, and fix pricing/margin signals before scaling.",
    });
  }
  if (totals.zeroClickProducts >= Math.max(10, totals.products * 0.2)) {
    d.push({
      severity: "medium",
      pattern: "zero-click-products",
      evidence: `${totals.zeroClickProducts} products got impressions but zero clicks — a title/image/price relevance signal.`,
      fix: "Improve titles (brand + key attributes first), primary images and price competitiveness; these products are shown but ignored.",
    });
  }
  if (totals.missingBrand >= Math.max(5, totals.products * 0.1)) {
    d.push({
      severity: "medium",
      pattern: "missing-brand",
      evidence: `${totals.missingBrand} products have no brand attribute in the feed.`,
      fix: "Populate the brand attribute in Merchant Center — it drives matching, brand exclusions and reporting.",
    });
  }
  const pmax = channelSplit.find((c) => c.label === "Performance Max");
  const shopping = channelSplit.find((c) => c.label === "Shopping");
  if (pmax && !shopping && pmax.spend > 0) {
    d.push({
      severity: "low",
      pattern: "pmax-only-visibility",
      evidence: `All retail spend is in Performance Max (${money(pmax.spend)}) — product-level control and search-term visibility are limited.`,
      fix: "Consider a standard Shopping campaign (or PMax + Shopping) for the highest-value products to regain query and product-level control.",
    });
  }
  const noData = products.length === 0;
  if (noData) {
    d.push({
      severity: "low",
      pattern: "no-product-data",
      evidence: "No product-level performance rows returned — the account may run PMax without exposed product data, or has no active Shopping.",
      fix: "Confirm Merchant Center is linked and products are approved; a Content API (feed health) check is the next step once the content scope is enabled.",
    });
  }
  return d;
}

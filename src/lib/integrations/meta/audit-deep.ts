// Deep read for the Meta audit. Everything the finding detectors need that
// getMetaAuditData does not carry: placement / age / country breakdowns, the
// full funnel, the audience library, exclusion coverage, ad-level performance
// and creative variation. All reads are read-only Graph calls.
//
// Anything that fails is returned as { error }. Detectors must skip a section
// that errored rather than treat it as an absence: a permission error on one
// edge is not evidence that the thing is missing.
import { metaGraphGet, metaRows, metaGraphAll, normalizeActId } from "@/lib/integrations/meta";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0) || 0;

const INSIGHT_FIELDS = [
  "spend", "impressions", "reach", "frequency", "clicks", "inline_link_clicks",
  "ctr", "inline_link_click_ctr", "cpm", "actions", "action_values",
  "video_play_actions", "video_p100_watched_actions", "video_thruplay_watched_actions",
].join(",");

export interface Row { [k: string]: unknown }
export type Maybe<T> = T | { error: string };
export const isErr = <T,>(v: Maybe<T>): v is { error: string } =>
  !!v && typeof v === "object" && "error" in (v as object);

/** Sum an action_type out of an insights row, preferring the omni_ variant. */
export function action(r: Row, ...types: string[]): number {
  const list = (r.actions as { action_type?: string; value?: unknown }[] | undefined) ?? [];
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}
export function actionValue(r: Row, ...types: string[]): number {
  const list = (r.action_values as { action_type?: string; value?: unknown }[] | undefined) ?? [];
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}
const videoMetric = (r: Row, field: string): number => {
  const list = (r[field] as { action_type?: string; value?: unknown }[] | undefined) ?? [];
  return num(list.find((a) => a.action_type === "video_view")?.value);
};

export interface FunnelTotals {
  spend: number; impressions: number; reach: number; frequency: number;
  clicks: number; linkClicks: number; linkCtr: number; cpm: number;
  landingPageViews: number; viewContent: number; addToCart: number;
  checkouts: number; purchases: number; revenue: number;
  roas: number; aov: number; cpa: number;
  videoPlays: number; videoComplete: number; thruplay: number;
}
function totals(r: Row | undefined): FunnelTotals | null {
  if (!r) return null;
  const spend = num(r.spend), impressions = num(r.impressions);
  const purchases = action(r, "omni_purchase", "purchase");
  const revenue = actionValue(r, "omni_purchase", "purchase");
  return {
    spend, impressions, reach: num(r.reach), frequency: num(r.frequency),
    clicks: num(r.clicks), linkClicks: num(r.inline_link_clicks),
    linkCtr: num(r.inline_link_click_ctr), cpm: impressions ? (spend / impressions) * 1000 : 0,
    landingPageViews: action(r, "landing_page_view"),
    viewContent: action(r, "omni_view_content", "view_content"),
    addToCart: action(r, "omni_add_to_cart", "add_to_cart"),
    checkouts: action(r, "omni_initiated_checkout", "initiate_checkout"),
    purchases, revenue,
    roas: spend ? revenue / spend : 0,
    aov: purchases ? revenue / purchases : 0,
    cpa: purchases ? spend / purchases : 0,
    videoPlays: videoMetric(r, "video_play_actions"),
    videoComplete: videoMetric(r, "video_p100_watched_actions"),
    thruplay: videoMetric(r, "video_thruplay_watched_actions"),
  };
}

export interface Segment { key: string; spend: number; impressions: number; linkClicks: number; purchases: number; revenue: number; roas: number }
function segments(rs: Row[], keyOf: (r: Row) => string): Segment[] {
  const m = new Map<string, Segment>();
  for (const r of rs) {
    const key = keyOf(r);
    const s = m.get(key) ?? { key, spend: 0, impressions: 0, linkClicks: 0, purchases: 0, revenue: 0, roas: 0 };
    s.spend += num(r.spend); s.impressions += num(r.impressions); s.linkClicks += num(r.inline_link_clicks);
    s.purchases += action(r, "omni_purchase", "purchase");
    s.revenue += actionValue(r, "omni_purchase", "purchase");
    m.set(key, s);
  }
  return [...m.values()].map((s) => ({ ...s, roas: s.spend ? s.revenue / s.spend : 0 })).sort((a, b) => b.spend - a.spend);
}

export interface AdRow { id: string; name: string; campaign: string; spend: number; purchases: number; revenue: number; roas: number; frequency: number; linkCtr: number }
export interface AdSetRow {
  id: string; name: string; campaignId: string; campaignName: string; campaignObjective: string;
  optimizationGoal: string; bidStrategy: string; learning: string | null;
  includedAudiences: string[]; excludedAudiences: string[]; interestCount: number;
  ageMin: number | null; ageMax: number | null; countries: string[];
  manualPlacements: boolean; platforms: string[];
}
export interface AudienceRow { id: string; name: string; subtype: string; retentionDays: number | null; ready: boolean }
export interface CreativeStats {
  activeAds: number; noVariation: number; bodyCounts: Record<string, number>;
  headlineCounts: Record<string, number>; unevenLength: number; ctaMissing: number; maxSpread: number;
}

export interface DeepAudit {
  accountId: string;
  currency: string;
  primaryCountry: string | null;
  window: { since: string; until: string; days: number };
  current: FunnelTotals | null;
  monthly: Maybe<{ month: string; spend: number; purchases: number; revenue: number; roas: number; linkCtr: number; frequency: number }[]>;
  byPlacement: Maybe<Segment[]>;
  byAge: Maybe<Segment[]>;
  byCountry: Maybe<Segment[]>;
  byCampaign: Maybe<Segment[]>;
  campaignFrequency: Maybe<{ key: string; frequency: number; spend: number; purchases: number }[]>;
  adSets: Maybe<AdSetRow[]>;
  ads: Maybe<AdRow[]>;
  audiences: Maybe<AudienceRow[]>;
  creative: Maybe<CreativeStats>;
  pixels: Maybe<{ id: string; name: string; lastFired: string | null; advancedMatching: boolean | null; fields: string[] }[]>;
  counts: { campaigns: number; campaignsActive: number; adSets: number; adSetsActive: number; ads: number; adsActive: number };
}

export async function getDeepAuditData(accountRef: string, days = 30): Promise<DeepAudit> {
  const { act, digits } = normalizeActId(accountRef);
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const range = JSON.stringify({ since: ymd(start), until: ymd(end) });
  // Breakdowns need a longer window than the headline period to carry enough
  // purchases to be readable at segment level.
  const longStart = new Date(end.getTime() - 89 * 86_400_000);
  const longRange = JSON.stringify({ since: ymd(longStart), until: ymd(end) });
  const yearStart = new Date(end.getTime() - 364 * 86_400_000);

  const wrap = async <T,>(p: Promise<{ rows: Row[]; error?: string }>, map: (r: Row[]) => T): Promise<Maybe<T>> => {
    const r = await p;
    if (r.error && !r.rows.length) return { error: r.error };
    return map(r.rows);
  };
  const ins = (params: Record<string, string>) => metaGraphAll(`${act}/insights`, { fields: INSIGHT_FIELDS, ...params }, 3000);

  const [
    accountRes, curRes, monthlyRes, placementRes, ageRes, countryRes, campRes,
    campaignsRes, adSetsRes, adsRes, adPerfRes, audRes, pixelRes,
  ] = await Promise.all([
    metaGraphGet(act, { fields: "name,currency,business_country_code" }),
    ins({ time_range: range }),
    ins({ time_range: JSON.stringify({ since: ymd(yearStart), until: ymd(end) }), time_increment: "monthly" }),
    ins({ time_range: longRange, breakdowns: "publisher_platform,platform_position" }),
    ins({ time_range: longRange, breakdowns: "age" }),
    ins({ time_range: longRange, breakdowns: "country" }),
    ins({ time_range: range, level: "campaign", fields: `campaign_name,${INSIGHT_FIELDS}` }),
    metaGraphAll(`${act}/campaigns`, { fields: "id,name,effective_status,objective" }, 400),
    metaGraphAll(`${act}/adsets`, {
      fields: "id,name,campaign_id,effective_status,optimization_goal,bid_strategy,learning_stage_info,targeting",
    }, 800),
    metaGraphAll(`${act}/ads`, {
      fields: "id,name,effective_status,creative{object_type,asset_feed_spec,object_story_spec}",
    }, 1500),
    ins({ time_range: longRange, level: "ad", fields: `ad_id,ad_name,campaign_name,${INSIGHT_FIELDS}` }),
    metaGraphAll(`${act}/customaudiences`, { fields: "id,name,subtype,retention_days,delivery_status", limit: "25" }, 600),
    metaGraphAll(`${act}/adspixels`, { fields: "id,name,last_fired_time,enable_automatic_matching,automatic_matching_fields" }, 20),
  ]);

  const acc = (accountRes.data ?? {}) as Row;
  const campaigns = campaignsRes.rows;
  const campById = new Map(campaigns.map((c) => [String(c.id), c]));
  const adSetRows = adSetsRes.rows;
  const adRows = adsRes.rows;
  const isActive = (r: Row) => r.effective_status === "ACTIVE";

  const audienceName = new Map<string, string>(audRes.rows.map((a) => [String(a.id), String(a.name ?? a.id)]));

  const adSets: Maybe<AdSetRow[]> = adSetsRes.error && !adSetRows.length ? { error: adSetsRes.error } :
    adSetRows.filter(isActive).map((s) => {
      const t = (s.targeting ?? {}) as Row;
      const camp = campById.get(String(s.campaign_id));
      const flex = (t.flexible_spec as { interests?: unknown[] }[] | undefined) ?? [];
      return {
        id: String(s.id), name: String(s.name ?? ""),
        campaignId: String(s.campaign_id ?? ""),
        campaignName: String(camp?.name ?? ""),
        campaignObjective: String(camp?.objective ?? ""),
        optimizationGoal: String(s.optimization_goal ?? ""),
        bidStrategy: String(s.bid_strategy ?? ""),
        learning: ((s.learning_stage_info as { status?: string } | undefined)?.status) ?? null,
        includedAudiences: ((t.custom_audiences as { id?: string }[] | undefined) ?? []).map((a) => audienceName.get(String(a.id)) ?? String(a.id)),
        excludedAudiences: ((t.excluded_custom_audiences as { id?: string }[] | undefined) ?? []).map((a) => audienceName.get(String(a.id)) ?? String(a.id)),
        interestCount: flex.reduce((n, f) => n + ((f.interests as unknown[] | undefined)?.length ?? 0), 0)
          + (((t.interests as unknown[] | undefined) ?? []).length),
        ageMin: t.age_min != null ? Number(t.age_min) : null,
        ageMax: t.age_max != null ? Number(t.age_max) : null,
        countries: ((t.geo_locations as { countries?: string[] } | undefined)?.countries) ?? [],
        manualPlacements: Array.isArray(t.publisher_platforms),
        platforms: (t.publisher_platforms as string[] | undefined) ?? [],
      };
    });

  // creative variation
  let creative: Maybe<CreativeStats>;
  if (adsRes.error && !adRows.length) creative = { error: adsRes.error };
  else {
    const active = adRows.filter(isActive);
    const bodyCounts: Record<string, number> = {}, headlineCounts: Record<string, number> = {};
    let noVariation = 0, unevenLength = 0, ctaMissing = 0, maxSpread = 0;
    for (const ad of active) {
      const c = (ad.creative ?? {}) as Row;
      const afs = c.asset_feed_spec as Row | undefined;
      const oss = (c.object_story_spec ?? {}) as Row;
      const link = (oss.link_data ?? {}) as Row, vid = (oss.video_data ?? {}) as Row;
      const bodies = (afs?.bodies as { text?: string }[] | undefined)?.map((b) => b.text ?? "")
        ?? [link.message, vid.message].filter((x): x is string => typeof x === "string");
      const titles = (afs?.titles as { text?: string }[] | undefined)?.map((t) => t.text ?? "")
        ?? [link.name, vid.title].filter((x): x is string => typeof x === "string");
      bodyCounts[String(bodies.length)] = (bodyCounts[String(bodies.length)] ?? 0) + 1;
      headlineCounts[String(titles.length)] = (headlineCounts[String(titles.length)] ?? 0) + 1;
      if (!afs) noVariation++;
      const cta = (afs?.call_to_action_types as string[] | undefined)?.[0]
        ?? (link.call_to_action as { type?: string } | undefined)?.type
        ?? (vid.call_to_action as { type?: string } | undefined)?.type;
      if (!cta) ctaMissing++;
      const lens = bodies.map((b) => b.length);
      if (lens.length > 1) {
        const spread = Math.max(...lens) - Math.min(...lens);
        if (spread > 120) unevenLength++;
        if (spread > maxSpread) maxSpread = spread;
      }
    }
    creative = { activeAds: active.length, noVariation, bodyCounts, headlineCounts, unevenLength, ctaMissing, maxSpread };
  }

  const campSegs = campRes.error && !campRes.rows.length ? { error: campRes.error } : segments(campRes.rows, (r) => String(r.campaign_name ?? "?"));

  return {
    accountId: digits,
    currency: String(acc.currency ?? ""),
    primaryCountry: (acc.business_country_code as string | undefined) ?? null,
    window: { since: ymd(start), until: ymd(end), days },
    current: totals(curRes.rows[0]),
    monthly: monthlyRes.error && !monthlyRes.rows.length ? { error: monthlyRes.error } : monthlyRes.rows.map((r) => {
      const spend = num(r.spend), revenue = actionValue(r, "omni_purchase", "purchase");
      return {
        month: String(r.date_start ?? "").slice(0, 7), spend,
        purchases: action(r, "omni_purchase", "purchase"), revenue,
        roas: spend ? revenue / spend : 0, linkCtr: num(r.inline_link_click_ctr), frequency: num(r.frequency),
      };
    }),
    byPlacement: placementRes.error && !placementRes.rows.length ? { error: placementRes.error }
      : segments(placementRes.rows, (r) => `${r.publisher_platform}/${r.platform_position}`),
    byAge: ageRes.error && !ageRes.rows.length ? { error: ageRes.error } : segments(ageRes.rows, (r) => String(r.age ?? "?")),
    byCountry: countryRes.error && !countryRes.rows.length ? { error: countryRes.error } : segments(countryRes.rows, (r) => String(r.country ?? "?")),
    byCampaign: campSegs,
    campaignFrequency: campRes.error && !campRes.rows.length ? { error: campRes.error }
      : campRes.rows.map((r) => ({
        key: String(r.campaign_name ?? "?"), frequency: num(r.frequency), spend: num(r.spend),
        purchases: action(r, "omni_purchase", "purchase"),
      })).filter((c) => c.spend > 0).sort((a, b) => b.frequency - a.frequency),
    adSets,
    ads: adPerfRes.error && !adPerfRes.rows.length ? { error: adPerfRes.error } : adPerfRes.rows.map((r) => {
      const spend = num(r.spend), revenue = actionValue(r, "omni_purchase", "purchase");
      return {
        id: String(r.ad_id ?? ""), name: String(r.ad_name ?? ""), campaign: String(r.campaign_name ?? ""),
        spend, purchases: action(r, "omni_purchase", "purchase"), revenue,
        roas: spend ? revenue / spend : 0, frequency: num(r.frequency), linkCtr: num(r.inline_link_click_ctr),
      };
    }).sort((a, b) => b.spend - a.spend),
    audiences: audRes.error && !audRes.rows.length ? { error: audRes.error } : audRes.rows.map((a) => ({
      id: String(a.id), name: String(a.name ?? ""), subtype: String(a.subtype ?? ""),
      retentionDays: a.retention_days != null ? Number(a.retention_days) : null,
      ready: (a.delivery_status as { code?: number } | undefined)?.code === 200,
    })),
    creative,
    pixels: pixelRes.error && !pixelRes.rows.length ? { error: pixelRes.error } : pixelRes.rows.map((p) => ({
      id: String(p.id), name: String(p.name ?? ""),
      lastFired: (p.last_fired_time as string | undefined) ?? null,
      advancedMatching: typeof p.enable_automatic_matching === "boolean" ? p.enable_automatic_matching : null,
      fields: (p.automatic_matching_fields as string[] | undefined) ?? [],
    })),
    counts: {
      campaigns: campaigns.length, campaignsActive: campaigns.filter(isActive).length,
      adSets: adSetRows.length, adSetsActive: adSetRows.filter(isActive).length,
      ads: adRows.length, adsActive: adRows.filter(isActive).length,
    },
  };
}

export { metaRows };

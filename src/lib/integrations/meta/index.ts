// Meta (Facebook) Ads read layer — Bernard's ground truth.
// STRICTLY READ-ONLY: every call here is a GET against the Graph API using the
// system-user token. There is no write path in this deployment, by design: the
// sibling portal's executor dispatch lives in a separate n8n estate that PPC
// Mastery deliberately does not run (founder decision 2026-08-06). Bernard reads,
// diagnoses and drafts; a human makes every Meta change.
//
// The account roster is whatever the token can see, so assigning an account to
// the system user in Business Manager puts it in reach immediately, with no
// registration step here.
//
// v23.0, not v21: Meta silently serves v21 calls on a newer version and then
// rejects fields it retired there. Reading a creative's Instagram identity on
// v21 returns "(#12) Old Instagram ID is deprecated for versions v22.0 and
// higher" because instagram_actor_id no longer exists; instagram_user_id does.
const GRAPH = "https://graph.facebook.com/v23.0";

// META_ADS_TOKEN is the canonical name (it matches the sibling portal, so briefs
// and runbooks transfer); META_ACCESS_TOKEN is accepted as an alias.
function token(): string | null {
  return process.env.META_ADS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? null;
}

export function metaConfigured(): boolean {
  return token() !== null;
}

/** "575423175548816" | "act_575..." -> "act_575..." (and bare digits variant) */
export function normalizeActId(ref: string): { act: string; digits: string } {
  const digits = ref.trim().replace(/^act_/, "");
  return { act: `act_${digits}`, digits };
}

// GET with error capture — callers get { data } or { error }, never a throw,
// so a single failed read degrades the audit instead of killing it.
async function graphGet(path: string, params: Record<string, string> = {}): Promise<{ data?: unknown; error?: string }> {
  const tk = token();
  if (!tk) return { error: "META_ADS_TOKEN is not configured on this deployment." };
  const qs = new URLSearchParams({ ...params, access_token: tk });
  try {
    const res = await fetch(`${GRAPH}/${path}?${qs}`, { cache: "no-store" });
    const json = (await res.json()) as { error?: { message?: string }; data?: unknown };
    if (!res.ok || json.error) {
      return { error: json.error?.message ?? `Graph API answered ${res.status}` };
    }
    return { data: json };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Everything under `data` (Graph list envelope), or []. */
function rows(r: { data?: unknown }): Record<string, unknown>[] {
  const d = (r.data as { data?: unknown } | undefined)?.data;
  return Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
}

// Shared with audit-deep.ts, which needs the same read-only Graph access.
export { graphGet as metaGraphGet, rows as metaRows };

/** Follow `paging.next` until exhausted or `cap` rows collected. Read-only. */
export async function metaGraphAll(
  path: string,
  params: Record<string, string> = {},
  cap = 500,
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const out: Record<string, unknown>[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await graphGet(path, { ...params, limit: params.limit ?? "100", ...(after ? { after } : {}) });
    if (r.error) return { rows: out, error: r.error };
    out.push(...rows(r));
    const paging = (r.data as { paging?: { next?: string; cursors?: { after?: string } } } | undefined)?.paging;
    after = paging?.next ? paging.cursors?.after : undefined;
    if (!after || out.length >= cap) break;
  }
  return { rows: out.slice(0, cap) };
}

export interface MetaAccount {
  accountId: string;
  name: string;
  status: number; // 1 active, 2 disabled, 3 unsettled, 101 closed…
  currency: string;
  timezone: string;
  business: string | null;
  amountSpent: number; // lifetime, account currency
}

/** Every ad account the system user can see, live from the token. */
export async function listMetaAdAccounts(): Promise<MetaAccount[] | { error: string }> {
  const r = await graphGet("me/adaccounts", {
    fields: "name,account_id,account_status,currency,timezone_name,amount_spent,business{name}",
    limit: "100",
  });
  if (r.error) return { error: r.error };
  return rows(r).map((a) => ({
    accountId: String(a.account_id ?? ""),
    name: String(a.name ?? ""),
    status: Number(a.account_status ?? 0),
    currency: String(a.currency ?? ""),
    timezone: String(a.timezone_name ?? ""),
    business: ((a.business as { name?: string } | undefined)?.name ?? null),
    amountSpent: Number(a.amount_spent ?? 0) / 100, // Graph returns minor units
  }));
}

// ---- Audit data assembly ----

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Keep only the actions that matter for an audit read.
const KEY_ACTIONS = new Set([
  "purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase",
  "lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead",
  "link_click", "landing_page_view", "initiate_checkout", "add_to_cart",
  "onsite_conversion.messaging_conversation_started_7d",
]);
function compactActions(list: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(list)) {
    for (const a of list as { action_type?: string; value?: string }[]) {
      if (a.action_type && KEY_ACTIONS.has(a.action_type)) out[a.action_type] = Number(a.value ?? 0);
    }
  }
  return out;
}

function compactInsights(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const roas = Array.isArray(row.purchase_roas)
    ? Number((row.purchase_roas as { value?: string }[])[0]?.value ?? 0)
    : null;
  return {
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    frequency: Number(Number(row.frequency ?? 0).toFixed(2)),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(Number(row.ctr ?? 0).toFixed(3)),
    cpm: Number(Number(row.cpm ?? 0).toFixed(2)),
    cpc: Number(Number(row.cpc ?? 0).toFixed(3)),
    actions: compactActions(row.actions),
    actionValues: compactActions(row.action_values),
    purchaseRoas: roas,
  };
}

// Summarise a targeting spec instead of dumping it (they run to kilobytes).
function compactTargeting(t: unknown) {
  if (!t || typeof t !== "object") return null;
  const g = t as Record<string, unknown>;
  const geo = (g.geo_locations as { countries?: string[]; cities?: unknown[] } | undefined) ?? {};
  return {
    ageRange: `${g.age_min ?? "?"}-${g.age_max ?? "?"}`,
    genders: (g.genders as number[] | undefined) ?? "all",
    countries: geo.countries ?? [],
    cities: Array.isArray(geo.cities) ? geo.cities.length : 0,
    customAudiences: Array.isArray(g.custom_audiences) ? (g.custom_audiences as unknown[]).length : 0,
    excludedCustomAudiences: Array.isArray(g.excluded_custom_audiences) ? (g.excluded_custom_audiences as unknown[]).length : 0,
    interests: Array.isArray((g.flexible_spec as unknown[] | undefined)) ? "flexible_spec set" : (Array.isArray(g.interests) ? (g.interests as unknown[]).length : 0),
    advantageAudience: g.targeting_automation ?? null,
  };
}

interface TrendPoint { date: string; spend: number; actions: Record<string, number> }
// Long windows get a weekly trend (13 buckets for 90d) instead of 90 daily
// rows — smaller payload, and weekly pacing reads better over a quarter.
function compactTrend(points: TrendPoint[], days: number): (TrendPoint & { granularity?: string })[] {
  if (days <= 45 || points.length <= 45) return points;
  const buckets: TrendPoint[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const week = points.slice(i, i + 7);
    const actions: Record<string, number> = {};
    for (const p of week) for (const [k, v] of Object.entries(p.actions)) actions[k] = (actions[k] ?? 0) + v;
    buckets.push({
      date: `${week[0].date} (week)`,
      spend: Number(week.reduce((s, p) => s + p.spend, 0).toFixed(2)),
      actions,
    });
  }
  return buckets;
}

/**
 * Full read-only audit dataset for one account over `days` (vs the prior
 * window). Every section is best-effort: a failed read appears as
 * `{ error: ... }` in place, never a throw.
 */
export async function getMetaAuditData(accountRef: string, days = 30) {
  const { act, digits } = normalizeActId(accountRef);
  const now = new Date(Date.now() - 86_400_000); // exclude today (partial day)
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  const cur = JSON.stringify({ since: ymd(start), until: ymd(now) });
  const prev = JSON.stringify({ since: ymd(prevStart), until: ymd(prevEnd) });

  const INSIGHT_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,actions,action_values,purchase_roas";

  const adsetFields =
    "id,name,status,effective_status,campaign_id,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,targeting,promoted_object,created_time,updated_time";

  const [account, campaigns, adsetsFull, ads, insightsCur, insightsPrev, byCampaign, daily, pixels] =
    await Promise.all([
      graphGet(act, { fields: "name,account_id,account_status,currency,timezone_name,amount_spent,spend_cap,created_time,business{id,name}" }),
      graphGet(`${act}/campaigns`, { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,buying_type,created_time,updated_time,start_time,stop_time", limit: "100" }),
      graphGet(`${act}/adsets`, { fields: `${adsetFields},learning_stage_info`, limit: "100" }),
      graphGet(`${act}/ads`, { fields: "id,name,status,effective_status,adset_id,created_time", limit: "200" }),
      graphGet(`${act}/insights`, { fields: INSIGHT_FIELDS, time_range: cur }),
      graphGet(`${act}/insights`, { fields: INSIGHT_FIELDS, time_range: prev }),
      graphGet(`${act}/insights`, { level: "campaign", fields: `campaign_name,${INSIGHT_FIELDS}`, time_range: cur, limit: "50" }),
      graphGet(`${act}/insights`, { fields: "spend,actions", time_range: cur, time_increment: "1", limit: String(days + 2) }),
      graphGet(`${act}/adspixels`, { fields: "id,name,last_fired_time" }),
    ]);

  // learning_stage_info isn't available on every account — retry without it.
  const adsets = adsetsFull.error
    ? await graphGet(`${act}/adsets`, { fields: adsetFields, limit: "100" })
    : adsetsFull;

  const acc = (account.data ?? {}) as Record<string, unknown>;
  const money = (v: unknown) => (v == null ? null : Number(v) / 100);

  return {
    accountId: digits,
    window: { current: { since: ymd(start), until: ymd(now) }, previous: { since: ymd(prevStart), until: ymd(prevEnd) } },
    account: account.error ? { error: account.error } : {
      name: acc.name, status: acc.account_status, currency: acc.currency, timezone: acc.timezone_name,
      lifetimeSpend: money(acc.amount_spent), spendCap: money(acc.spend_cap),
      business: (acc.business as { name?: string } | undefined)?.name ?? null,
      created: acc.created_time,
    },
    performance: {
      current: insightsCur.error ? { error: insightsCur.error } : compactInsights(rows(insightsCur)[0]),
      previous: insightsPrev.error ? { error: insightsPrev.error } : compactInsights(rows(insightsPrev)[0]),
    },
    campaigns: campaigns.error ? { error: campaigns.error } : rows(campaigns).map((c) => ({
      id: c.id, name: c.name, status: c.status, effectiveStatus: c.effective_status,
      objective: c.objective, buyingType: c.buying_type, bidStrategy: c.bid_strategy,
      dailyBudget: money(c.daily_budget), lifetimeBudget: money(c.lifetime_budget),
      created: c.created_time, updated: c.updated_time, start: c.start_time, stop: c.stop_time,
    })),
    campaignPerformance: byCampaign.error ? { error: byCampaign.error } : rows(byCampaign).map((r) => ({
      campaign: r.campaign_name, ...compactInsights(r),
    })),
    adsets: adsets.error ? { error: adsets.error } : rows(adsets).slice(0, 60).map((s) => ({
      id: s.id, name: s.name, status: s.status, effectiveStatus: s.effective_status, campaignId: s.campaign_id,
      optimizationGoal: s.optimization_goal, billingEvent: s.billing_event, bidStrategy: s.bid_strategy,
      dailyBudget: money(s.daily_budget), lifetimeBudget: money(s.lifetime_budget),
      learning: (s.learning_stage_info as { status?: string } | undefined)?.status ?? null,
      targeting: compactTargeting(s.targeting),
      promotedObject: s.promoted_object ?? null,
      created: s.created_time, updated: s.updated_time,
    })),
    ads: ads.error ? { error: ads.error } : {
      total: rows(ads).length,
      byStatus: rows(ads).reduce<Record<string, number>>((m, a) => {
        const k = String(a.effective_status ?? a.status ?? "UNKNOWN");
        m[k] = (m[k] ?? 0) + 1;
        return m;
      }, {}),
      sample: rows(ads).slice(0, 25).map((a) => ({ name: a.name, effectiveStatus: a.effective_status, created: a.created_time })),
    },
    dailyTrend: daily.error ? { error: daily.error } : compactTrend(
      rows(daily).map((d) => ({
        date: String(d.date_start ?? ""), spend: Number(d.spend ?? 0), actions: compactActions(d.actions),
      })),
      days,
    ),
    pixels: pixels.error ? { error: pixels.error } : rows(pixels).map((p) => ({
      id: p.id, name: p.name, lastFired: p.last_fired_time,
    })),
    note: "All figures read live from the ad account (read-only). Budgets/spend in account currency major units. 'learning' is the ad set learning phase where exposed.",
  };
}

// ---- Copy, audience and diagnostic reads ------------------------------------
// Bernard could see performance but not words. On the sibling portal that blind
// spot let a "Save up to 72%" headline, which an audit had pledged to retire,
// survive into a live ad, and left every em dash in the account unread.
// Everything below is a GET; the read-only ruling is unchanged.

const EM_DASH = /[—–‒―]/;
const DISCOUNT_CLAIM = /save up to|\d+\s?%\s?off|% off|save \$?\d|discount|\bsale\b|clearance|voucher|promo code/i;

/** One named piece of ad text plus whatever is wrong with it. */
export interface CopyField {
  where: string; // "title[1]", "body[3]", "description[1]", "link.headline"
  text: string;
  emDash: boolean;
  discountClaim: boolean;
}

export interface AdCopyRow {
  adId: string;
  adName: string;
  status: string; // effective_status
  adsetId: string;
  campaignId: string;
  creativeId: string;
  instagramUserId: string | null;
  pageId: string | null;
  identityOk: boolean; // an Instagram identity is attached at all
  fields: CopyField[];
}

function collectCopy(c: Record<string, unknown>): CopyField[] {
  const out: CopyField[] = [];
  const push = (where: string, text: unknown) => {
    const s = typeof text === "string" ? text.trim() : "";
    if (!s) return;
    out.push({ where, text: s, emDash: EM_DASH.test(s), discountClaim: DISCOUNT_CLAIM.test(s) });
  };
  const afs = (c.asset_feed_spec ?? {}) as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(afs[k]) ? (afs[k] as { text?: unknown }[]) : []);
  list("titles").forEach((t, i) => push(`title[${i + 1}]`, t.text));
  list("bodies").forEach((t, i) => push(`body[${i + 1}]`, t.text));
  list("descriptions").forEach((t, i) => push(`description[${i + 1}]`, t.text));
  push("title", c.title);
  push("body", c.body);
  const ld = ((c.object_story_spec ?? {}) as Record<string, unknown>).link_data as Record<string, unknown> | undefined;
  if (ld) {
    push("link.headline", ld.name);
    push("link.primary_text", ld.message);
    push("link.description", ld.description);
  }
  return out;
}

/**
 * Every ad's actual words, with the creative's Instagram identity and
 * deterministic style/claim flags. Defaults to what is serving, because that
 * is what can embarrass the client today; pass status "all" to sweep the
 * paused pool before duplicating anything out of it.
 */
export async function readAdCopy(
  accountRef: string,
  opts: { status?: "active" | "all"; limit?: number } = {},
): Promise<
  | {
      ads: AdCopyRow[];
      emDashCount: number;
      discountClaimCount: number;
      scanned: number;
      truncated: boolean;
      note: string;
    }
  | { error: string }
> {
  const { act } = normalizeActId(accountRef);
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 200);
  const wantActive = (opts.status ?? "active") === "active";
  const params: Record<string, string> = {
    fields:
      "id,name,effective_status,adset_id,campaign_id," +
      "creative{id,title,body,asset_feed_spec,object_story_spec,instagram_user_id}",
    limit: String(limit),
  };
  // Filter server-side. Filtering a truncated page client-side silently drops
  // ads: this account has 78 ads, so a 50-row page hid the paused retargeting
  // pair entirely and would have reported them as absent.
  if (wantActive) {
    params.effective_status = JSON.stringify(["ACTIVE", "PENDING_REVIEW", "IN_PROCESS"]);
  }
  const r = await graphGet(`${act}/ads`, params);
  if (r.error) return { error: r.error };

  const ads: AdCopyRow[] = [];
  const raw = rows(r);
  for (const a of raw) {
    const status = String(a.effective_status ?? "");
    const c = (a.creative ?? {}) as Record<string, unknown>;
    const oss = (c.object_story_spec ?? {}) as Record<string, unknown>;
    const ig = (c.instagram_user_id ?? oss.instagram_user_id ?? null) as string | null;
    ads.push({
      adId: String(a.id ?? ""),
      adName: String(a.name ?? ""),
      status,
      adsetId: String(a.adset_id ?? ""),
      campaignId: String(a.campaign_id ?? ""),
      creativeId: String(c.id ?? ""),
      instagramUserId: ig ? String(ig) : null,
      pageId: oss.page_id ? String(oss.page_id) : null,
      identityOk: Boolean(ig),
      fields: collectCopy(c),
    });
  }
  const emDashCount = ads.reduce((n, a) => n + a.fields.filter((f) => f.emDash).length, 0);
  const discountClaimCount = ads.reduce((n, a) => n + a.fields.filter((f) => f.discountClaim).length, 0);
  const truncated = raw.length >= limit;
  return {
    ads,
    emDashCount,
    discountClaimCount,
    scanned: ads.length,
    truncated,
    note:
      "Live creative text. emDash and discountClaim are deterministic flags, not judgements: read the text before acting. identityOk false means no Instagram identity is attached, so profile taps land on a page-backed shell. " +
      (wantActive
        ? "Serving and in-review ads only, filtered server-side; pass status 'all' before duplicating from the paused pool. "
        : "Full pool including paused and archived. ") +
      (truncated
        ? "TRUNCATED: the page limit was reached, so ads are missing from this result. Do not treat anything as absent; narrow the request or raise the limit."
        : "Complete for this filter."),
  };
}

/** Custom audiences with their rules in readable form. */
export async function listCustomAudiences(
  accountRef: string,
): Promise<{ audiences: Record<string, unknown>[]; truncated: boolean; note: string } | { error: string }> {
  const { act } = normalizeActId(accountRef);
  const LIMIT = 100;
  const r = await graphGet(`${act}/customaudiences`, {
    fields: "id,name,subtype,retention_days,delivery_status,operation_status,time_created,rule",
    limit: String(LIMIT),
  });
  if (r.error) return { error: r.error };
  // A mature account fills this page (one live account here returns exactly
  // 100). Without the flag Bernard would read a full page as the whole list and
  // report an audience absent when it sits on page two.
  const truncated = rows(r).length >= LIMIT;
  const audiences = rows(r).map((a) => {
    const rule = String(a.rule ?? "");
    const events = [...new Set([...rule.matchAll(/"value":"([A-Za-z_]+)"/g)].map((m) => m[1]))];
    const sources = [...new Set([...rule.matchAll(/"type":"([a-z_]+)"/g)].map((m) => m[1]))];
    const ds = (a.delivery_status ?? {}) as { code?: number; description?: string };
    return {
      id: String(a.id ?? ""),
      name: String(a.name ?? ""),
      subtype: String(a.subtype ?? ""),
      retentionDays: Number(a.retention_days ?? 0),
      created: a.time_created ? new Date(Number(a.time_created) * 1000).toISOString().slice(0, 10) : null,
      canServe: ds.code === 200,
      deliveryNote: ds.description ?? null,
      eventSources: sources,
      events,
      hasExclusions: /"exclusions"/.test(rule),
    };
  });
  return {
    audiences,
    truncated,
    note:
      "Audience SIZE is deliberately absent here. Meta suppresses it for privacy on website audiences that use advanced matching, and the API's approximate_count fields return placeholders (identical numbers across unrelated audiences) that must never be read as counts. Use canServe for whether a pool is usable; true size appears only when an ad set using it is published. " +
      (truncated
        ? "TRUNCATED: the page limit was reached, so audiences are missing from this result. Never say an audience does not exist on the strength of this list."
        : "Complete for this account."),
  };
}

/** One ad set's full configuration, for verifying a single change. */
export async function getAdSetDetail(adsetId: string): Promise<Record<string, unknown> | { error: string }> {
  const r = await graphGet(String(adsetId).trim(), {
    fields:
      "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal," +
      "billing_event,bid_strategy,promoted_object,targeting,created_time,updated_time",
  });
  if (r.error) return { error: r.error };
  const s = (r.data ?? {}) as Record<string, unknown>;
  const t = (s.targeting ?? {}) as Record<string, unknown>;
  const geo = (t.geo_locations ?? {}) as Record<string, unknown>;
  const promoted = (s.promoted_object ?? {}) as { custom_event_type?: string; pixel_id?: string };
  const named = (arr: unknown) =>
    Array.isArray(arr)
      ? arr.map((x) => ({
          id: String((x as { id?: unknown }).id ?? ""),
          name: String((x as { name?: unknown }).name ?? ""),
        }))
      : [];
  return {
    id: String(s.id ?? ""),
    name: String(s.name ?? ""),
    status: String(s.status ?? ""),
    effectiveStatus: String(s.effective_status ?? ""),
    campaignId: String(s.campaign_id ?? ""),
    dailyBudget: s.daily_budget ? Number(s.daily_budget) / 100 : null,
    lifetimeBudget: s.lifetime_budget ? Number(s.lifetime_budget) / 100 : null,
    optimizationGoal: String(s.optimization_goal ?? ""),
    conversionEvent: promoted.custom_event_type ?? null,
    pixelId: promoted.pixel_id ?? null,
    billingEvent: String(s.billing_event ?? ""),
    bidStrategy: String(s.bid_strategy ?? ""),
    countries: geo.countries ?? null,
    ageMin: t.age_min ?? null,
    ageMax: t.age_max ?? null,
    genders: t.genders ?? "all",
    includedAudiences: named(t.custom_audiences),
    excludedAudiences: named(t.excluded_custom_audiences),
    publisherPlatforms: t.publisher_platforms ?? "default (all placements, Audience Network included)",
    devicePlatforms: t.device_platforms ?? "default (all devices, desktop included)",
    updated: s.updated_time ?? null,
    note: "Budgets converted to major units. An absent publisher_platforms means every placement is on, Audience Network included.",
  };
}

/** Ad-level performance, ranked, so creative choices rest on figures. */
export async function getCreativePerformance(
  accountRef: string,
  opts: { days?: number } = {},
): Promise<{ ads: Record<string, unknown>[]; totals: Record<string, number>; note: string } | { error: string }> {
  const { act } = normalizeActId(accountRef);
  const params: Record<string, string> = {
    level: "ad",
    fields: "ad_id,ad_name,campaign_name,spend,impressions,clicks,ctr,actions,action_values",
    limit: "200",
  };
  if (opts.days) {
    const end = new Date();
    const start = new Date(end.getTime() - opts.days * 86400000);
    params.time_range = JSON.stringify({
      since: start.toISOString().slice(0, 10),
      until: end.toISOString().slice(0, 10),
    });
  } else {
    params.date_preset = "maximum";
  }
  const r = await graphGet(`${act}/insights`, params);
  if (r.error) return { error: r.error };
  const pick = (arr: unknown, re: RegExp) =>
    Number(
      (Array.isArray(arr) ? (arr as { action_type?: string; value?: unknown }[]) : []).find((a) =>
        re.test(String(a.action_type)),
      )?.value ?? 0,
    );

  let totalSpend = 0;
  let totalValue = 0;
  const ads = rows(r)
    .map((x) => {
      const spend = Number(x.spend ?? 0);
      const value = pick(x.action_values, /^(offsite_conversion\.fb_pixel_purchase|purchase)$/);
      totalSpend += spend;
      totalValue += value;
      return {
        adId: String(x.ad_id ?? ""),
        adName: String(x.ad_name ?? ""),
        campaign: String(x.campaign_name ?? ""),
        spend: Number(spend.toFixed(2)),
        impressions: Number(x.impressions ?? 0),
        ctr: Number(Number(x.ctr ?? 0).toFixed(2)),
        addToCarts: pick(x.actions, /^(offsite_conversion\.fb_pixel_add_to_cart|add_to_cart)$/),
        purchases: pick(x.actions, /^(offsite_conversion\.fb_pixel_purchase|purchase)$/),
        value: Number(value.toFixed(2)),
        roas: spend > 0 ? Number((value / spend).toFixed(2)) : 0,
      };
    })
    .filter((a) => a.spend >= 1)
    .sort((a, b) => b.spend - a.spend);

  return {
    ads,
    totals: {
      spend: Number(totalSpend.toFixed(2)),
      value: Number(totalValue.toFixed(2)),
      roas: totalSpend > 0 ? Number((totalValue / totalSpend).toFixed(2)) : 0,
    },
    note: "Ads under $1 spend omitted. ROAS on tiny spend is noise, so check the spend column before letting a high ROAS decide anything, and read the ad's words with read_ad_copy before recommending it.",
  };
}


/** Pixel event volume, which tells you whether an audience pool can exist at all. */
export async function getPixelStats(
  pixelId: string,
  opts: { days?: number } = {},
): Promise<{ pixelId: string; days: number; events: Record<string, number>; note: string } | { error: string }> {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 90);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const r = await graphGet(`${String(pixelId).trim()}/stats`, {
    aggregation: "event_total_counts",
    start_time: String(since),
  });
  if (r.error) return { error: r.error };
  const events: Record<string, number> = {};
  for (const bucket of rows(r)) {
    for (const e of (bucket.data ?? []) as { value?: string; count?: number }[]) {
      if (e.value) events[e.value] = (events[e.value] ?? 0) + Number(e.count ?? 0);
    }
  }
  return {
    pixelId: String(pixelId),
    days,
    events,
    note: "Event counts, not unique people. A healthy count alongside a pool that cannot serve points at a match-rate or audience-rule problem, not a traffic problem.",
  };
}

// QUALITY SCORE (verbatim port of RM / MM / OM / IM + _M aggregator).
// Total 0-100 = ads(40) + keywords(30) + structure(15) + assets(15).
// Labels: >=80 Strong, >=60 Good, >=40 Needs Improvement, else Weak.
// Internal `details` are de-dashed (no em dashes); they are not surfaced and not
// parity-checked (user-facing recommendations live in recommendations.ts).
import { CALLOUT_MAX, GENERIC_TERMS, CTA_TERMS } from "./constants";
import type { Campaign, ScoreBucket, QualityScoreResult, SelectedUspCategory } from "./types";

function uspTermList(selectedUSPs: SelectedUspCategory[]): string[] {
  return selectedUSPs.flatMap((c) => c.options.map((o) => o.text));
}
function refsAny(text: string, terms: string[]): boolean {
  const t = text.toLowerCase();
  return terms.some((x) => t.includes(String(x).toLowerCase()));
}

export function adsQuality(c: Campaign): ScoreBucket {
  const det: string[] = [];
  let r = 0;
  const ads = c.ads;
  const usps = uspTermList(c.settings.selectedUSPs);
  if (ads.length === 0) return { score: 0, max: 40, label: "Ads Quality", details: ["No ads created"] };

  const hSlots = ads.reduce((n, a) => n + a.headlines.length, 0);
  const hFill = ads.reduce((n, a) => n + a.headlines.filter((h) => h.text.trim()).length, 0);
  const d = hSlots ? hFill / hSlots : 0;
  r += Math.round(d * 10);
  if (d < 1) det.push(`${Math.round((1 - d) * 100)}% of headline slots are empty`);

  const dSlots = ads.reduce((n, a) => n + a.descriptions.length, 0);
  const dFill = ads.reduce((n, a) => n + a.descriptions.filter((x) => x.text.trim()).length, 0);
  const b = dSlots ? dFill / dSlots : 0;
  r += Math.round(b * 8);
  if (b < 0.75) det.push("Many description slots are empty");

  const x = ads.filter((a) => a.finalUrl.trim()).length / ads.length;
  r += Math.round(x * 4);
  if (x < 1) det.push("Some ads are missing Final URLs");

  if (usps.length > 0) {
    const C =
      ads.filter((a) =>
        refsAny([...a.headlines.map((h) => h.text), ...a.descriptions.map((h) => h.text)].join(" "), usps),
      ).length / ads.length;
    r += Math.round(C * 8);
    if (C < 0.5) det.push("Most ads do not reference your USPs");
  } else {
    r += 4;
    det.push("No USPs selected, ads use generic benefits");
  }

  const y =
    ads.filter((a) =>
      refsAny([...a.headlines.map((h) => h.text), ...a.descriptions.map((h) => h.text)].join(" "), CTA_TERMS),
    ).length / ads.length;
  r += Math.round(y * 5);
  if (y < 0.8) det.push("Some ads lack clear calls-to-action");

  const viol = ads.some(
    (a) => a.headlines.some((h) => h.text.length > 30) || a.descriptions.some((h) => h.text.length > 90),
  );
  if (viol) det.push("Character limit violations detected");
  else r += 5;

  return { score: Math.min(r, 40), max: 40, label: "Ads Quality", details: det };
}

export function keywordStrategy(c: Campaign): ScoreBucket {
  const det: string[] = [];
  let r = 0;
  const kws = c.adGroups.flatMap((g) => g.keywords);
  const set = new Set(kws.map((k) => k.text.toLowerCase()));
  if (kws.length === 0) return { score: 0, max: 30, label: "Keyword Strategy", details: ["No keywords added"] };

  r += Math.min(Math.round((set.size / 3) * 8), 8);
  if (set.size < 3) det.push("Add more keyword variety");

  const mts = new Set(kws.map((k) => k.matchType));
  r += Math.round((mts.size / 3) * 6);
  if (mts.size < 2) det.push("Use multiple match types for better coverage");

  const negTotal = c.adGroups.reduce((n, g) => n + g.negativeKeywords.length, 0);
  r += Math.min(negTotal >= 3 ? 6 : Math.round((negTotal / 3) * 6), 6);
  if (negTotal === 0) det.push("Add negative keywords to reduce wasted spend");

  const generic = [...set].filter((k) => GENERIC_TERMS.includes(k)).length;
  const v = set.size ? generic / set.size : 0;
  r += Math.round((1 - v) * 5);
  if (v > 0.3) det.push("Some keywords are too generic, be more specific");

  const haystack = c.ads.flatMap((a) => a.headlines.map((h) => h.text)).join(" ").toLowerCase();
  const inHead = [...set].filter((k) => haystack.includes(k)).length;
  const w = set.size ? inHead / set.size : 0;
  r += Math.round(w * 5);
  if (w < 0.5) det.push("Many keywords are not used in ad copy");

  return { score: Math.min(r, 30), max: 30, label: "Keyword Strategy", details: det };
}

export function campaignStructure(c: Campaign): ScoreBucket {
  const det: string[] = [];
  let r = 0;
  const gs = c.adGroups;
  if (gs.length === 0) return { score: 0, max: 15, label: "Campaign Structure", details: ["No ad groups created"] };

  const withAds = gs.filter((g) => c.ads.some((a) => a.adGroupId === g.id)).length / gs.length;
  r += Math.round(withAds * 5);
  if (withAds < 1) det.push("Some ad groups have no ads assigned");

  const named = gs.filter((g) => g.name.trim().length > 0).length;
  r += Math.round((named / gs.length) * 3);
  if (named < gs.length) det.push("Some ad groups are unnamed");

  const withKw = gs.filter((g) => g.keywords.length > 0).length;
  r += Math.round((withKw / gs.length) * 4);

  const sets = gs.map((g) => new Set(g.keywords.map((k) => k.text.toLowerCase())));
  let pairs = 0;
  let overlapping = 0;
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      pairs++;
      if ([...sets[i]].some((x) => sets[j].has(x))) overlapping++;
    }
  const v = pairs ? overlapping / pairs : 0;
  r += v > 0.6 ? 1 : 3; // STRICT > 0.6 — load-bearing (Run 3 overlap is exactly 0.6 -> 3)
  if (v > 0.6) det.push("High keyword overlap between ad groups");

  return { score: Math.min(r, 15), max: 15, label: "Campaign Structure", details: det };
}

export function assetsUsage(c: Campaign): ScoreBucket {
  const det: string[] = [];
  let r = 0;
  const s = c.sitelinks || [];
  const o = c.callouts || [];

  if (s.length === 0) det.push("No sitelinks created");
  else {
    r += Math.min(Math.round((s.length / 4) * 4), 4);
    if (s.length < 4) det.push("Add at least 4 sitelinks for optimal display");
    const cc =
      s.filter((u) => u.linkText && u.linkText.trim() && u.finalUrl && u.finalUrl.trim()).length / s.length;
    r += Math.round(cc * 4);
    if (cc < 1) det.push("Some sitelinks are missing text or URLs");
  }

  if (o.length === 0) det.push("No callout extensions created");
  else {
    r += Math.min(Math.round((o.length / 4) * 3), 3);
    if (o.length < 2) det.push("Add at least 2 callouts for display");
    const cc = o.length ? o.filter((u) => u.text.trim() && u.text.length <= CALLOUT_MAX).length / o.length : 0;
    r += Math.round(cc * 4);
    if (cc < 1) det.push("Some callouts are empty or exceed the character limit");
  }

  return { score: Math.min(r, 15), max: 15, label: "Assets Usage", details: det };
}

export function overallLabel(total: number): string {
  if (total >= 80) return "Strong";
  if (total >= 60) return "Good";
  if (total >= 40) return "Needs Improvement";
  return "Weak";
}

export function qualityScore(campaign: Campaign): QualityScoreResult {
  const ads = adsQuality(campaign);
  const kw = keywordStrategy(campaign);
  const st = campaignStructure(campaign);
  const as = assetsUsage(campaign);
  const total = ads.score + kw.score + st.score + as.score;
  return { total, label: overallLabel(total), categories: { ads, keywords: kw, structure: st, assets: as } };
}

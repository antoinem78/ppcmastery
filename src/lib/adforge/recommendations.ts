// Quality-Score recommendations + differentiation checklist (report section 8).
// User-facing copy: de-dashed (no em/en dashes), per the house rule.
import { CTA_TERMS, GENERIC_TERMS, CALLOUT_MAX } from "./constants";
import { adsQuality } from "./qualityScore";
import type { Campaign } from "./types";

export type RecPriority = "high" | "medium" | "low";
export interface Recommendation {
  category: "Ads" | "Keywords" | "Structure" | "Assets";
  priority: RecPriority;
  text: string;
}

const uspTexts = (c: Campaign) => c.settings.selectedUSPs.flatMap((cat) => cat.options.map((o) => o.text));
const adText = (c: Campaign) =>
  c.ads.map((a) => [...a.headlines.map((h) => h.text), ...a.descriptions.map((d) => d.text)].join(" ").toLowerCase());
const rate = (n: number, d: number) => (d ? n / d : 0);

export function recommendations(c: Campaign): Recommendation[] {
  const recs: Recommendation[] = [];
  const ads = c.ads;
  const texts = uspTexts(c).map((t) => t.toLowerCase());

  if (ads.length) {
    const adsScore = adsQuality(c).score;
    if (adsScore < 20)
      recs.push({ category: "Ads", priority: "high", text: "Fill all 15 headline slots and 4 descriptions in every RSA to maximise ad combinations." });

    const uspRate = texts.length
      ? rate(adText(c).filter((t) => texts.some((u) => t.includes(u))).length, ads.length)
      : 1;
    if (uspRate < 0.5)
      recs.push({ category: "Ads", priority: "high", text: "Incorporate your selected USPs in headlines 6 to 10 to differentiate from competitors." });

    const ctaRate = rate(adText(c).filter((t) => CTA_TERMS.some((x) => t.includes(x))).length, ads.length);
    if (ctaRate < 0.8)
      recs.push({ category: "Ads", priority: "medium", text: 'Add clear CTAs like "Book Now" or "Get a Quote" in headlines 11 to 15.' });

    const finalUrlRate = rate(ads.filter((a) => a.finalUrl.trim()).length, ads.length);
    if (finalUrlRate < 1)
      recs.push({ category: "Ads", priority: "high", text: "Every ad must have a Final URL: add the landing page URL to all ads." });
  }

  const kws = c.adGroups.flatMap((g) => g.keywords);
  const set = new Set(kws.map((k) => k.text.toLowerCase()));
  const negTotal = c.adGroups.reduce((n, g) => n + g.negativeKeywords.length, 0);
  if (negTotal === 0)
    recs.push({ category: "Keywords", priority: "high", text: "Add negative keywords to prevent your ads from showing on irrelevant searches." });
  const genericRate = rate([...set].filter((k) => GENERIC_TERMS.includes(k)).length, set.size);
  if (genericRate > 0.3)
    recs.push({ category: "Keywords", priority: "medium", text: "Replace generic keywords with more specific, intent-driven terms." });

  const sets = c.adGroups.map((g) => new Set(g.keywords.map((k) => k.text.toLowerCase())));
  let pairs = 0;
  let overlapping = 0;
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      pairs++;
      if ([...sets[i]].some((x) => sets[j].has(x))) overlapping++;
    }
  if (pairs && overlapping / pairs > 0.6)
    recs.push({ category: "Structure", priority: "low", text: "Reduce keyword overlap between ad groups to avoid internal competition." });

  if ((c.sitelinks?.length ?? 0) < 4)
    recs.push({ category: "Assets", priority: "medium", text: "Add at least 4 sitelinks to increase ad real estate and CTR." });
  if ((c.callouts?.length ?? 0) < 2)
    recs.push({ category: "Assets", priority: "medium", text: 'Add callout extensions to highlight key benefits like "Free Delivery" or "24/7 Support".' });

  const order: Record<RecPriority, number> = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);
}

export interface Differentiation {
  uspDetected: boolean;
  uspInHeadlines: boolean;
  uniqueMessaging: boolean;
}
export function differentiation(c: Campaign): Differentiation {
  const texts = uspTexts(c).map((t) => t.toLowerCase());
  const uspInHeadlines =
    texts.length > 0 &&
    c.ads.some((a) => a.headlines.some((h) => texts.some((u) => h.text.toLowerCase().includes(u))));
  return {
    uspDetected: texts.length > 0,
    uspInHeadlines,
    uniqueMessaging: c.settings.uspStrength === "strong" || texts.length >= 2,
  };
}

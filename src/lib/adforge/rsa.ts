// RSA GENERATION (adapted from the reference uP / dP / pP / Su).
// Two ads per group (normal + DKI). 15 headlines = 5 keyword + 5 USP + 5 CTA.
// Headlines are written to FIT 30 chars (overflowing decorated patterns fall back
// to the bare keyword) rather than being truncated mid-phrase. Descriptions are
// pre-filled with sensible defaults (the AI generator upgrades them).
import { rid } from "./id";
import { HL, EMPTY_HL, titleCase, truncate } from "./text";
import { KW_PATTERNS, USP_FALLBACKS, CTA_HEADLINES, DESC_MAX } from "./constants";
import type { AdGroup, Ad, Headline, Description, SelectedUspCategory } from "./types";

const HEADLINE_MAX = 30;
// Prefer the decorated headline; if it would overflow 30 chars, use the bare
// keyword (so we don't show "Professional Emergency Plumber Lo…").
const fitHeadline = (decorated: string, fallback: string): Headline =>
  HL(decorated.length <= HEADLINE_MAX ? decorated : fallback.length <= HEADLINE_MAX ? fallback : decorated);

// uP(adGroup, isDki) -> 5 keyword headlines.
export function keywordHeadlines(adGroup: AdGroup, isDki: boolean): Headline[] {
  const raw = (adGroup.keywords[0] && adGroup.keywords[0].text) || "Your Keyword";
  const tc = titleCase(raw);
  const out: Headline[] = [];
  // H1: DKI uses {KeyWord:...} ONLY if it fits 30 chars (a truncated tag is
  // invalid); otherwise fall back to a normal keyword headline.
  const dkiTag = `{KeyWord:${raw}}`;
  if (isDki && dkiTag.length <= HEADLINE_MAX) out.push({ id: rid(), text: dkiTag });
  else out.push(fitHeadline(KW_PATTERNS[0](tc), tc));
  for (let i = 1; i < 5; i++) out.push(fitHeadline(KW_PATTERNS[i](tc), tc));
  return out;
}

// Generic fallback descriptions, used to top up to 4 when there aren't enough USPs.
const DESC_FALLBACKS = [
  "Get in touch today for a free, no-obligation quote.",
  "Trusted, professional service you can rely on.",
  "Friendly experts ready to help. Contact us now.",
  "Great value and quality results, every time.",
];

// Four sensible default descriptions built from the keyword, location and USPs,
// so every ad is publishable before the AI generator improves the copy.
export function defaultDescriptions(
  adGroup: AdGroup,
  selectedUSPs: SelectedUspCategory[],
  services: string[],
  location: string,
): Description[] {
  const kw = titleCase((adGroup.keywords[0] && adGroup.keywords[0].text) || services[0] || "Our Services");
  const loc = location ? ` in ${location}` : "";
  const usps = selectedUSPs.flatMap((c) => c.options.map((o) => o.text)).filter(Boolean);

  const lines: string[] = [];
  lines.push(usps[0] ? `${kw}${loc}. ${usps[0]}.` : `Professional ${kw.toLowerCase()}${loc}. Get in touch today.`);
  if (usps[1] || usps[2]) lines.push([usps[1], usps[2]].filter(Boolean).join(". ") + ".");
  for (const u of usps.slice(3)) lines.push(`${u}. Contact us today.`);
  for (const f of DESC_FALLBACKS) {
    if (lines.length >= 4) break;
    if (!lines.includes(f)) lines.push(f);
  }
  return lines.slice(0, 4).map((t) => ({ id: rid(), text: truncate(t, DESC_MAX) }));
}

// dP(selectedUSPs) -> 5 USP headlines (selected option texts, padded with dg[]).
export function uspHeadlines(selectedUSPs: SelectedUspCategory[]): Headline[] {
  const texts = selectedUSPs.flatMap((cat) => cat.options.map((o) => o.text));
  if (texts.length > 0) {
    const out = [...texts.slice(0, 5)];
    while (out.length < 5) {
      const f = USP_FALLBACKS[out.length - texts.length];
      if (f) out.push(f);
      else break;
    }
    return out.map(HL);
  }
  return USP_FALLBACKS.map(HL);
}

// pP() -> 5 CTA headlines.
export const ctaHeadlines = (): Headline[] => CTA_HEADLINES.map(HL);

// Extra distinct keyword-led headline variants, used to backfill an ad after
// duplicates are removed (so we still reach 15 distinct headlines).
const extraKeywordHeadlines = (tc: string): string[] =>
  [tc, `${tc} Experts`, `Local ${tc}`, `Affordable ${tc}`, `${tc} Specialists`, `Trusted ${tc}`, `${tc} Quotes`].filter(
    (s) => s.length <= HEADLINE_MAX,
  );

// Assemble up to `target` DISTINCT, non-empty headlines from the primary set,
// backfilling from a pool. Dedupe is case-insensitive on the final (truncated)
// text — Google rejects an RSA with duplicate headlines.
function distinctHeadlines(primary: Headline[], pool: string[], target = 15): Headline[] {
  const seen = new Set<string>();
  const out: Headline[] = [];
  const add = (text: string) => {
    const t = truncate(text.trim(), HEADLINE_MAX);
    const key = t.toLowerCase();
    if (!t || seen.has(key) || out.length >= target) return;
    seen.add(key);
    out.push({ id: rid(), text: t });
  };
  for (const h of primary) add(h.text);
  for (const p of pool) add(p);
  return out;
}

// Su(adGroup, selectedUSPs, isDki) -> one RSA ad object.
export function buildAd(
  adGroup: AdGroup,
  selectedUSPs: SelectedUspCategory[],
  isDki: boolean,
  services: string[] = [],
  location = "",
): Ad {
  const tc = titleCase((adGroup.keywords[0] && adGroup.keywords[0].text) || "Your Keyword");
  const primary: Headline[] = [
    ...keywordHeadlines(adGroup, isDki),
    ...uspHeadlines(selectedUSPs),
    ...ctaHeadlines(),
  ];
  // Dedupe (the fit-to-30 fallback can collapse patterns to the same text) and
  // backfill with distinct keyword variants + USP fallbacks to reach 15.
  let headlines = distinctHeadlines(primary, [...extraKeywordHeadlines(tc), ...USP_FALLBACKS], 15);
  while (headlines.length < 15) headlines.push(EMPTY_HL());
  return {
    id: rid(),
    adGroupId: adGroup.id,
    headlines,
    descriptions: defaultDescriptions(adGroup, selectedUSPs, services, location),
    path1: "",
    path2: "",
    finalUrl: "",
  };
}

// A DEFAULT pair (normal + DKI) per ad group.
export function generateDefaultAds(
  adGroups: AdGroup[],
  selectedUSPs: SelectedUspCategory[],
  services: string[] = [],
  location = "",
): Ad[] {
  const ads: Ad[] = [];
  adGroups.forEach((g) => {
    ads.push(buildAd(g, selectedUSPs, false, services, location));
    ads.push(buildAd(g, selectedUSPs, true, services, location));
  });
  return ads;
}

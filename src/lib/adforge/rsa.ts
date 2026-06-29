// RSA GENERATION (verbatim port of uP / dP / pP / Su).
// Two ads per group (normal + DKI). 15 headlines = 5 keyword + 5 USP + 5 CTA.
// 4 descriptions: ALWAYS empty. No pinning. Headlines truncated to 30 (Z0).
import { rid } from "./id";
import { HL, EMPTY_HL, emptyDescriptions, titleCase, truncate } from "./text";
import { KW_PATTERNS, USP_FALLBACKS, CTA_HEADLINES } from "./constants";
import type { AdGroup, Ad, Headline, SelectedUspCategory } from "./types";

// uP(adGroup, isDki) -> 5 keyword headlines.
export function keywordHeadlines(adGroup: AdGroup, isDki: boolean): Headline[] {
  const raw = (adGroup.keywords[0] && adGroup.keywords[0].text) || "Your Keyword";
  const tc = titleCase(raw);
  const out: Headline[] = [];
  // H1: DKI uses the RAW (lower-case) keyword inside {KeyWord:...}; else ug[0].
  out.push(isDki ? { id: rid(), text: truncate(`{KeyWord:${raw}}`) } : HL(KW_PATTERNS[0](tc)));
  for (let i = 1; i < 5; i++) out.push(HL(KW_PATTERNS[i](tc)));
  return out;
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

// Su(adGroup, selectedUSPs, isDki) -> one RSA ad object.
export function buildAd(adGroup: AdGroup, selectedUSPs: SelectedUspCategory[], isDki: boolean): Ad {
  let headlines: Headline[] = [
    ...keywordHeadlines(adGroup, isDki),
    ...uspHeadlines(selectedUSPs),
    ...ctaHeadlines(),
  ];
  while (headlines.length < 15) headlines.push(EMPTY_HL());
  headlines = headlines.slice(0, 15);
  return {
    id: rid(),
    adGroupId: adGroup.id,
    headlines,
    descriptions: emptyDescriptions(),
    path1: "",
    path2: "",
    finalUrl: "",
  };
}

// A DEFAULT pair (normal + DKI) per ad group.
export function generateDefaultAds(adGroups: AdGroup[], selectedUSPs: SelectedUspCategory[]): Ad[] {
  const ads: Ad[] = [];
  adGroups.forEach((g) => {
    ads.push(buildAd(g, selectedUSPs, false));
    ads.push(buildAd(g, selectedUSPs, true));
  });
  return ads;
}

// EXPORT JSON SHAPE (verbatim port of toExport). Report section 9.
import type { Campaign } from "./types";

export function toExport(c: Campaign) {
  return {
    campaign: c.name,
    settings: {
      networks: c.settings.networks,
      languages: c.settings.languages,
      locationTargeting: c.settings.locationTargeting,
      marketContext: c.settings.marketContext,
      usps: c.settings.selectedUSPs,
    },
    adGroups: c.adGroups.map((g) => ({
      name: g.name,
      type: g.type,
      maxCpc: g.maxCpc,
      keywords: g.keywords,
      negativeKeywords: g.negativeKeywords,
    })),
    ads: c.ads,
    sitelinks: (c.sitelinks || []).map((s) => ({
      adGroupId: s.adGroupId,
      linkText: s.linkText,
      finalUrl: s.finalUrl,
      descriptionLine1: s.descriptionLine1,
      descriptionLine2: s.descriptionLine2,
      platformTargeting: s.platformTargeting,
      devicePreference: s.devicePreference,
    })),
    callouts: (c.callouts || []).map((x) => ({ text: x.text })),
  };
}

// filename: `${campaignName.replace(/\s+/g,'_')}_campaign.json`
export function exportFilename(name: string): string {
  return `${name.replace(/\s+/g, "_")}_campaign.json`;
}

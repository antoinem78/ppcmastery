// End-to-end campaign builder (verbatim port of DEFAULT_SETTINGS + buildCampaign).
import { rid } from "./id";
import { uspStrength } from "./usp";
import { generateAdGroups } from "./adgroups";
import { generateDefaultAds } from "./rsa";
import type { Campaign, CampaignSettings, BuildCampaignInput } from "./types";

export const DEFAULT_SETTINGS = (): CampaignSettings => ({
  networks: { googleSearch: true, searchPartners: false, displayNetwork: false },
  languages: ["English"],
  locationTargeting: [],
  marketContext: { brandName: "", competitors: [], targetCountry: "" },
  selectedUSPs: [],
  uspStrength: "weak",
});

export function buildCampaign(input: BuildCampaignInput): Campaign {
  const c: Campaign = {
    id: rid(),
    name: input.name,
    businessType: input.businessType,
    productDescription: "",
    specificServices: input.services,
    settings: DEFAULT_SETTINGS(),
    adGroups: [],
    ads: [],
    sitelinks: [],
    callouts: [],
    campaignNegativeKeywords: [],
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (input.location) c.settings.locationTargeting = [{ name: input.location, type: "city" }];
  c.settings.selectedUSPs = input.selectedUSPs || [];
  c.settings.uspStrength = uspStrength(c.settings.selectedUSPs);
  c.adGroups = generateAdGroups(input.selectedKeywords, input.maxCpc || 1, input.avoidKeywords || "");
  c.ads = generateDefaultAds(c.adGroups, c.settings.selectedUSPs, input.services, input.location || "");
  // Baseline Final URL = the homepage, so ads are publishable before AI deep-links
  // each group to a more specific page.
  if (input.websiteUrl) for (const ad of c.ads) ad.finalUrl = input.websiteUrl;
  return c;
}

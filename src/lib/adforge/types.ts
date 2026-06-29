// AdForge domain types. Mirror the exact shapes the reference engine produces
// and the Export JSON schema (report section 9).

export type MatchType = "exact" | "phrase" | "broad";
export type AdGroupKind = "skag-exact" | "skag-phrase" | "stag";
export type UspStrength = "weak" | "average" | "strong";

export interface Keyword {
  id: string;
  text: string;
  matchType: MatchType;
}

export interface NegativeKeyword {
  id: string;
  text: string;
  matchType: MatchType;
  origin: "onboarding" | "skag";
}

export interface AdGroup {
  id: string;
  name: string;
  type: AdGroupKind;
  keywords: Keyword[];
  negativeKeywords: NegativeKeyword[];
  maxCpc: number;
}

export interface Headline {
  id: string;
  text: string;
}
export interface Description {
  id: string;
  text: string;
}

export interface Ad {
  id: string;
  adGroupId: string;
  headlines: Headline[];
  descriptions: Description[];
  path1: string;
  path2: string;
  finalUrl: string;
}

export interface UspOption {
  id: string;
  category: string;
  text: string;
  isCustom: boolean;
}
export interface SelectedUspCategory {
  category: string;
  options: UspOption[];
}

export interface Sitelink {
  id: string;
  adGroupId: string;
  linkText: string;
  finalUrl: string;
  descriptionLine1: string;
  descriptionLine2: string;
  platformTargeting: string;
  devicePreference: string;
}

export interface Callout {
  id: string;
  text: string;
}

export interface LocationTarget {
  name: string;
  type: string;
}

export interface CampaignSettings {
  networks: { googleSearch: boolean; searchPartners: boolean; displayNetwork: boolean };
  languages: string[];
  locationTargeting: LocationTarget[];
  marketContext: { brandName: string; competitors: string[]; targetCountry: string };
  selectedUSPs: SelectedUspCategory[];
  uspStrength: UspStrength;
}

export interface Campaign {
  id: string;
  name: string;
  businessType: string;
  productDescription: string;
  specificServices: string[];
  settings: CampaignSettings;
  adGroups: AdGroup[];
  ads: Ad[];
  sitelinks: Sitelink[];
  callouts: Callout[];
  campaignNegativeKeywords: NegativeKeyword[];
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ScoreBucket {
  score: number;
  max: number;
  label: string;
  details: string[];
}
export interface QualityScoreResult {
  total: number;
  label: string;
  categories: { ads: ScoreBucket; keywords: ScoreBucket; structure: ScoreBucket; assets: ScoreBucket };
}

// Input to the end-to-end builder (mirrors reference buildCampaign input).
export interface BuildCampaignInput {
  name: string;
  businessType: string;
  isOnline?: boolean;
  location?: string;
  services: string[];
  selectedKeywords: string[];
  selectedUSPs?: SelectedUspCategory[];
  avoidKeywords?: string;
  maxCpc?: number;
}

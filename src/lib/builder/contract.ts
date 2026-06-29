// Shared request/response contract for the Campaign Builder AI features.
// Pure types — imported by BOTH the client (the builder steps) and the server
// routes, so it must stay free of any server-only or "use client" code.

export type BuilderModel = "opus" | "sonnet";

// Maps the UI toggle to the exact model IDs the portal is licensed to call
// (same two the rest of the portal uses — no new keys).
export const MODEL_IDS: Record<BuilderModel, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
};

// ---- site analysis --------------------------------------------------------

export interface SitePage {
  url: string; // absolute, same-domain
  label: string; // short human label (<= 25 chars), good for a sitelink
  category?: string; // e.g. "services", "pricing", "about"
}

export interface SiteAnalysis {
  url: string; // the entered URL, normalised
  domain: string;
  summary: string; // 1-2 sentence description of the business
  suggestedBusinessType: string; // one of our BUSINESS_TYPES ids, or ""
  suggestedServices: string[];
  keywordSeeds: string[];
  pages: SitePage[]; // real, existing pages for deep-linking + sitelinks
}

export interface AnalyzeSiteRequest {
  url: string;
  model: BuilderModel;
}
export interface AnalyzeSiteResult {
  analysis: SiteAnalysis;
}

// ---- generation context ---------------------------------------------------

// Everything the model needs to write on-brand, policy-clean, grounded copy.
export interface GenerateContext {
  businessType: string;
  location: string;
  isOnline: boolean;
  services: string[];
  brandName: string;
  usps: string[]; // flattened selected USP texts
  avoidTerms: string[]; // words the client asked us to steer clear of
  websiteUrl: string; // homepage; the Final URL baseline
  siteSummary: string; // from site analysis (may be "")
  pages: SitePage[]; // real pages for deep-linking + sitelinks (may be [])
}

export interface AdGroupCtx {
  name: string;
  keywords: string[];
}

export type GenerateRequest =
  | { kind: "ads"; model: BuilderModel; context: GenerateContext; adGroup: AdGroupCtx }
  | { kind: "sitelinks"; model: BuilderModel; context: GenerateContext }
  | { kind: "callouts"; model: BuilderModel; context: GenerateContext }
  | { kind: "keywords"; model: BuilderModel; context: GenerateContext };

export interface AdsResult {
  headlines: string[]; // up to 15, each <= 30 chars
  descriptions: string[]; // exactly 4, each <= 90 chars
  finalUrl: string; // deep-linked page for this ad group (or homepage)
}

export interface SitelinkResult {
  linkText: string; // <= 25 chars
  finalUrl: string; // a real page URL
  descriptionLine1: string; // <= 35 chars
  descriptionLine2: string; // <= 35 chars
}
export interface SitelinksResult {
  sitelinks: SitelinkResult[];
}

export interface CalloutsResult {
  callouts: string[]; // each <= 25 chars
}

export interface KeywordsResult {
  keywords: string[]; // lower-case keyword phrases
}

export type GenerateResponse = AdsResult | SitelinksResult | CalloutsResult | KeywordsResult;

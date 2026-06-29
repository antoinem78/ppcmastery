// Shared request/response contract for the AdForge AI copy generator.
// Pure types — imported by BOTH the client (the builder steps) and the server
// route, so it must stay free of any server-only or "use client" code.

export type BuilderModel = "opus" | "sonnet";

// Maps the UI toggle to the exact model IDs the portal is licensed to call
// (same two the rest of the portal uses — no new keys).
export const MODEL_IDS: Record<BuilderModel, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
};

// Everything the model needs to write on-brand, policy-clean copy.
export interface GenerateContext {
  businessType: string;
  location: string;
  isOnline: boolean;
  services: string[];
  brandName: string;
  usps: string[]; // flattened selected USP texts
  avoidTerms: string[]; // words the client asked us to steer clear of
}

export interface AdGroupCtx {
  name: string;
  keywords: string[];
}

export type GenerateRequest =
  | { kind: "ads"; model: BuilderModel; context: GenerateContext; adGroup: AdGroupCtx }
  | { kind: "sitelinks"; model: BuilderModel; context: GenerateContext }
  | { kind: "callouts"; model: BuilderModel; context: GenerateContext };

export interface AdsResult {
  headlines: string[]; // up to 15, each <= 30 chars
  descriptions: string[]; // exactly 4, each <= 90 chars
}

export interface SitelinkResult {
  linkText: string; // <= 25 chars
  descriptionLine1: string; // <= 35 chars
  descriptionLine2: string; // <= 35 chars
}
export interface SitelinksResult {
  sitelinks: SitelinkResult[];
}

export interface CalloutsResult {
  callouts: string[]; // each <= 25 chars
}

export type GenerateResponse = AdsResult | SitelinksResult | CalloutsResult;

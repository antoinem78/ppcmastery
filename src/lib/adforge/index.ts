// AdForge engine — pure, framework-free, client-deterministic. No AI, no network.
export * from "./types";
export * from "./constants";
export { rid } from "./id";
export { truncate, HL, EMPTY_HL, emptyDescriptions, titleCase } from "./text";
export { expandService, expandRetail, generateKeywords, campaignNameSuggestions } from "./keywords";
export { generateAdGroups } from "./adgroups";
export { keywordHeadlines, uspHeadlines, ctaHeadlines, buildAd, generateDefaultAds } from "./rsa";
export { uspStrength } from "./usp";
export {
  adsQuality,
  keywordStrategy,
  campaignStructure,
  assetsUsage,
  overallLabel,
  qualityScore,
} from "./qualityScore";
export { toExport, exportFilename } from "./export";
export { DEFAULT_SETTINGS, buildCampaign } from "./builder";
export { recommendations, differentiation } from "./recommendations";
export type { Recommendation, RecPriority, Differentiation } from "./recommendations";

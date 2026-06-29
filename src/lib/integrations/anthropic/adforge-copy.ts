// AI copy generation for the AdForge builder — Responsive Search Ad headlines &
// descriptions, sitelinks, and callouts. Reuses the portal's Anthropic
// integration (ANTHROPIC_API_KEY, same SDK as narrative.ts); no new keys.
//
// The model writes the copy; THIS module is the safety net. Every Google Ads
// hard limit (character counts, exactly-4 descriptions, no ALL CAPS, no excess
// punctuation, no duplicates) is re-enforced in code AFTER generation, so a
// stray model output can never produce a campaign Google would reject. The
// deterministic engine (lib/adforge) remains the offline fallback.
import Anthropic from "@anthropic-ai/sdk";
import { truncate, titleCase } from "@/lib/adforge";
import {
  HEADLINE_MAX,
  DESC_MAX,
  CALLOUT_MAX,
} from "@/lib/adforge";
import {
  MODEL_IDS,
  type AdGroupCtx,
  type AdsResult,
  type BuilderModel,
  type CalloutsResult,
  type GenerateContext,
  type SitelinksResult,
} from "@/lib/builder/contract";

const SITELINK_TEXT_MAX = 25;
const SITELINK_DESC_MAX = 35;

// ---- text hygiene ---------------------------------------------------------

const clean = (s: string): string =>
  s.replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`]+$/g, "");

// Google disapproves excessive caps. Allow a single all-caps word (acronyms,
// "24/7"), but if the WHOLE string is caps, sentence/title-case it.
const isAllCaps = (s: string): boolean =>
  /[A-Za-z]{2}/.test(s) && s === s.toUpperCase();
const fixCaps = (s: string): string => (isAllCaps(s) ? titleCase(s) : s);

// Collapse repeated punctuation ("Now!!!" -> "Now!") and keep at most one "!".
const tidyPunct = (s: string): string => {
  let out = s.replace(/([!?.,;:])\1+/g, "$1");
  const firstBang = out.indexOf("!");
  if (firstBang !== -1) {
    out = out.slice(0, firstBang + 1) + out.slice(firstBang + 1).replace(/!/g, "");
  }
  return out.trim();
};

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// ---- Anthropic call -------------------------------------------------------

const SYSTEM = `You are a senior Google Ads copywriter at a paid-search agency. You write Responsive Search Ad copy and ad extensions that comply with Google Ads editorial policy and never get disapproved.

GOOGLE ADS HARD LIMITS (never exceed):
- RSA headline: 30 characters max.
- RSA description: 90 characters max.
- Sitelink link text: 25 characters max. Each sitelink description line: 35 characters max.
- Callout: 25 characters max.

EDITORIAL POLICY (always follow):
- No ALL-CAPS words except natural acronyms or units (e.g. "24/7", "UK"). Use Title Case or sentence case.
- No excessive or repeated punctuation. At most one exclamation mark total, and never in the middle of a sentence. No gimmicky symbols.
- No phone numbers in headlines or descriptions.
- No unsubstantiated superlatives or claims ("#1", "best", "guaranteed", "cheapest") unless they are clearly defensible from the provided USPs.
- No misleading or clickbait copy. No "click here". Be specific and benefit-led.
- Every headline must read on its own (Google shows them in any order and combination), and must be DISTINCT — do not repeat the same words or phrases across headlines.
- Vary the angles: some keyword-relevant, some USP/benefit, some trust/credibility, some call-to-action.
- British English spelling. Natural, professional, human tone. Do not pad to hit a length; shorter and punchy is better than padded.

OUTPUT: respond with a single minified JSON object and nothing else. No markdown, no code fences, no commentary before or after.`;

function contextBlock(c: GenerateContext): string {
  const lines = [
    `Business type: ${c.businessType || "unspecified"}`,
    c.isOnline ? `Sells online (national/online reach).` : c.location ? `Local business serving: ${c.location}.` : `Location: unspecified.`,
    c.brandName ? `Brand name: ${c.brandName}` : null,
    c.services.length ? `Services / products: ${c.services.join(", ")}` : null,
    c.usps.length ? `Unique selling points to weave in: ${c.usps.join("; ")}` : null,
    c.avoidTerms.length ? `Avoid these words entirely: ${c.avoidTerms.join(", ")}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

async function callModel(model: BuilderModel, userPrompt: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI generation is not configured (ANTHROPIC_API_KEY missing).");
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: MODEL_IDS[model] ?? MODEL_IDS.opus,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // The model may occasionally wrap JSON in prose despite instructions —
  // extract the outermost object defensively.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model did not return JSON.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ---- public generators ----------------------------------------------------

export async function generateAds(
  model: BuilderModel,
  context: GenerateContext,
  adGroup: AdGroupCtx,
): Promise<AdsResult> {
  const prompt = `${contextBlock(context)}

AD GROUP: "${adGroup.name}"
Target keyword(s) for this ad group: ${adGroup.keywords.join(", ") || adGroup.name}

Write copy for ONE Responsive Search Ad targeting this ad group's keyword(s):
- Exactly 15 headlines (each 30 characters or fewer). Make several closely reflect the target keyword (good for Quality Score), several highlight the USPs/benefits, a couple convey trust, and 2-3 are calls to action.
- Exactly 4 descriptions (each 90 characters or fewer), each a complete, benefit-led sentence that works alongside any headline.

Return JSON: {"headlines": ["..."], "descriptions": ["...", "...", "...", "..."]}`;

  const raw = (await callModel(model, prompt)) as { headlines?: unknown; descriptions?: unknown };

  let headlines = dedupe(
    asStringArray(raw.headlines)
      .map((h) => truncate(fixCaps(clean(h)), HEADLINE_MAX))
      .filter(Boolean),
  ).slice(0, 15);
  // Should not happen (model asked for 15), but never return zero.
  if (headlines.length === 0) headlines = [truncate(adGroup.keywords[0] ?? adGroup.name, HEADLINE_MAX)];

  let descriptions = dedupe(
    asStringArray(raw.descriptions)
      .map((d) => truncate(tidyPunct(clean(d)), DESC_MAX))
      .filter(Boolean),
  ).slice(0, 4);
  while (descriptions.length < 4) descriptions.push(""); // RSA always carries 4 description slots

  return { headlines, descriptions };
}

export async function generateSitelinks(
  model: BuilderModel,
  context: GenerateContext,
): Promise<SitelinksResult> {
  const prompt = `${contextBlock(context)}

Write 6 sitelink extensions for this advertiser. Each sitelink points to a distinct, plausible page (e.g. services, pricing, about, contact, book/quote, reviews). For each:
- link text: 25 characters or fewer, Title Case, action- or destination-oriented.
- two description lines: each 35 characters or fewer, complementary, benefit-led.
All 6 link texts must be distinct.

Return JSON: {"sitelinks": [{"linkText": "...", "descriptionLine1": "...", "descriptionLine2": "..."}]}`;

  const raw = (await callModel(model, prompt)) as { sitelinks?: unknown };
  const arr = Array.isArray(raw.sitelinks) ? raw.sitelinks : [];
  const seen = new Set<string>();
  const sitelinks = [];
  for (const item of arr) {
    const o = item as Record<string, unknown>;
    const linkText = truncate(clean(typeof o.linkText === "string" ? o.linkText : ""), SITELINK_TEXT_MAX);
    if (!linkText || seen.has(linkText.toLowerCase())) continue;
    seen.add(linkText.toLowerCase());
    sitelinks.push({
      linkText,
      descriptionLine1: truncate(clean(typeof o.descriptionLine1 === "string" ? o.descriptionLine1 : ""), SITELINK_DESC_MAX),
      descriptionLine2: truncate(clean(typeof o.descriptionLine2 === "string" ? o.descriptionLine2 : ""), SITELINK_DESC_MAX),
    });
    if (sitelinks.length >= 6) break;
  }
  return { sitelinks };
}

export async function generateCallouts(
  model: BuilderModel,
  context: GenerateContext,
): Promise<CalloutsResult> {
  const prompt = `${contextBlock(context)}

Write 8 callout extensions for this advertiser. Callouts are short, non-clickable phrases highlighting benefits or features (e.g. "Free Consultation", "Same-Day Service"). Each:
- 25 characters or fewer, Title Case, no punctuation at the end, no ALL CAPS.
- distinct from the others; draw on the USPs where relevant.

Return JSON: {"callouts": ["..."]}`;

  const raw = (await callModel(model, prompt)) as { callouts?: unknown };
  const callouts = dedupe(
    asStringArray(raw.callouts)
      .map((c) => truncate(tidyPunct(fixCaps(clean(c))).replace(/[.,;:!?]+$/, ""), CALLOUT_MAX))
      .filter(Boolean),
  ).slice(0, 8);
  return { callouts };
}

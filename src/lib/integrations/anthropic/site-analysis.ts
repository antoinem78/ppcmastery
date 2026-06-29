// Website analysis for the Campaign Builder. Fetches the homepage (+ sitemap),
// extracts title/description/headings and same-domain links, then asks Claude to
// turn those raw signals into structured context: a business summary, suggested
// services + keyword seeds, and a curated list of REAL existing pages used for
// ad deep-linking and sitelinks. Reuses the portal Anthropic key; no new keys.
import Anthropic from "@anthropic-ai/sdk";
import { truncate, BUSINESS_TYPES } from "@/lib/adforge";
import { MODEL_IDS, type BuilderModel, type SiteAnalysis, type SitePage } from "@/lib/builder/contract";

const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML = 300_000; // chars
const MAX_CANDIDATES = 60;
const UA = "Mozilla/5.0 (compatible; PPCMasteryBot/1.0; +https://ppcmastery.ai)";

export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme); // throws on garbage — caller maps to a 400
}

const sameHost = (a: string, b: string) => a.replace(/^www\./, "") === b.replace(/^www\./, "");

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const stripTags = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, MAX_HTML);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

interface Signals {
  title: string;
  description: string;
  headings: string[];
  candidates: SitePage[]; // url + anchor-text label
}

function extractFromHtml(html: string, base: URL): Signals {
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "");
  const description =
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ?? [])[1] ??
    (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) ?? [])[1] ??
    "";
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((h) => h.length > 1 && h.length < 120)
    .slice(0, 25);

  const seen = new Set<string>();
  const candidates: SitePage[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let abs: URL;
    try {
      abs = new URL(m[1], base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol) || !sameHost(abs.hostname, base.hostname)) continue;
    const key = (abs.pathname + abs.search).replace(/\/$/, "") || "/";
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ url: abs.origin + abs.pathname, label: truncate(stripTags(m[2]), 40) });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return { title, description: decode(description), headings, candidates };
}

async function fetchSitemapPages(origin: string, host: string): Promise<string[]> {
  const xml = await fetchText(`${origin}/sitemap.xml`);
  if (!xml) return [];
  const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((m) => decode(m[1].trim()));
  const pages: string[] = [];
  for (const loc of locs) {
    try {
      const u = new URL(loc);
      if (sameHost(u.hostname, host) && !/\.xml$/i.test(u.pathname)) pages.push(u.origin + u.pathname);
    } catch {
      /* ignore */
    }
    if (pages.length >= MAX_CANDIDATES) break;
  }
  return pages;
}

const SYSTEM = `You analyse a business website and return structured advertising context. Output a single minified JSON object and nothing else — no markdown, no commentary.

Rules:
- summary: 1-2 plain sentences describing what the business does and who it serves.
- suggestedBusinessType: choose the single best-fitting id from the provided list, or "" if none fit.
- suggestedServices: 3-8 concrete services/products the business actually offers (from the page content), each a short noun phrase.
- keywordSeeds: 8-15 lower-case search terms a customer would type to find this business (no brackets/quotes, no duplicates).
- pages: up to 12 of the MOST USEFUL pages for advertising (services, pricing, booking/contact, key categories), chosen ONLY from the provided candidate URLs. For each: the exact url from the list, a label (<= 25 chars, human, Title Case, good as a sitelink), and a one-word category. Skip legal/privacy/login/cart pages.
- Use British English. Never invent a URL that is not in the candidate list.`;

function buildPrompt(base: URL, sig: Signals, sitemapUrls: string[], candidates: SitePage[]): string {
  const typeList = BUSINESS_TYPES.map((b) => `${b.id} (${b.label})`).join(", ");
  return `Website: ${base.origin}
Page title: ${sig.title || "(none)"}
Meta description: ${sig.description || "(none)"}
Headings: ${sig.headings.join(" | ") || "(none)"}

Business type ids to choose from: ${typeList}

Candidate pages (url — anchor text). Choose "pages" only from these urls:
${candidates.map((c) => `${c.url} — ${c.label}`).join("\n") || "(none found)"}
${sitemapUrls.length ? `\nAdditional sitemap URLs:\n${sitemapUrls.slice(0, 30).join("\n")}` : ""}

Return JSON: {"summary":"...","suggestedBusinessType":"...","suggestedServices":["..."],"keywordSeeds":["..."],"pages":[{"url":"...","label":"...","category":"..."}]}`;
}

export async function analyzeSite(model: BuilderModel, rawUrl: string): Promise<SiteAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");

  const base = normalizeUrl(rawUrl);
  const html = await fetchText(base.toString());
  const sig = extractFromHtml(html, base);
  const sitemapUrls = await fetchSitemapPages(base.origin, base.hostname);

  // Merge homepage links + sitemap into one candidate set (dedupe by path).
  const byPath = new Map<string, SitePage>();
  for (const p of sig.candidates) byPath.set(new URL(p.url).pathname.replace(/\/$/, "") || "/", p);
  for (const u of sitemapUrls) {
    const path = new URL(u).pathname.replace(/\/$/, "") || "/";
    if (!byPath.has(path)) byPath.set(path, { url: u, label: "" });
  }
  const candidates = [...byPath.values()].slice(0, MAX_CANDIDATES);
  const candidateUrls = new Set(candidates.map((c) => c.url));

  if (!html && candidates.length === 0) {
    throw new Error(`Could not read ${base.hostname}. Check the URL is public and reachable.`);
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL_IDS[model] ?? MODEL_IDS.opus,
    max_tokens: 1500,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(base, sig, sitemapUrls, candidates) }],
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Site analysis did not return JSON.");
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const validType = BUSINESS_TYPES.some((b) => b.id === raw.suggestedBusinessType) ? String(raw.suggestedBusinessType) : "";

  const pages: SitePage[] = (Array.isArray(raw.pages) ? raw.pages : [])
    .map((p) => p as Record<string, unknown>)
    .filter((p) => typeof p.url === "string" && candidateUrls.has(p.url))
    .map((p) => ({
      url: p.url as string,
      label: truncate(typeof p.label === "string" && p.label.trim() ? p.label.trim() : "Learn More", 25),
      category: typeof p.category === "string" ? p.category : undefined,
    }))
    .slice(0, 12);

  return {
    url: base.toString(),
    domain: base.hostname,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    suggestedBusinessType: validType,
    suggestedServices: strs(raw.suggestedServices).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    keywordSeeds: [...new Set(strs(raw.keywordSeeds).map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 15),
    pages,
  };
}

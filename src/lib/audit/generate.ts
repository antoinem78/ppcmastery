// Audit document orchestrator: findings -> account-type diagnosis -> LLM prose
// (artifact-values-only, British English, no em dashes) -> assembled .docx.
// Tables/exhibits are built in code from the findings; only prose is LLM.
import Anthropic from "@anthropic-ai/sdk";
import { entityConfig } from "@/lib/config";
import { extractFindings, type AuditFindings } from "./extract";
import { buildDocx, coverPage, h1, para, bullets, exhibit, type ExhibitColumn } from "./docx";
import type { Paragraph, Table } from "docx";

const MODEL = "claude-opus-4-8";

const stripLongDashes = (s: string) => s.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, "-");

interface Prose {
  executiveSummary: string;
  structureCommentary: string;
  networkCommentary: string;
  conversionCommentary: string;
  quickWins: string[];
  roadmap: string[];
  forecastNarrative: string;
}

const EMPTY_PROSE: Prose = {
  executiveSummary: "", structureCommentary: "", networkCommentary: "",
  conversionCommentary: "", quickWins: [], roadmap: [], forecastNarrative: "",
};

function factsBlock(f: AuditFindings): string {
  const money = (n: number, dp = 0) => new Intl.NumberFormat("en-GB", { style: "currency", currency: f.currency, maximumFractionDigits: dp }).format(n);
  const dec = (n: number, dp = 0) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: dp }).format(n);
  const t = f.totals;
  const wasted = f.junkTerms.reduce((s, x) => s + x.cost, 0);
  const lines = [
    `Account type: ${f.accountType}`,
    `Currency: ${f.currency}`,
    `Period: ${f.range.start} to ${f.range.end} (trailing 12 months)`,
    ``,
    `TOTALS: spend ${money(t.cost)}, ${dec(t.impressions)} impressions, ${dec(t.clicks)} clicks, CTR ${dec(t.ctr, 1)}%, avg CPC ${money(t.avgCpc, 2)}, ${dec(t.conversions, 1)} conversions, CPA ${money(t.cpa, 2)}${f.hasConversionValue ? `, conversion value ${money(t.convValue)}, ROAS ${dec(t.roas, 2)}x` : `, NO conversion value tracked`}`,
    ``,
    `TOP CAMPAIGNS (by spend):`,
    ...f.campaigns.slice(0, 8).map((c) => `- ${c.name} [${c.channel}]: spend ${money(c.cost)}, ${dec(c.conversions, 1)} conv, CPA ${money(c.cpa, 2)}`),
    ``,
    `NETWORK SPLIT (spend / conversions):`,
    ...f.network.map((n) => `- ${n.network}: ${money(n.cost)}, ${dec(n.conversions, 1)} conv`),
    ``,
    `CONVERSION ACTIONS: ${f.conversionActions.length ? f.conversionActions.slice(0, 8).map((a) => `${a.name} (${a.category}/${a.status}, ${dec(a.conversions, 1)} conv)`).join("; ") : "none configured"}`,
    `IMPRESSION SHARE (Search): ${dec(f.impressionShare.impressionShare, 1)}% | lost to rank ${dec(f.impressionShare.rankLost, 1)}% | lost to budget ${dec(f.impressionShare.budgetLost, 1)}%`,
    `WASTED SEARCH SPEND (top terms, 0 conversions): ${money(wasted)} across ${f.junkTerms.length} terms`,
    `ASSETS PRESENT: ${f.assets.length ? f.assets.join(", ") : "none detected"}`,
  ];
  return lines.join("\n");
}

const SYSTEM = (brand: string, type: string) =>
  `You are a senior Google Ads auditor at ${brand}, writing the prose for a formal client account audit. British English. Professional, specific, candid but constructive.

HARD RULES:
- Use ONLY the figures in the DATA block. Never invent or recompute a number, campaign name, or metric.
- Never use em dashes or en dashes. Use commas, full stops, or parentheses.
- This account is ${type === "ecommerce" ? "ECOMMERCE: frame everything around profitable revenue, ROAS, AOV and value-based bidding. Do NOT mention offline conversion tracking, GCLID-to-CRM, MQL/SQL or sales pipeline." : "LEAD GENERATION: frame everything around qualified leads/demos and cost per lead. Where conversion value or offline conversion tracking is missing, recommend implementing offline conversion tracking (OCT) and pipeline measurement."}
- The network split is often the most important finding: if non-Search networks (Search Partners, Display, cross-network) consume budget with weak conversions, call it out plainly.
- Be concrete and tie every recommendation to a figure in the data.

Return a single minified JSON object, no markdown:
{"executiveSummary":"2-3 short paragraphs","structureCommentary":"1-2 paragraphs on campaign structure","networkCommentary":"1-2 paragraphs on the network split","conversionCommentary":"1-2 paragraphs on conversion tracking (type-aware)","quickWins":["5-7 specific quick wins"],"roadmap":["4-6 strategic roadmap steps"],"forecastNarrative":"1 short paragraph framing the forecast as illustrative"}`;

async function writeProse(f: AuditFindings, brand: string): Promise<Prose> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return EMPTY_PROSE;
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 3500,
      thinking: { type: "adaptive" },
      system: SYSTEM(brand, f.accountType),
      messages: [{ role: "user", content: `DATA (use verbatim):\n\n${factsBlock(f)}` }],
    });
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
    const raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<Prose>;
    const str = (v: unknown) => (typeof v === "string" ? stripLongDashes(v) : "");
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(stripLongDashes) : []);
    return {
      executiveSummary: str(raw.executiveSummary),
      structureCommentary: str(raw.structureCommentary),
      networkCommentary: str(raw.networkCommentary),
      conversionCommentary: str(raw.conversionCommentary),
      quickWins: arr(raw.quickWins),
      roadmap: arr(raw.roadmap),
      forecastNarrative: str(raw.forecastNarrative),
    };
  } catch (e) {
    console.error("Audit prose generation failed (assembling with tables only):", e);
    return EMPTY_PROSE;
  }
}

const sanitize = (s: string) => s.replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim();

export async function generateAudit(customerId: string, company: string): Promise<{ buffer: Buffer; filename: string; accountType: string }> {
  const f = await extractFindings(customerId, company);
  const brand = entityConfig.brandName || "PPC Mastery";
  const prose = await writeProse(f, brand);

  const money = (n: number, dp = 0) => new Intl.NumberFormat("en-GB", { style: "currency", currency: f.currency, maximumFractionDigits: dp }).format(n);
  const dec = (n: number, dp = 0) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: dp }).format(n);
  const pct = (n: number) => `${dec(n, 1)}%`;
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const kids: (Paragraph | Table)[] = [];
  kids.push(...coverPage(brand, company, today));

  // Executive Summary
  kids.push(h1("Executive Summary"));
  if (prose.executiveSummary) prose.executiveSummary.split(/\n{2,}/).forEach((p) => kids.push(para(p)));
  else kids.push(para(`A 12 month review of the ${company} Google Ads account covering ${money(f.totals.cost)} of spend and ${dec(f.totals.conversions, 1)} conversions.`));

  // Account Overview + totals exhibit
  kids.push(h1("Account Overview"));
  const overviewCols: ExhibitColumn[] = [
    { header: "Metric", width: 50 }, { header: "Trailing 12 months", width: 50, align: "right" },
  ];
  const overviewRows: string[][] = [
    ["Spend", money(f.totals.cost)],
    ["Impressions", dec(f.totals.impressions)],
    ["Clicks", dec(f.totals.clicks)],
    ["CTR", pct(f.totals.ctr)],
    ["Average CPC", money(f.totals.avgCpc, 2)],
    ["Conversions", dec(f.totals.conversions, 1)],
    ["Cost per conversion", money(f.totals.cpa, 2)],
  ];
  if (f.hasConversionValue) {
    overviewRows.push(["Conversion value", money(f.totals.convValue)], ["ROAS", `${dec(f.totals.roas, 2)}x`]);
  }
  kids.push(...exhibit("Exhibit 1. Account totals", overviewCols, overviewRows));

  // Campaign structure
  kids.push(h1("Campaign Structure"));
  if (prose.structureCommentary) kids.push(para(prose.structureCommentary));
  if (f.campaigns.length) {
    kids.push(...exhibit(
      "Exhibit 2. Top campaigns by spend",
      [
        { header: "Campaign", width: 40 }, { header: "Channel", width: 18 },
        { header: "Spend", width: 14, align: "right" }, { header: "Conv", width: 14, align: "right" }, { header: "CPA", width: 14, align: "right" },
      ],
      f.campaigns.slice(0, 10).map((c) => [c.name, c.channel, money(c.cost), dec(c.conversions, 1), c.conversions > 0 ? money(c.cpa, 2) : "-"]),
    ));
  }

  // Network split (the key finding)
  if (f.network.length) {
    kids.push(h1("Network Split"));
    if (prose.networkCommentary) kids.push(para(prose.networkCommentary));
    kids.push(...exhibit(
      "Exhibit 3. Spend and conversions by network",
      [
        { header: "Network", width: 40 }, { header: "Spend", width: 20, align: "right" },
        { header: "Clicks", width: 20, align: "right" }, { header: "Conv", width: 20, align: "right" },
      ],
      f.network.map((n) => [n.network, money(n.cost), dec(n.clicks), dec(n.conversions, 1)]),
    ));
  }

  // Conversion tracking
  kids.push(h1("Conversion Tracking"));
  if (prose.conversionCommentary) kids.push(para(prose.conversionCommentary));
  if (f.conversionActions.length) {
    kids.push(...exhibit(
      "Exhibit 4. Conversion actions",
      [
        { header: "Action", width: 46 }, { header: "Category", width: 22 },
        { header: "Status", width: 16 }, { header: "Conv", width: 16, align: "right" },
      ],
      f.conversionActions.slice(0, 12).map((a) => [a.name, a.category, a.status, dec(a.conversions, 1)]),
    ));
  } else {
    kids.push(para("No conversion actions were detected, which means performance cannot be optimised toward business outcomes. This is the first priority to resolve."));
  }

  // Impression share
  kids.push(h1("Impression Share (Search)"));
  kids.push(para("Note: the Google Ads API does not expose the Auction Insights competitor report, so this covers impression share and the share lost to rank and budget only."));
  kids.push(...exhibit(
    "Exhibit 5. Search impression share",
    [{ header: "Metric", width: 60 }, { header: "Value", width: 40, align: "right" }],
    [
      ["Search impression share", pct(f.impressionShare.impressionShare)],
      ["Lost to Ad Rank", pct(f.impressionShare.rankLost)],
      ["Lost to budget", pct(f.impressionShare.budgetLost)],
    ],
  ));

  // Search terms / wasted spend
  if (f.junkTerms.length) {
    kids.push(h1("Search Terms and Wasted Spend"));
    const wasted = f.junkTerms.reduce((s, x) => s + x.cost, 0);
    kids.push(para(`Across the top search terms, ${money(wasted)} was spent on ${f.junkTerms.length} terms that drove zero conversions. These are immediate negative-keyword candidates.`));
    kids.push(...exhibit(
      "Exhibit 6. Top non-converting search terms",
      [{ header: "Search term", width: 60 }, { header: "Spend", width: 20, align: "right" }, { header: "Clicks", width: 20, align: "right" }],
      f.junkTerms.map((x) => [x.term, money(x.cost), dec(x.clicks)]),
    ));
  }

  // Quick wins
  if (prose.quickWins.length) {
    kids.push(h1("Quick Wins"));
    kids.push(...bullets(prose.quickWins));
  }

  // Roadmap
  if (prose.roadmap.length) {
    kids.push(h1(f.accountType === "ecommerce" ? "Measurement and Value Based Bidding Roadmap" : "Conversion Tracking and Growth Roadmap"));
    kids.push(...bullets(prose.roadmap));
  }

  // Forecast (illustrative, type-aware)
  kids.push(h1("Illustrative Forecast"));
  if (prose.forecastNarrative) kids.push(para(prose.forecastNarrative));
  const monthlySpend = f.totals.cost / 12;
  const monthlyConv = f.totals.conversions / 12;
  if (f.accountType === "ecommerce" && f.hasConversionValue) {
    const monthlyRev = f.totals.convValue / 12;
    kids.push(...exhibit(
      "Exhibit 7. Monthly run rate vs an optimised target (illustrative)",
      [{ header: "Metric", width: 40 }, { header: "Current/mo", width: 30, align: "right" }, { header: "Target/mo", width: 30, align: "right" }],
      [
        ["Spend", money(monthlySpend), money(monthlySpend)],
        ["Revenue", money(monthlyRev), money(monthlyRev * 1.2)],
        ["ROAS", `${dec(f.totals.roas, 2)}x`, `${dec(f.totals.roas * 1.2, 2)}x`],
      ],
    ));
  } else {
    kids.push(...exhibit(
      "Exhibit 7. Monthly run rate vs an optimised target (illustrative)",
      [{ header: "Metric", width: 40 }, { header: "Current/mo", width: 30, align: "right" }, { header: "Target/mo", width: 30, align: "right" }],
      [
        ["Spend", money(monthlySpend), money(monthlySpend)],
        ["Conversions", dec(monthlyConv, 1), dec(monthlyConv * 1.25, 1)],
        ["Cost per conversion", f.totals.cpa > 0 ? money(f.totals.cpa, 2) : "-", f.totals.cpa > 0 ? money(f.totals.cpa * 0.8, 2) : "-"],
      ],
    ));
  }

  // Appendix — about the agency (partner claim only if configured)
  kids.push(h1(`About ${brand}`));
  const claim = entityConfig.partnerClaim
    ? `${brand} is a ${entityConfig.partnerClaim}. `
    : `${brand} is a team of certified Google Ads specialists. `;
  kids.push(para(`${claim}This audit was prepared from a read-only review of the account over the trailing 12 months. All figures are taken directly from the Google Ads API.`));

  const buffer = await buildDocx(brand, kids);
  const filename = `${sanitize(company) || "Account"} Google Ads Audit ${new Date().toISOString().slice(0, 10)}.docx`;
  return { buffer, filename, accountType: f.accountType };
}

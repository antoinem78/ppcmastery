// Meta Ads audit (.docx) — Bernard's downloadable deliverable. Reads the account
// live (read-only Graph calls), has Bernard's model write the audit narrative
// from that ground truth, and renders it with the house docx helpers, so the
// Meta audit and the Google Ads audit look like the same firm produced them.
import Anthropic from "@anthropic-ai/sdk";
import { Paragraph, Table, TextRun } from "docx";
import { getMetaAuditData, normalizeActId } from "@/lib/integrations/meta";
import { entityConfig } from "@/lib/config";
import { coverPage, h1, h2, para, bullets, exhibit, buildDocx, type ExhibitColumn } from "@/lib/audit/docx";

const MODEL = "claude-fable-5";
const FALLBACK_MODEL = "claude-opus-4-8";
const DOC_TITLE = "Meta Ads Account Audit";

const NARRATIVE_SYSTEM = `You are a senior Meta Ads media buyer writing a full account audit for the account owner. You are given the account's real data (read live from the account) as JSON.

RULES:
- Every figure, name, date and percentage must come from the DATA. Never invent, estimate or extrapolate a number. If a section of the data carries an "error" field, say that part could not be read and move on.
- Use the account's own currency for money figures.
- Do not mention APIs, tokens, JSON, tools, or how the data was obtained. This reads as a hands-on account review.
- No em dashes anywhere; use commas, colons or plain hyphens.
- Write in clear professional British English, direct and specific, no filler. Keep the whole document to roughly 1,200-1,800 words.
- The daily trend may arrive in weekly buckets on longer windows; describe pacing at that granularity.

OUTPUT: Markdown only, using exactly this structure:
## Executive Summary
(3-5 sentences: state of the account, headline numbers, the core problems)
## Account Snapshot
(a bullet list: account name, status, currency, timezone, lifetime spend, structure counts)
## Performance: Last Period vs Prior
(a markdown table of the key metrics current vs previous with change, then 2-3 sentences of interpretation; call out pacing or delivery anomalies visible in the daily trend)
## Structure and Settings Review
(campaigns and ad sets: objectives, budgets, bid strategies, statuses, learning phase, targeting breadth; what is sound and what is not)
## Tracking and Signals
(pixel presence and last fire, conversion signal quality, anything that undermines optimisation)
## Key Findings
(numbered list, most important first; each finding one bold title sentence then evidence with figures)
## Recommendations
(numbered, prioritised, each actionable and tied to a finding)
## First 30 Days
(a short week-by-week action plan)`;

/** Minimal markdown to docx using the house look: headings, bullets, numbered
 *  items and pipe tables. Deliberately small and predictable, since the
 *  narrative prompt fixes the structure. */
export function markdownToDocx(md: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  const strip = (s: string) => s.replace(/\*\*/g, "").trim();
  let i = 0;
  let pendingBullets: string[] = [];
  const flushBullets = () => {
    if (pendingBullets.length) { out.push(...bullets(pendingBullets)); pendingBullets = []; }
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { flushBullets(); i++; continue; }

    // Pipe table block.
    if (line.startsWith("|")) {
      flushBullets();
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { block.push(lines[i].trim()); i++; }
      const parse = (row: string) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(strip);
      const header = parse(block[0]);
      const rows = block.slice(block[1]?.match(/^\|[\s:-]+\|/) ? 2 : 1).map(parse);
      const width = Math.floor(100 / Math.max(1, header.length));
      const columns: ExhibitColumn[] = header.map((h, idx) => ({ header: h, width, align: idx === 0 ? "left" : "right" }));
      out.push(...exhibit("", columns, rows));
      continue;
    }

    if (line.startsWith("### ")) { flushBullets(); out.push(h2(strip(line.slice(4)))); }
    else if (line.startsWith("## ")) { flushBullets(); out.push(h1(strip(line.slice(3)))); }
    else if (line.startsWith("# ")) { flushBullets(); out.push(h1(strip(line.slice(2)))); }
    else if (/^[-*] /.test(line)) pendingBullets.push(strip(line.slice(2)));
    else if (/^\d+[.)] /.test(line)) { flushBullets(); out.push(numberedItem(line)); }
    else { flushBullets(); out.push(para(strip(line))); }
    i++;
  }
  flushBullets();
  return out;
}

/** A numbered finding: the leading number stays visible (the narrative relies on
 *  "finding 3" cross-references), with the bold lead sentence preserved. */
function numberedItem(line: string): Paragraph {
  const m = line.match(/^(\d+)[.)]\s*(.*)$/);
  const n = m?.[1] ?? "";
  const rest = m?.[2] ?? line;
  const parts = rest.split(/\*\*(.+?)\*\*/g).filter((p) => p.length > 0);
  return new Paragraph({
    spacing: { after: 120 },
    indent: { left: 240, hanging: 240 },
    children: [
      new TextRun({ text: `${n}. `, bold: true, size: 22, color: "1F2937" }),
      ...parts.map((p, idx) => new TextRun({ text: p, bold: idx % 2 === 1, size: 22, color: "1F2937" })),
    ],
  });
}

export interface MetaAuditResult {
  buffer: Buffer;
  accountName: string;
}

export async function generateMetaAudit(accountRef: string, days = 30): Promise<MetaAuditResult> {
  const { digits } = normalizeActId(accountRef);
  const data = await getMetaAuditData(digits, days);
  const accountObj = data.account as Record<string, unknown>;
  if (accountObj.error) {
    throw new Error(`Could not read account ${digits}: ${String(accountObj.error)}`);
  }
  const accountName = typeof accountObj.name === "string" && accountObj.name ? accountObj.name : `Account ${digits}`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured, so the audit narrative cannot be written.");
  const client = new Anthropic({ apiKey });
  // Streamed so long generations cannot trip response timeouts; generous
  // max_tokens because Fable 5's (always-on) thinking spends from the same
  // budget as the visible text.
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: FALLBACK_MODEL }],
    system: NARRATIVE_SYSTEM,
    messages: [{ role: "user", content: `DATA:\n${JSON.stringify(data)}` }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") {
    throw new Error("The audit narrative was declined by a safety check. Try again.");
  }
  const md = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!md) throw new Error(`The audit narrative came back empty (stop reason: ${msg.stop_reason}). Try again.`);

  const brand = entityConfig.brandName || "PPC Mastery";
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const children: (Paragraph | Table)[] = [
    ...coverPage(brand, accountName, dateStr, DOC_TITLE),
    para(`Ad account ${digits}. Review window: the last ${days} days against the prior ${days}.`),
    ...markdownToDocx(md),
  ];

  return { buffer: await buildDocx(brand, children, DOC_TITLE), accountName };
}

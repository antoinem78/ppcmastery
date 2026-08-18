// Meta Ads audit (.docx) — Bernard's downloadable deliverable. Reads the account
// live (read-only Graph calls), has Bernard's model write the audit narrative
// from that ground truth, and renders it with the house docx helpers, so the
// Meta audit and the Google Ads audit look like the same firm produced them.
import Anthropic from "@anthropic-ai/sdk";
import { Paragraph, Table, TextRun } from "docx";
import { getMetaAuditData, normalizeActId } from "@/lib/integrations/meta";
import { getDeepAuditData, isErr } from "@/lib/integrations/meta/audit-deep";
import { detectFindings, detectStrengths, totalAtStake, type Finding } from "@/lib/audit/meta-findings";
import { entityConfig } from "@/lib/config";
import { coverPage, h1, h2, para, bullets, exhibit, buildDocx, type ExhibitColumn } from "@/lib/audit/docx";

const MODEL = "claude-fable-5";
const FALLBACK_MODEL = "claude-opus-4-8";
const DOC_TITLE = "Meta Ads Account Audit";

// The findings are computed in code before the model is called (see
// meta-findings.ts). The model's job is to write them up, in order, without
// discovering anything of its own. That is the whole difference between this
// and a generic "here is some JSON, find the problems" audit.
const NARRATIVE_SYSTEM = `You are a senior Meta Ads media buyer writing a full account audit for the account owner, in the owner's own voice as the person who did the work.

You are given three things: the account's headline numbers, a list of VERIFIED FINDINGS already established from the account's data, and a list of things checked and found sound.

HARD RULES:
- The VERIFIED FINDINGS are the audit. Write every one of them up, in the order given. Do not add findings of your own, do not merge them, do not drop any.
- Never state a number that is not in the material you were given. Do not estimate, extrapolate, round differently, or infer a figure. If you want to say something you cannot source, leave it out.
- Never claim something is missing or absent unless a finding says so explicitly. A section that could not be read is not evidence of absence.
- Do not mention APIs, tokens, JSON, tools, agents, or how the data was obtained. This reads as a hands-on account review.
- No em dashes anywhere. Use commas, colons, full stops or plain hyphens.
- First person singular where you refer to yourself: I, me, my. Never "we", "us" or "our".
- Write in clear professional British English. Direct and specific. No filler, no throat-clearing, no "in today's competitive landscape".

STRUCTURE (markdown only, exactly these headings):
## Executive Summary
(4-6 sentences: the state of the account, the headline numbers, and the two or three things costing the most. Name the money at stake if it is given.)
## Account Snapshot
(bullet list: name, currency, lifetime spend, structure counts, review window)
## Performance
(a markdown table of the headline metrics, then 3-4 sentences of interpretation including the trend across months if given)
## What Is Already Right
(bullet list from the "checked and sound" material. This section matters: an audit that only lists faults is not a review, it is a pitch.)
## Findings
(one ### sub-heading per verified finding, in the order given, using the finding's title. Under each: the headline sentence, then the evidence as a bullet list, then a short paragraph on why it matters commercially. Use the finding's own figures verbatim.)
## Recommendations
(numbered, prioritised, one per finding, each tied to its finding by name and each stating what changes and what it is expected to do)
## The First 30 Days
(week by week, sequenced so that each step depends on the one before it. Say plainly which step unlocks the others.)
## What I Need From You
(short bullet list: access, assets or decisions required, only where a finding implies one)`;

function findingsBrief(findings: Finding[], currency: string): string {
  return findings.map((f, i) => [
    `FINDING ${i + 1} [${f.severity}] ${f.title}`,
    `  headline: ${f.headline}`,
    ...f.evidence.map((e) => `  evidence: ${e}`),
    f.moneyAtStake ? `  money at stake: ${Math.round(f.moneyAtStake).toLocaleString("en-GB")} ${currency} per 30 days` : "  money at stake: not directly quantifiable",
    `  recommendation: ${f.recommendation}`,
  ].join("\n")).join("\n\n");
}

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
  // The shallow read carries the settings picture, the deep read carries the
  // breakdowns and library the detectors need. The deep read is allowed to
  // fail without taking the audit down with it.
  const [data, deep] = await Promise.all([
    getMetaAuditData(digits, days),
    getDeepAuditData(digits, days).catch((e: unknown) => {
      console.error(`[meta-audit] ${digits} deep read failed:`, e);
      return null;
    }),
  ]);
  const accountObj = data.account as Record<string, unknown>;
  if (accountObj.error) {
    throw new Error(`Could not read account ${digits}: ${String(accountObj.error)}`);
  }
  const accountName = typeof accountObj.name === "string" && accountObj.name ? accountObj.name : `Account ${digits}`;

  const findings = deep ? detectFindings(deep) : [];
  const strengths = deep ? detectStrengths(deep) : [];
  const atStake = totalAtStake(findings);
  console.log(`[meta-audit] ${digits} findings=${findings.length} (${findings.map((f) => f.id).join(",")}) atStake=${Math.round(atStake)}`);

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
    messages: [{
      role: "user", content: [
        findings.length
          ? `VERIFIED FINDINGS (${findings.length}). These are established from the account's data. Write up every one, in this order.\n\n${findingsBrief(findings, deep?.currency ?? "")}`
          : "VERIFIED FINDINGS: none cleared the detection thresholds. Say so plainly in the Findings section rather than inventing problems, and keep the audit to the performance read.",
        atStake > 0
          ? `\nTOTAL MEASURED WASTE: roughly ${Math.round(atStake).toLocaleString("en-GB")} ${deep?.currency ?? ""} per 30 days across the findings that could be priced. You may quote this figure.`
          : "",
        strengths.length ? `\nCHECKED AND SOUND (use for the "What Is Already Right" section):\n${strengths.map((s) => `- ${s}`).join("\n")}` : "",
        `\nACCOUNT DATA (for the snapshot and performance sections only, do not mine it for new findings):\n${JSON.stringify(data)}`,
        deep && !isErr(deep.monthly) && deep.monthly.length
          ? `\nMONTHLY TREND:\n${deep.monthly.map((m) => `${m.month}: spend ${Math.round(m.spend)}, purchases ${m.purchases}, revenue ${Math.round(m.revenue)}, ROAS ${m.roas.toFixed(2)}, link CTR ${m.linkCtr.toFixed(2)}%`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n"),
    }],
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

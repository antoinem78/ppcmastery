// LLM-worded weekly narrative — the Swydo report standard, wrapped in a warm
// email (greeting + sign-off) because the message carries the portal link; the
// visual tiles/tables live on the dashboard. The figures are ALL computed in the
// data layer (reporting.ts); Claude only turns the verified facts into prose. It
// never computes or invents a number.
//
// Gated on ANTHROPIC_API_KEY — without it, callers fall back to the bulleted
// template (generateWeeklyReport.text).
import Anthropic from "@anthropic-ai/sdk";
import { entityConfig } from "@/lib/config";
import type { DashboardPayload, Kpi } from "../google-ads/reporting";

const MODEL = "claude-opus-4-8";

// Hard backstop on top of the prompt rule: strip any long dashes the model
// still slips in. Em dash -> comma, en dash -> hyphen. No "—"/"–" ever reaches
// a client report.
function stripLongDashes(s: string): string {
  // Catch every long-dash variant, not just em/en: em (—), horizontal bar (―),
  // en (–), figure dash (‒), and the minus sign (−). Em-like -> comma; the
  // shorter ones -> hyphen. No long dash ever reaches a client report.
  return s.replace(/\s*[—―]\s*/g, ", ").replace(/\s*[–‒−]\s*/g, "-");
}

function deltaPhrase(k: Kpi): string {
  if (k.deltaPct == null) return "no prior-period baseline";
  const dir = k.deltaPct >= 0 ? "up" : "down";
  return `${dir} ${Math.abs(k.deltaPct).toFixed(0)}% vs the prior period`;
}

// "Jun 8 – 14, 2026" / "Jun 28 – Jul 4, 2026" / cross-year fully qualified.
function prettyRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const mon = (d: Date) => d.toLocaleString("en-US", { timeZone: "UTC", month: "short" });
  const dd = (d: Date) => d.getUTCDate();
  const yy = (d: Date) => d.getUTCFullYear();
  // "to", never a dash (no em/en dashes anywhere in reports).
  if (yy(s) === yy(e) && mon(s) === mon(e)) return `${mon(s)} ${dd(s)} to ${dd(e)}, ${yy(e)}`;
  if (yy(s) === yy(e)) return `${mon(s)} ${dd(s)} to ${mon(e)} ${dd(e)}, ${yy(e)}`;
  return `${mon(s)} ${dd(s)}, ${yy(s)} to ${mon(e)} ${dd(e)}, ${yy(e)}`;
}

function firstName(contactName?: string | null): string {
  const n = (contactName ?? "").trim().split(/\s+/)[0];
  return n || "there";
}

// Turn the verified payload into a compact, unambiguous facts block. Every
// number Claude may use appears here, pre-formatted — so it copies, never computes.
function factsBlock(
  p: DashboardPayload,
  companyName: string,
  optimisations: string[],
  contactName?: string | null,
): string {
  const money = (n: number, dp = 0) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: p.currency,
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }).format(n);
  const dec = (n: number, dp = 1) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: dp }).format(n);
  const k = p.kpis;
  const guard = p.hasConversionValue;

  const lines: string[] = [
    `Greeting first name: ${firstName(contactName)}`,
    `Report title: ${companyName} Google Ads Report`,
    `Currency: ${p.currency}`,
    `Period: ${prettyRange(p.range.start, p.range.end)} compared to ${prettyRange(p.prevRange.start, p.prevRange.end)}`,
    `Scope: ALL campaign types (Search, Performance Max, Demand Gen, Shopping, etc.). Removed campaigns excluded.`,
    ``,
    `SCORECARD (this period vs prior period):`,
    `- Impressions: ${dec(k.impressions.value, 0)} (${deltaPhrase(k.impressions)})`,
    `- Clicks: ${dec(k.clicks.value, 0)} (${deltaPhrase(k.clicks)})`,
    `- CTR: ${dec(k.ctr.value)}% (${deltaPhrase(k.ctr)})`,
    `- Avg CPC: ${money(k.avgCpc.value, 2)} (${deltaPhrase(k.avgCpc)})`,
    `- Cost: ${money(k.spend.value)} (${deltaPhrase(k.spend)})`,
    `- Conversions (interaction date): ${dec(k.conversions.value)} (${deltaPhrase(k.conversions)})`,
    `- Cost per conversion: ${money(k.costPerConv.value, 2)} (${deltaPhrase(k.costPerConv)})`,
    `- Conversion rate: ${dec(k.convRate.value)}% (${deltaPhrase(k.convRate)})`,
    `- Search impression share: ${dec(k.searchImprShare.value)}% (SEARCH CAMPAIGNS ONLY)`,
  ];

  if (guard) {
    lines.push(
      `- Conversion value (interaction date): ${money(k.convValue.value)} (${deltaPhrase(k.convValue)})`,
      `- ROAS (interaction date): ${dec(k.roas.value, 2)}x (${deltaPhrase(k.roas)})`,
      `- Average order value: ${money(k.aov.value, 2)} (${deltaPhrase(k.aov)})`,
    );
  } else {
    lines.push(
      `- NOTE: this account does not track conversion value — do NOT mention revenue, ROAS or AOV.`,
    );
  }

  lines.push(
    ``,
    `BY-TIME (conversion-date basis — what occurred in the period; interaction-date matures later, so show both):`,
    `- Conversions by conversion date: ${dec(k.conversionsByTime.value)} (${deltaPhrase(k.conversionsByTime)})`,
  );
  if (guard) {
    lines.push(
      `- Conversion value by conversion date: ${money(k.convValueByTime.value)} (${deltaPhrase(k.convValueByTime)})`,
      `- ROAS by conversion date: ${dec(k.roasByTime.value, 2)}x (${deltaPhrase(k.roasByTime)})`,
    );
  }
  lines.push(
    `- Avg conversions/day: ${dec(p.avgOrdersPerDay, 1)}${guard ? `, avg value/day: ${money(p.avgRevenuePerDay)}` : ""}`,
  );

  const byChannel = p.byChannel ?? [];
  if (byChannel.length > 1) {
    lines.push(``, `BY CHANNEL TYPE (spend / conversions):`);
    for (const c of byChannel) {
      lines.push(`- ${c.channel}: spend ${money(c.spend)}, ${dec(c.conversions)} conversions, ${money(c.costPerConv, 2)}/conv`);
    }
  }

  const ch = (c: { channel?: string }) => (c.channel ? ` [${c.channel}]` : "");
  const converting = p.byCampaign
    .filter((c) => c.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 5);
  const val = (c: { roas: number; spend: number }) => c.roas * c.spend; // convValue = ROAS * spend
  const roasBit = (c: { roas: number; spend: number }) => (guard ? `, value ${money(val(c))}, ROAS ${dec(c.roas, 2)}x` : "");
  if (converting.length) {
    lines.push(``, `TOP CONVERTING CAMPAIGNS (by conversions; channel in brackets):`);
    for (const c of converting) {
      lines.push(`- ${c.name}${ch(c)}: ${dec(c.conversions)} conversions, spend ${money(c.spend)}, ${money(c.costPerConv, 2)}/conv${roasBit(c)}`);
    }
  } else {
    lines.push(``, `TOP CONVERTING CAMPAIGNS: none recorded a conversion this period.`);
  }

  // When value is tracked, the standout is judged by VALUE/ROAS, not conv count.
  if (guard) {
    const byValue = [...p.byCampaign].filter((c) => val(c) > 0).sort((a, b) => val(b) - val(a)).slice(0, 5);
    if (byValue.length) {
      lines.push(``, `TOP CAMPAIGNS BY CONVERSION VALUE (the true standout ranking when value is tracked):`);
      for (const c of byValue) {
        lines.push(`- ${c.name}${ch(c)}: value ${money(val(c))}, ROAS ${dec(c.roas, 2)}x, ${dec(c.conversions)} conversions, spend ${money(c.spend)}`);
      }
    }
  }

  if (p.byCampaign.length) {
    lines.push(``, `TOP CAMPAIGNS (by spend; channel in brackets):`);
    for (const c of p.byCampaign.slice(0, 8)) {
      lines.push(`- ${c.name}${ch(c)}: spend ${money(c.spend)}, ${dec(c.conversions)} conversions, ${money(c.costPerConv, 2)}/conv${roasBit(c)}`);
    }
  }

  const actions = p.byConversionAction ?? [];
  if (actions.length) {
    lines.push(``, `CONVERSIONS BY ACTION (account-wide):`);
    for (const a of actions.slice(0, 10)) {
      lines.push(`- ${a.action}: ${dec(a.conversions)} conversions${guard ? `, value ${money(a.value)}` : ""}`);
    }
  }

  if (p.topSearchTerms.length) {
    lines.push(``, `TOP SEARCH TERMS (by spend; SEARCH CAMPAIGNS ONLY):`);
    for (const t of p.topSearchTerms.slice(0, 6)) {
      lines.push(`- "${t.term}": spend ${money(t.spend)}, ${dec(t.conversions)} conversions`);
    }
  }

  if (p.byDevice.length) {
    lines.push(``, `DEVICE SPLIT (spend): ${p.byDevice.map((d) => `${d.device} ${money(d.spend)}`).join(", ")}`);
  }

  const topOpt = optimisations.slice(0, 15);
  const overflow = optimisations.length - topOpt.length;
  lines.push(
    ``,
    `OPTIMISATIONS MADE THIS PERIOD (verified change log — campaign [channel] — action (count); ranked by volume):`,
    optimisations.length ? topOpt.map((l) => `- ${l}`).join("\n") : `- No account changes were logged this period.`,
  );
  if (overflow > 0) lines.push(`- (plus ${overflow} further minor changes)`);

  return lines.join("\n");
}

const BOILERPLATE_OPTIMISATION =
  "Regular account optimisations including bid management, adding new keywords from search terms, adding new negative keywords, resolving ad split tests, creating new ads for split-testing purposes, improving underperforming assets, creating new ad groups for top converting search terms.";

const SYSTEM = (brand: string, cadence: "weekly" | "monthly", accountPrompt?: string | null) =>
  `You are a senior paid-search account manager at ${brand}, writing the ${cadence} performance update that goes to a client. It is a Swydo-style report wrapped in a warm, professional email, the email carries a link to the client's dashboard, where the full visual tiles and tables live.

Voice: warm, professional, specific — an experienced human analyst, not a robot. Plain language a business owner understands.

HARD RULES:
- PUNCTUATION: never use em dashes or en dashes (the long dashes "—" / "–") anywhere. They read as machine-written. Use a comma, a full stop, or parentheses instead, and write a normal hyphen only inside compound words. This matters.
- Use ONLY the figures in the DATA block. Never invent, estimate, or recompute a number, a percentage, a campaign name, or a metric not present in the data.
- Quote figures exactly as given (same currency, same rounding).
- Show BOTH conversion bases where present: interaction-date in the scorecard and the By-Time (conversion-date) lines — always include the By-Time lines that appear in the data, and mention attribution (by-time matures later) in the Summary.
- CHANNELS: the account spans multiple campaign types; the headline figures are ACCOUNT-WIDE. Only Search campaigns have "keywords" and "search terms" — for Performance Max / Demand Gen / Shopping talk about assets, audiences, product/listing groups. Never call a change tagged "[Performance Max]" or "[Demand Gen]" a Search change, and never call product/listing groups "keywords".
- Anything labelled "SEARCH CAMPAIGNS ONLY" (search impression share, search terms) covers only Search — never present it as account-wide.
- If conversion-value tracking is absent, never mention revenue, ROAS or AOV.
- STANDOUT / MOST EFFICIENT: when conversion value IS tracked, judge the best performer by conversion VALUE and ROAS, never by conversion count or cost per conversion. A campaign with many cheap conversions but low value is NOT the standout. Use the "TOP CAMPAIGNS BY CONVERSION VALUE" list for this. Only when value is not tracked do you rank by conversions and cost per conversion.
- NEVER fabricate old→new budget or Target-CPA values, month-to-date spend, or targets — we do not have them.
- Optimisations: describe ONLY the changes in the change log, respecting campaign name AND channel. You may add a brief, conservative rationale, but never claim a specific result or number not in the data.
- Keep it grounded. Quiet period or thin data → keep sections short; one honest line beats invented content. This is a DRAFT a human reviews before it reaches the client.

OUTPUT (Slack formatting: *bold* titles, "- " bullets only in list sections, no #, no tables):

Hi <greeting first name>,
<one warm lead-in line pointing them to the dashboard for the full visual breakdown>

*<Report title>*
<period> compared to <prior period>

*Performance*
Scorecard bullets (impressions, clicks, CTR, avg CPC, cost, conversions, CPA, conv rate; + revenue/ROAS/AOV when tracked). ALWAYS include the By-Time lines present in the data.

*Summary*
Flowing prose: the headline movement WITH attribution (interaction vs conversion date), CPA / conversion-rate trends, the channel/segment mix, the standout campaign, and one forward-looking next step.

*Conversions by action*
A standalone short paragraph: the count (and value when tracked) per conversion action, and which actions drove the most conversions.

*Optimisations This Period*
Start with this verbatim line: "${BOILERPLATE_OPTIMISATION}" Then first-person specifics ("I have …") drawn only from the change log.

<warm close noting the full visual report is on their dashboard>
Best regards,
The ${brand} Team
${accountPrompt ? `\nACCOUNT-SPECIFIC GUIDANCE (from the account manager; follow it, but it never overrides the HARD RULES above):\n${accountPrompt}\n` : ""}
Write the update now.`;

export async function generateNarrative(
  payload: DashboardPayload,
  companyName: string,
  optimisations: string[] = [],
  contactName?: string | null,
  opts?: { accountPrompt?: string | null; cadence?: "weekly" | "monthly" },
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const brand = entityConfig.brandName || "PPC Mastery";
  const cadence = opts?.cadence ?? "weekly";
  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      system: SYSTEM(brand, cadence, opts?.accountPrompt),
      messages: [
        {
          role: "user",
          content: `DATA (verified — use these figures verbatim):\n\n${factsBlock(payload, companyName, optimisations, contactName)}`,
        },
      ],
    });
    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return stripLongDashes(raw) || null;
  } catch (e) {
    console.error("Narrative generation failed (falling back to template):", e);
    return null;
  }
}

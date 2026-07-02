// Read-only AI analyst for the Command Center. A tool-use loop over the live
// reporting layer: it can list accounts, pull a report, roll up all accounts,
// and read the recent change log. It can FILE a proposal (propose_optimization)
// but never executes anything itself. Figures come only from the tools.
import Anthropic from "@anthropic-ai/sdk";
import { entityConfig } from "@/lib/config";
import { listApprovedAccounts, getCommandCenter, type Roster } from "@/lib/command-center";
import { getDashboard, getWeeklyOptimisations } from "@/lib/integrations/google-ads/reporting";
import { gaqlSearch } from "@/lib/integrations/google-ads";
import { createProposal } from "@/lib/proposals";

const MODEL = "claude-opus-4-8";
const MAX_TURNS = 6;

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done" }
  | { type: "error"; text: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const TOOLS: Anthropic.Tool[] = [
  { name: "list_accounts", description: "List all managed Google Ads accounts (company name + client id).", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "get_account_report",
    description: "Full performance snapshot for one account (last complete week vs prior): KPIs, top campaigns, channel split, impression share.",
    input_schema: { type: "object", properties: { clientId: { type: "string" } }, required: ["clientId"], additionalProperties: false },
  },
  { name: "get_all_account_summaries", description: "Cross-account roll-up: per-currency totals, open alerts, and each account's week-over-week summary. Use this to find accounts needing attention.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "get_recent_changes",
    description: "The logged optimisation/change history for one account over the last N days (max 30; Google only exposes the last 30 days of changes).",
    input_schema: { type: "object", properties: { clientId: { type: "string" }, days: { type: "integer" } }, required: ["clientId"], additionalProperties: false },
  },
  {
    name: "list_campaigns",
    description: "List an account's campaigns (ALL statuses, including PAUSED) with id, name, status and channel. Call this before proposing any campaign-level change so you can name the exact campaign.",
    input_schema: { type: "object", properties: { clientId: { type: "string" } }, required: ["clientId"], additionalProperties: false },
  },
  {
    name: "get_search_terms",
    description: "Real search-term (query) data for the account's SEARCH campaigns over the last N days (default 30, max 90). Returns the actual queries that triggered ads with cost, clicks and conversions, aggregated per query and sorted by spend. Use this to GROUND negative-keyword proposals in real wasted spend (high cost, zero/low conversions) instead of guessing. Only Search campaigns have search terms; PMax/Demand Gen/Shopping return nothing here.",
    input_schema: { type: "object", properties: { clientId: { type: "string" }, days: { type: "integer" } }, required: ["clientId"], additionalProperties: false },
  },
  {
    name: "propose_optimization",
    description: "File a structured optimisation proposal for human approval. You never execute changes; you propose them. For an executable proposal include `action` (one operation); otherwise it is advisory.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        type: { type: "string", description: "e.g. negative_keywords, budget, structure, bidding" },
        title: { type: "string" },
        rationale: { type: "string" },
        action: {
          type: "object",
          description: "Optional single executable operation.",
          properties: {
            kind: { type: "string", enum: ["add_negative_keyword", "pause_campaign", "set_campaign_budget", "add_shared_negative"] },
            campaign: { type: "string", description: "Exact campaign name. Required for add_negative_keyword, pause_campaign, set_campaign_budget. OMIT for add_shared_negative (it is account-level)." },
            text: { type: "string" },
            matchType: { type: "string", enum: ["EXACT", "PHRASE", "BROAD"] },
            dailyBudget: { type: "number" },
          },
          required: ["kind"],
        },
      },
      required: ["clientId", "type", "title", "rationale"],
      additionalProperties: false,
    },
  },
];

const SYSTEM = `You are a senior paid-search analyst at ${entityConfig.brandName || "the agency"}, working inside the agency Command Center. You help the team triage and understand their Google Ads accounts.

RULES:
- Use ONLY figures returned by the tools. Never invent or recompute a number, account, or campaign name. If you have not pulled the data, pull it before answering.
- Channel attribution matters: only Search campaigns have keywords and search terms; Performance Max / Demand Gen / Shopping use assets, audiences and listing groups. Never mislabel.
- You ANALYSE and PROPOSE. You never execute changes. To recommend a concrete change, file it with propose_optimization (include an 'action' for an executable one), then tell the user it is queued for their approval.
- GROUND NEGATIVE KEYWORDS IN REAL DATA: before proposing any negative keyword, call get_search_terms and cite the actual wasted queries (meaningful cost, zero or very low conversions). Never invent or assume a wasted query. If get_search_terms returns nothing, say so and do not fabricate one.
- EXECUTABLE ACTIONS need a real campaign: for pause_campaign, set_campaign_budget, or a campaign-level add_negative_keyword, FIRST call list_campaigns and put the EXACT campaign name (campaigns may be PAUSED, that is fine) in action.campaign. Never guess or leave it blank.
- ACCOUNT-LEVEL / SHARED negatives ARE executable now: use action.kind 'add_shared_negative' with just text + matchType (NO campaign). It adds the negative to the account's managed shared negative list and attaches that list to every Search campaign. Use this when a wasted query should be excluded across all Search campaigns. If instead the waste is confined to one campaign, use a campaign-level add_negative_keyword with the exact campaign name.
- Shared negatives only affect Search campaigns (PMax/Demand Gen/Shopping ignore keywords); say so if the account is mostly non-Search.
- Change history only covers the last 30 days (Google limit); do not ask for more.
- British English. Never use em dashes or en dashes. Be concise and specific; lead with the answer.`;

function statusFor(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "list_accounts": return "Listing accounts…";
    case "get_account_report": return "Pulling the account report…";
    case "get_all_account_summaries": return "Rolling up all accounts…";
    case "get_recent_changes": return "Reading the change log…";
    case "get_search_terms": return "Pulling real search-term data…";
    case "propose_optimization": return `Filing proposal: ${typeof input.title === "string" ? input.title : ""}…`;
    default: return "Working…";
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function runTool(name: string, input: Record<string, unknown>, roster: Roster[]): Promise<unknown> {
  const findAccount = (clientId: unknown) => roster.find((r) => r.clientId === clientId);

  switch (name) {
    case "list_accounts":
      return roster.map((r) => ({ clientId: r.clientId, company: r.company, customerId: r.reportingId }));

    case "get_account_report": {
      const acct = findAccount(input.clientId);
      if (!acct) return { error: "Unknown clientId. Call list_accounts first." };
      const d = await getDashboard(acct.clientId, acct.reportingId, "mon_sun");
      return {
        company: acct.company,
        currency: d.currency,
        range: d.range,
        kpis: {
          spend: d.kpis.spend.value, conversions: d.kpis.conversions.value, costPerConv: d.kpis.costPerConv.value,
          convValue: d.kpis.convValue.value, roas: d.kpis.roas.value, ctr: d.kpis.ctr.value,
          searchImprShare: d.kpis.searchImprShare.value,
          conversionsDeltaPct: d.kpis.conversions.deltaPct, spendDeltaPct: d.kpis.spend.deltaPct,
        },
        topCampaigns: d.byCampaign.slice(0, 6),
        byChannel: d.byChannel,
      };
    }

    case "get_all_account_summaries": {
      const cc = await getCommandCenter();
      return {
        totalsByCurrency: cc.totalsByCurrency,
        openAlerts: cc.openAlerts,
        accounts: cc.accounts.map((a) => ({
          clientId: a.clientId, company: a.company, currency: a.currency, status: a.status,
          spend: a.summary?.spend.value ?? null, conversions: a.summary?.conversions.value ?? null,
          conversionsDeltaPct: a.summary?.conversions.deltaPct ?? null,
          alerts: a.alerts.map((x) => x.message), error: a.error ?? null,
        })),
      };
    }

    case "list_campaigns": {
      const acct = findAccount(input.clientId);
      if (!acct) return { error: "Unknown clientId. Call list_accounts first." };
      const rows = await gaqlSearch(
        acct.reportingId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type
         FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.status`,
      );
      return rows.map((r) => {
        const c = (r.campaign ?? {}) as { id?: string | number; name?: string; status?: string; advertisingChannelType?: string };
        return { id: String(c.id ?? ""), name: c.name ?? "", status: c.status ?? "", channel: c.advertisingChannelType ?? "" };
      });
    }

    case "get_search_terms": {
      const acct = findAccount(input.clientId);
      if (!acct) return { error: "Unknown clientId. Call list_accounts first." };
      const days = typeof input.days === "number" && input.days > 0 ? Math.min(input.days, 90) : 30;
      const rows = await gaqlSearch(
        acct.reportingId,
        `SELECT search_term_view.search_term, campaign.name, campaign.advertising_channel_type,
                metrics.cost_micros, metrics.clicks, metrics.conversions
         FROM search_term_view
         WHERE segments.date DURING LAST_${days}_DAYS
           AND campaign.advertising_channel_type = 'SEARCH'
           AND metrics.cost_micros > 0
         ORDER BY metrics.cost_micros DESC
         LIMIT 500`,
      );
      // Aggregate per query across ad groups/campaigns so the analyst sees one
      // line per wasted query with total spend and which campaigns it hit.
      const agg = new Map<string, { term: string; cost: number; clicks: number; conversions: number; campaigns: Set<string> }>();
      for (const r of rows) {
        const term = ((r.searchTermView ?? {}) as { searchTerm?: string }).searchTerm ?? "";
        if (!term) continue;
        const m = (r.metrics ?? {}) as { costMicros?: string | number; clicks?: string | number; conversions?: number };
        const camp = ((r.campaign ?? {}) as { name?: string }).name ?? "";
        const e = agg.get(term) ?? { term, cost: 0, clicks: 0, conversions: 0, campaigns: new Set<string>() };
        e.cost += Number(m.costMicros ?? 0) / 1_000_000;
        e.clicks += Number(m.clicks ?? 0);
        e.conversions += Number(m.conversions ?? 0);
        if (camp) e.campaigns.add(camp);
        agg.set(term, e);
      }
      const terms = [...agg.values()]
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 60)
        .map((e) => ({ query: e.term, cost: Math.round(e.cost * 100) / 100, clicks: e.clicks, conversions: Math.round(e.conversions * 100) / 100, campaigns: [...e.campaigns] }));
      if (terms.length === 0) return { company: acct.company, days, note: "No Search search-term data for this period (the account may have no active Search campaigns).", terms: [] };
      return { company: acct.company, days, note: "Cost is in the account currency. 'conversions' near 0 with meaningful cost = negative-keyword candidate.", terms };
    }

    case "get_recent_changes": {
      const acct = findAccount(input.clientId);
      if (!acct) return { error: "Unknown clientId. Call list_accounts first." };
      const days = typeof input.days === "number" && input.days > 0 ? Math.min(input.days, 30) : 28;
      const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
      const changes = await getWeeklyOptimisations(acct.reportingId, ymd(start), ymd(end));
      return { company: acct.company, days, changes };
    }

    case "propose_optimization": {
      const acct = findAccount(input.clientId);
      if (!acct) return { error: "Unknown clientId. Call list_accounts first." };
      const action = input.action && typeof input.action === "object" ? { action: input.action } : {};
      const res = await createProposal({
        clientId: acct.clientId,
        type: String(input.type ?? "optimization"),
        title: String(input.title ?? "Optimisation"),
        rationale: String(input.rationale ?? ""),
        details: action,
        createdBy: "agent",
      });
      return "error" in res ? { error: res.error } : { ok: true, proposalId: res.id, note: "Filed for human approval." };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export async function runAgentChatStream(
  history: ChatMessage[],
  emit: (e: AgentEvent) => void,
  focusClientId?: string | null,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit({ type: "error", text: "AI is not configured (ANTHROPIC_API_KEY missing)." });
    emit({ type: "done" });
    return;
  }

  const client = new Anthropic({ apiKey });
  const roster = await listApprovedAccounts();
  const focus = focusClientId ? roster.find((r) => r.clientId === focusClientId) : undefined;
  const system = focus
    ? `${SYSTEM}\n\nFOCUS ACCOUNT: the user is working on ${focus.company} (clientId ${focus.clientId}). Treat questions as about this account unless they clearly name another. This thread may continue an earlier conversation about this account, so build on what was already discussed rather than re-introducing it.`
    : SYSTEM;
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (turn > 0) emit({ type: "reset" }); // drop the previous turn's tool preamble

      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        system,
        tools: TOOLS,
        messages,
      });
      stream.on("text", (t) => emit({ type: "delta", text: t }));
      const msg = await stream.finalMessage();
      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason !== "tool_use") {
        emit({ type: "done" });
        return;
      }

      const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        emit({ type: "status", text: statusFor(tu.name, tu.input as Record<string, unknown>) });
        let out: unknown;
        try {
          out = await runTool(tu.name, tu.input as Record<string, unknown>, roster);
        } catch (e) {
          out = { error: e instanceof Error ? e.message : "Tool failed." };
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
    }
    emit({ type: "done" });
  } catch (e) {
    emit({ type: "error", text: e instanceof Error ? e.message : "The assistant hit an error." });
    emit({ type: "done" });
  }
}

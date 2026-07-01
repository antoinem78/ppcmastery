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
            kind: { type: "string", enum: ["add_negative_keyword", "pause_campaign", "set_campaign_budget"] },
            campaign: { type: "string" },
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
- EXECUTABLE ACTIONS need a real campaign: for pause_campaign, set_campaign_budget, or a campaign-level add_negative_keyword, FIRST call list_campaigns and put the EXACT campaign name (campaigns may be PAUSED, that is fine) in action.campaign. Never guess or leave it blank.
- If you intend an ACCOUNT-LEVEL or shared negative (not tied to one campaign), do NOT attach an action; file it as an advisory proposal and say it needs a shared negative list. Only campaign-level single operations are executable today.
- Change history only covers the last 30 days (Google limit); do not ask for more.
- British English. Never use em dashes or en dashes. Be concise and specific; lead with the answer.`;

function statusFor(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "list_accounts": return "Listing accounts…";
    case "get_account_report": return "Pulling the account report…";
    case "get_all_account_summaries": return "Rolling up all accounts…";
    case "get_recent_changes": return "Reading the change log…";
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
      const d = await getDashboard(acct.clientId, acct.reportingId, 7);
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

export async function runAgentChatStream(history: ChatMessage[], emit: (e: AgentEvent) => void): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit({ type: "error", text: "AI is not configured (ANTHROPIC_API_KEY missing)." });
    emit({ type: "done" });
    return;
  }

  const client = new Anthropic({ apiKey });
  const roster = await listApprovedAccounts();
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (turn > 0) emit({ type: "reset" }); // drop the previous turn's tool preamble

      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
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

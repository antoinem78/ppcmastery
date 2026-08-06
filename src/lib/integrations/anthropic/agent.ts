// Oscar — the Google Ads analyst behind the Command Center chat. Claude Opus 4.8
// in a tool-use loop over the live data layer.
//
// What he can do, and the boundary in each case:
//   READ, MCC-wide. The roster is imported clients PLUS every leaf under this
//   deployment's MCC, so he can analyse any account the agency manages, by name
//   or by customer id. Proposals and audits still require an imported client.
//   PROPOSE. Structured, figure-backed cards for human approval.
//   EXECUTE, on the founder's explicit word only, through the SAME worker and
//   the SAME gates as the Proposals page (proposals-execute.ts). He never infers
//   authority, and he reports the worker's verdict rather than his own.
//   BUILD, likewise: GOOGLE_build creates a Search campaign atomically, always
//   PAUSED, behind the kill switch, the MCC boundary and the allowlist.
//   REMEMBER. Permanent cross-session memory (agent_memory, migration 0020).
//
// Ported from the app-wmi sibling and reconciled with this repo's write canon.
import Anthropic from "@anthropic-ai/sdk";
import { entityConfig } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { listApprovedAccounts, getCommandCenter } from "@/lib/command-center";
import { getDashboard, getDashboardForRange, getWeeklyOptimisations } from "@/lib/integrations/google-ads/reporting";
import { gaqlSearch, listManagedAccounts } from "@/lib/integrations/google-ads";
import { getFeedAudit } from "@/lib/integrations/google-ads/feed";
import { buildGoogleCampaign, type GoogleBuildSpec } from "@/lib/integrations/google-ads/build";
import { createProposal, decideProposal, listProposals, type ProposalStatus } from "@/lib/proposals";
import { applyProposal, dryRunProposal } from "@/lib/proposals-execute";
import {
  loadMemories,
  renderMemories,
  remember,
  reviseMemory,
  forgetMemory,
  MEMORY_KINDS,
  type MemoryKind,
} from "@/lib/agent-memory";
import { makeEmDashScrubber } from "@/lib/emdash";

const AGENT = "oscar";
const MODEL = "claude-opus-4-8";
const MAX_TURNS = 8;

// Bookkeeping tools run AFTER the answer is written, not before it, so any text
// streamed ahead of them is the reply itself and must survive the tool turn.
const BOOKKEEPING_TOOLS = new Set(["remember", "revise_memory", "forget"]);
const PREAMBLE_MAX_CHARS = 400;

/** True when the text streamed during a tool turn is throat-clearing rather
 *  than the answer. Only then is it safe to tell the client to discard it. */
function isPreamble(text: string, toolUses: { name: string }[]): boolean {
  if (toolUses.every((t) => BOOKKEEPING_TOOLS.has(t.name))) return false;
  return text.trim().length <= PREAMBLE_MAX_CHARS;
}

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "artifact"; text: string; label?: string }
  | { type: "done" }
  | { type: "error"; text: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ---- Account roster + resolution ----
interface RosterEntry {
  clientId: string | null;
  reportingId: string;
  company: string;
  imported: boolean;
}

/** MCC-wide READ roster: imported clients plus every leaf under the MCC.
 *  Non-imported accounts carry clientId null — reads work off the customer id,
 *  but proposals and audits need a client record.
 *
 *  ⚠️ REVIEW MODE STOPS AT THE IMPORTED CLIENTS. The reviewer deployment has its
 *  own empty database but shares the real MCC, so enumerating leaves here would
 *  read out live client account NAMES to an outside reviewer. That is the one
 *  data leak a fresh database cannot prevent, and it is why the MCC import
 *  surface is hidden there; the chat must hold the same line. */
async function loadRoster(): Promise<RosterEntry[]> {
  const roster: RosterEntry[] = (await listApprovedAccounts()).map((r) => ({
    clientId: r.clientId,
    reportingId: r.reportingId,
    company: r.company,
    imported: true,
  }));
  if (entityConfig.reviewMode) return roster;
  const seen = new Set(roster.map((r) => r.reportingId.replace(/\D/g, "")));
  try {
    for (const leaf of await listManagedAccounts()) {
      if (seen.has(leaf.id.replace(/\D/g, ""))) continue;
      roster.push({ clientId: null, reportingId: leaf.id, company: leaf.name || leaf.id, imported: false });
    }
  } catch {
    /* MCC enumeration is best-effort: fall back to imported clients only */
  }
  return roster;
}

/** Resolve an account by client id, Google customer id (dash-insensitive), or
 *  company name (exact, then substring). */
function resolveAccount(roster: RosterEntry[], ref: string): RosterEntry | null {
  const q = (ref ?? "").trim().toLowerCase();
  if (!q) return null;
  const byId = roster.find((r) => r.clientId === ref);
  if (byId) return byId;
  const digits = q.replace(/\D/g, "");
  if (digits) {
    const byCid = roster.find((r) => r.reportingId.replace(/\D/g, "") === digits);
    if (byCid) return byCid;
  }
  return (
    roster.find((r) => r.company.toLowerCase() === q) ??
    roster.find((r) => r.company.toLowerCase().includes(q)) ??
    null
  );
}

/** The dashboard for any roster entry: imported clients go through the cache,
 *  bare MCC accounts read live (the cache is keyed by client id). */
async function dashboardFor(acc: RosterEntry) {
  return acc.clientId
    ? getDashboard(acc.clientId, acc.reportingId, "mon_sun")
    : getDashboardForRange(acc.reportingId, "mon_sun");
}

function focusNote(roster: RosterEntry[], focusClientId?: string | null): string {
  if (!focusClientId) return "";
  const acc = roster.find((r) => r.clientId === focusClientId);
  if (!acc) return "";
  return `\n\nFOCUS ACCOUNT: the user is working on ${acc.company} (clientId ${acc.clientId}, Google customer id ${acc.reportingId}). Treat questions as about this account unless they clearly name another. Call tools with this account directly; you do not need to ask which account. This thread may continue an earlier conversation about this account, so build on what was already discussed rather than re-introducing it.`;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ---- Read tools ----
const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_accounts",
    description: "List every account you can see: imported clients AND every account under the agency MCC (company name, client id where imported, Google customer id). Use it to resolve an account, then reference it by name or by customer id. Cheap; no metrics.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_campaigns",
    description: "List an account's campaigns (name, id, status, channel type) INCLUDING PAUSED ones, independent of recent activity. Use this to find the EXACT campaign name to target before filing any campaign-level executable proposal, especially on paused or low-activity accounts.",
    input_schema: { type: "object", properties: { account: { type: "string", description: "Client name, client id, or Google customer id" } }, required: ["account"] },
  },
  {
    name: "get_account_report",
    description: "Full performance snapshot for ONE account, last complete week vs prior: KPIs (including by-time conversions and ROAS), channel split, impression share, top campaigns, conversions by action, top search terms, top ads, device split.",
    input_schema: { type: "object", properties: { account: { type: "string", description: "Client name, client id, or Google customer id" } }, required: ["account"] },
  },
  {
    name: "get_all_account_summaries",
    description: "Cross-account roll-up: per-currency totals, open alerts, and each imported account's week-over-week summary. Use for cross-account questions (where is budget being wasted, which account needs attention).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_changes",
    description: "The logged account changes for ONE account from the Google Ads change history. Google exposes only the last 30 days; do not ask for more.",
    input_schema: { type: "object", properties: { account: { type: "string" }, days: { type: "integer", description: "Look-back window, max 30 (default 28)" } }, required: ["account"] },
  },
  {
    name: "get_search_terms",
    description: "The account's ACTUAL search-term (query) data, Search campaigns only, aggregated per query and sorted by spend. Call this BEFORE proposing any negative keyword so you cite real wasted queries (meaningful cost, zero or near-zero conversions) rather than inventing one. PMax, Demand Gen and Shopping have no search terms.",
    input_schema: { type: "object", properties: { account: { type: "string" }, days: { type: "integer", description: "Look-back window in days (default 30, max 90)" } }, required: ["account"] },
  },
  {
    name: "get_feed_audit",
    description: "Google Shopping / feed PERFORMANCE audit for ONE ecommerce account: product-level winners and wasted spend, spend concentration, brand and product-type breakdowns, Shopping vs Performance Max split, and computed diagnoses. Read-only. This is feed PERFORMANCE from the Ads API, NOT Merchant Center feed HEALTH (disapprovals, item errors), which is not available here.",
    input_schema: { type: "object", properties: { account: { type: "string" }, days: { type: "integer", description: "Look-back window in days (default 30, max 180)" } }, required: ["account"] },
  },
  {
    name: "run_audit",
    description: "Hand the founder a link to the full Google Ads audit document (.docx) for one client: account audit, diagnosis with severities, strategy and an optimisation plan, generated fresh from live data when he opens the link. ONLY works for imported clients; a bare MCC account has no client record to attach it to, and you should say so rather than guessing an id.",
    input_schema: { type: "object", properties: { account: { type: "string" } }, required: ["account"] },
  },
  {
    name: "propose_optimization",
    description: "File a structured, reviewable optimisation proposal for the founder to approve or dismiss. This does NOT execute anything. To make it EXECUTABLE (an Apply button), include an `action` object: exactly ONE operation per proposal, never a batch. For campaign-level actions the `campaign` field is REQUIRED and must be an EXACT name from list_campaigns. If you cannot pin it to a real campaign, omit `action` and file it as advisory rather than inventing a campaign.",
    input_schema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Client name, client id, or Google customer id (must be an imported client)" },
        type: { type: "string", description: "e.g. negative_keywords, pause_campaign, budget_reallocation, rsa_improvement, other" },
        title: { type: "string", description: "Short imperative summary with the figures, e.g. 'Pause Competitors Test (268 spend, 0 conv)'" },
        rationale: { type: "string", description: "One to three sentences, figure-backed." },
        action: {
          type: "object",
          description: "Optional single executable operation. campaign negative: {kind:'add_negative_keyword', campaign, text, matchType}. account-level negative across all Search campaigns: {kind:'add_shared_negative', text, matchType} (NO campaign). pause: {kind:'pause_campaign', campaign}. budget: {kind:'set_campaign_budget', campaign, dailyBudget}.",
          properties: {
            kind: { type: "string", enum: ["add_negative_keyword", "add_shared_negative", "pause_campaign", "set_campaign_budget"] },
            campaign: { type: "string" },
            text: { type: "string" },
            matchType: { type: "string", enum: ["EXACT", "PHRASE", "BROAD"] },
            dailyBudget: { type: "number" },
          },
          required: ["kind"],
        },
      },
      required: ["account", "type", "title", "rationale"],
    },
  },
];

// ---- Execution tools (the founder's word in chat IS the approval gate) ----
const EXEC_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_proposals",
    description: "List optimisation proposals (id, title, type, status, client). Use to resolve which proposal the founder means before deciding or applying, and to answer what is pending.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "approved", "dismissed", "applied", "failed", "rolled_back"] } } },
  },
  {
    name: "decide_proposal",
    description: "Record the founder's decision on a SPECIFIC proposal. ONLY call this when he has explicitly and unambiguously approved or dismissed that proposal in this conversation. His word in this chat IS the approval gate. If more than one proposal could match, list them and ask which.",
    input_schema: { type: "object", properties: { proposal_id: { type: "string" }, decision: { type: "string", enum: ["approved", "dismissed"] } }, required: ["proposal_id", "decision"] },
  },
  {
    name: "apply_proposal",
    description: "Execute an APPROVED executable proposal against Google Ads. The worker re-checks approval status and every guardrail (kill switch, MCC boundary, allowlist, budget caps) before any mutate, exactly as the Proposals page Apply button does. ONLY call after the founder explicitly says to apply, and only on a proposal already approved. Report the result verbatim; never claim a success the result does not show.",
    input_schema: { type: "object", properties: { proposal_id: { type: "string" } }, required: ["proposal_id"] },
  },
  {
    name: "dry_run_proposal",
    description: "Preview exactly what applying a proposal would change, without changing anything. Cheap and safe; offer it when the founder hesitates.",
    input_schema: { type: "object", properties: { proposal_id: { type: "string" } }, required: ["proposal_id"] },
  },
];

const BUILD_TOOL: Anthropic.Tool[] = [
  {
    name: "build_campaign",
    description:
      "Build a complete SEARCH campaign in an account from a spec: budget, bidding, geo, schedule, campaign negatives, ad groups with keywords and responsive search ads. One atomic operation (it fully exists or nothing does); the CAMPAIGN is always created PAUSED whatever the spec says (the founder activates), with groups and ads enabled underneath so activation is a single action; the result is verified by re-reading every count from the account. Gates enforced in code: write kill switch, MCC boundary, customer allowlist, budget hard cap, operation budget, duplicate-name refusal. ONLY call this when the founder has explicitly told you to build a SPECIFIC spec laid out in this conversation. Offer validate_only first when anything is uncertain: Google validates the full build server-side and nothing is created. Search only; Performance Max, Demand Gen and Shopping cannot be built here and you should say so plainly.",
    input_schema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Client name, client id, or Google customer id" },
        build_ref: { type: "string", description: "Unique reference for this build, e.g. acme-brand-2026-08-06; recorded in the audit trail" },
        validate_only: { type: "boolean", description: "true = Google validates the full build server-side, creating nothing. The dry run before a real build." },
        campaign: {
          type: "object",
          description: "The spec agreed with the founder. daily_budget and target_cpa in account currency units. geo takes geo target constant ids or GB/PL shorthand. Every ad: 3-15 headlines (max 30 chars), 2-4 descriptions (max 90 chars), final_url.",
          properties: {
            name: { type: "string" },
            daily_budget: { type: "number" },
            bidding: { type: "string", enum: ["maximize_conversions", "maximize_clicks", "manual_cpc"] },
            target_cpa: { type: "number" },
            geo: { type: "array", items: {} },
            negatives: { type: "array", items: { type: "object", properties: { text: { type: "string" }, match: { type: "string", enum: ["EXACT", "PHRASE", "BROAD"] } }, required: ["text", "match"] } },
            schedule: { type: "object", properties: { days: { type: "string", enum: ["MON_FRI", "ALL_WEEK"] }, start_hour: { type: "number" }, end_hour: { type: "number" } }, required: ["days", "start_hour", "end_hour"] },
            ad_groups: { type: "array", items: { type: "object", properties: {
              name: { type: "string" }, cpc_bid: { type: "number" },
              keywords: { type: "array", items: { type: "object", properties: { text: { type: "string" }, match: { type: "string", enum: ["EXACT", "PHRASE", "BROAD"] } }, required: ["text", "match"] } },
              ads: { type: "array", items: { type: "object", properties: {
                headlines: { type: "array", items: { type: "string" } },
                descriptions: { type: "array", items: { type: "string" } },
                final_url: { type: "string" }, path1: { type: "string" }, path2: { type: "string" },
              }, required: ["headlines", "descriptions", "final_url"] } },
            }, required: ["name", "keywords", "ads"] } },
          },
          required: ["name", "daily_budget", "bidding", "geo", "ad_groups"],
        },
      },
      required: ["account", "build_ref", "campaign"],
    },
  },
];

const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: "remember",
    description:
      "Write something to your permanent memory. It survives the chat being cleared and every future session, so use it for anything you would be embarrassed to have forgotten next week: how an account is structured and why, its baselines, a ruling the founder made, a standing preference about how he wants you to work, a strategic position you have taken. Do NOT store things you can look up live (yesterday's spend, current impression share); store the judgement, not the reading. Check your existing memory first: if a memory is merely out of date, use revise_memory rather than adding a second version.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["client", "account", "decision", "preference", "strategy", "fact"], description: "client = how they operate; account = a Google Ads account's structure, baselines, quirks; decision = a founder ruling and its reason; preference = how he wants you to work; strategy = a standing position; fact = anything else durable" },
        subject: { type: "string", description: "What it is about: a client name, a Google customer id, or 'global'" },
        content: { type: "string", description: "The memory itself, written so it makes sense to you cold in six months. Include the why. State dates absolutely, never 'last week'." },
        shared: { type: "boolean", description: "true makes it visible to every agent, not just you. Share client-level facts, founder rulings and cross-channel strategy; keep platform tactics private. You stay the owner either way." },
      },
      required: ["kind", "subject", "content"],
    },
  },
  {
    name: "revise_memory",
    description: "Correct or update an existing memory in place, using the id shown beside it in your memory block. Use this when a fact has CHANGED. If a memory was wrong all along, use forget with the reason instead, so the record shows you were corrected.",
    input_schema: { type: "object", properties: { memory_id: { type: "string" }, content: { type: "string", description: "The replacement content, complete rather than a diff" } }, required: ["memory_id", "content"] },
  },
  {
    name: "forget",
    description: "Retire a memory. Use it when the founder tells you to forget something, or when you discover a memory was wrong. It stops appearing but is retained in the audit trail, so state the reason honestly.",
    input_schema: { type: "object", properties: { memory_id: { type: "string" }, reason: { type: "string" } }, required: ["memory_id", "reason"] },
  },
];

// The reviewer deployment keeps the analyst it was validated as: reads and
// proposals only. No named persona, no memory, no chat-native execution or
// build. Simpler to assess, and it keeps the demonstrated surface identical to
// what the Google reviewer already walked (approval and rollback stay on the
// Proposals page, where they were validated).
function toolsFor(reviewMode: boolean): Anthropic.Tool[] {
  return reviewMode
    ? READ_TOOLS
    : [...READ_TOOLS, ...EXEC_TOOLS, ...BUILD_TOOL, ...MEMORY_TOOLS];
}

const SYSTEM_BASE = `You are Oscar, the ${entityConfig.brandName || "agency"} senior paid search strategist. You own Google Ads and Shopping across every account the agency manages: you read accounts against ground truth, you form a view, and you defend it. Analysis and reporting are things you do, not what you are.

YOUR MEMORY IS PERMANENT. Everything in the MEMORY block below is yours, written by you in earlier sessions, and it persists indefinitely. It survives the chat being cleared: clearing wipes the visible transcript only. So never say you have no memory across sessions, and never ask for something to be re-explained that is already in your memory. If a session feels contextless, that means you did not write things down, which is a failure to fix by using the remember tool more, not something to apologise about mid-conversation.

Use it like a strategist keeping a running file on every account:
- When you learn something durable, call remember. How an account is structured and why, its baselines, a ruling the founder made, a preference about how he wants you to work, a strategic position you have taken. Do it as it happens.
- Store judgement, not readings. Yesterday's spend and today's impression share are live lookups; the conclusion you drew from them is memory.
- Memories can be SHARED across agents. Anything marked "SHARED by <agent>" was written by a colleague: treat it as their testimony about their channel, trust it for client-level facts, and do not repeat their platform tactics on yours without thinking. Share your own client-level learnings back (the shared flag on remember).
- When a fact changes, revise_memory rather than adding a second version. Contradictory memories are worse than none.

HOW YOU WORK:
- Use the tools to fetch REAL figures. Never invent, estimate or recompute a number, percentage, campaign name or metric. If you do not have it, fetch it.
- Resolve accounts with list_accounts; you can reference an account by name OR by its Google customer id. You can READ any account under the agency MCC, including ones not yet onboarded as clients. Proposals and audit documents need an imported client, so if the founder names a bare MCC account say that plainly rather than inventing a client id.
- Figures are ACCOUNT-WIDE across all channel types. Attribute correctly: never call Performance Max or Shopping activity "Search", never call product or listing groups "keywords". Search impression share and search terms are Search-only. Two conversion bases exist (interaction date and by-time); do not conflate them.
- Respect each account's own currency; never sum across currencies.
- Change history only covers the last 30 days (a Google limit); do not ask for more.
- Do not narrate your tool use ("let me check…"). Call the tools, then give the answer.

YOUR JOB:
- Be concise, specific and actionable, a senior analyst talking to a peer. Lead with the answer, then the evidence.
- British English. Never use an em dash, in anything you write: chat, drafts, documents, headings. Use a full stop, comma, colon or parentheses instead (en dashes only inside numeric ranges like 45-54). The founder has ruled on this.
- Anything drafted in the founder's voice (client messages, freelancer instructions) is first person SINGULAR: I, me, my. Never the agency "we/us/our". Sweep the draft for "we" before handing it over.
- When the founder asks you to PROPOSE something, or you find a concrete change worth formalising, call propose_optimization to file it as a reviewable card, then say it is filed. He can approve and apply WITHOUT leaving this chat: on his explicit word, decide_proposal records the approval and apply_proposal executes it behind the same guardrails as the Proposals page. Offer dry_run_proposal when he hesitates. NEVER claim a change was made unless apply_proposal returned success; execution authority is his word, never your inference.
- ONE operation per proposal. To add several negatives, file several proposals, one keyword each, never a batch. For a campaign-level negative, pause, or budget change, first call list_campaigns to get the EXACT campaign name.
- NEGATIVE KEYWORDS: before proposing any negative, call get_search_terms and cite the actual wasted queries (meaningful cost, zero or near-zero conversions). Never invent a query. If get_search_terms returns nothing, say so and do not fabricate one. A wasted query spending across many Search campaigns is a shared negative (add_shared_negative); one confined to a single campaign is a campaign-level add_negative_keyword. Shared negatives only affect Search campaigns; say so if the account is mostly non-Search.
- If asked whether an optimisation is needed and you think NOT, prove it with the figures.
- build_campaign creates a full Search campaign from a spec: atomic, campaign always PAUSED, gates in code, result verified by re-read. You CAN build from this chat. Lay the spec out, get the founder's explicit go, run validate_only first if anything is uncertain, then build and report the verified counts. He activates; you never do. Performance Max, Demand Gen and Shopping builds do not exist here; say so rather than improvising.
- run_audit prepares the written audit document. Give the founder the download path on its own line at the end of your reply.`;

// The reviewer deployment's analyst: unnamed, read-and-propose, no memory. This
// is the prompt the Google reviewer already walked; keep it that way.
const SYSTEM_REVIEW = `You are a senior paid search analyst at ${entityConfig.brandName || "the agency"}, working inside the agency Command Center. You help the team triage and understand their Google Ads accounts.

RULES:
- Use ONLY figures returned by the tools. Never invent or recompute a number, account, or campaign name. If you have not pulled the data, pull it before answering.
- Channel attribution matters: only Search campaigns have keywords and search terms; Performance Max, Demand Gen and Shopping use assets, audiences and listing groups. Never mislabel.
- You ANALYSE and PROPOSE. You never execute changes. To recommend a concrete change, file it with propose_optimization (include an action for an executable one), then tell the user it is queued for their approval on the Proposals page.
- GROUND NEGATIVE KEYWORDS IN REAL DATA: before proposing any negative keyword, call get_search_terms and cite the actual wasted queries (meaningful cost, zero or very low conversions). Never invent a wasted query. If get_search_terms returns nothing, say so.
- EXECUTABLE ACTIONS need a real campaign: for pause_campaign, set_campaign_budget or a campaign-level add_negative_keyword, FIRST call list_campaigns and put the EXACT campaign name in action.campaign. Never guess or leave it blank. For an account-wide exclusion use add_shared_negative with no campaign.
- Change history only covers the last 30 days (a Google limit); do not ask for more.
- British English. Never use em dashes or en dashes outside numeric ranges. Be concise and specific; lead with the answer.`;

function buildSystem(memoryBlock: string): string {
  if (entityConfig.reviewMode) return SYSTEM_REVIEW;
  return `${SYSTEM_BASE}

=== MEMORY (yours, written by you, persists across all sessions) ===
${memoryBlock}
=== END MEMORY ===`;
}

function statusFor(name: string, input: Record<string, unknown>): string {
  const acc = typeof input?.account === "string" ? input.account : "";
  switch (name) {
    case "list_accounts": return "Listing accounts…";
    case "list_campaigns": return `Listing ${acc || "account"} campaigns…`;
    case "get_account_report": return `Reading ${acc || "the account"}…`;
    case "get_all_account_summaries": return "Rolling up all accounts…";
    case "get_recent_changes": return "Reading the change log…";
    case "get_search_terms": return "Pulling real search-term data…";
    case "get_feed_audit": return `Auditing ${acc || "the account"} feed…`;
    case "run_audit": return "Preparing the audit document…";
    case "propose_optimization": return `Filing proposal: ${typeof input.title === "string" ? input.title : ""}…`;
    case "list_proposals": return "Listing proposals…";
    case "decide_proposal": return "Recording your decision…";
    case "apply_proposal": return "Applying the change (guardrails re-checked)…";
    case "dry_run_proposal": return "Dry-running the change…";
    case "build_campaign": return input.validate_only === true ? "Validating the build with Google (nothing created)…" : "Building the campaign (atomic, paused, verified)…";
    case "remember": return "Committing that to memory…";
    case "revise_memory": return "Updating what I know…";
    case "forget": return "Forgetting that…";
    default: return "Working…";
  }
}

interface ToolContext { roster: RosterEntry[]; actor: string }

async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const account = () => resolveAccount(ctx.roster, String(input.account ?? ""));
  const unresolved = { error: `No account matches "${input.account}". Call list_accounts and use an exact name or customer id.` };

  switch (name) {
    case "list_accounts":
      return ctx.roster.map((r) => ({ clientId: r.clientId, company: r.company, customerId: r.reportingId, imported: r.imported }));

    case "list_campaigns": {
      const acc = account();
      if (!acc) return unresolved;
      const rows = await gaqlSearch(
        acc.reportingId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type
         FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name`,
      );
      const campaigns = rows.slice(0, 80).map((r) => {
        const c = (r.campaign ?? {}) as { id?: string | number; name?: string; status?: string; advertisingChannelType?: string };
        return { id: String(c.id ?? ""), name: c.name ?? "", status: c.status ?? "", channel: c.advertisingChannelType ?? "" };
      });
      return { company: acc.company, customerId: acc.reportingId, campaignCount: campaigns.length, campaigns };
    }

    case "get_account_report": {
      const acc = account();
      if (!acc) return unresolved;
      const d = await dashboardFor(acc);
      const kpi = (x: { value: number; deltaPct: number | null }) => ({
        value: Number(x.value.toFixed(2)),
        deltaPct: x.deltaPct == null ? null : Number(x.deltaPct.toFixed(1)),
      });
      return {
        company: acc.company,
        currency: d.currency,
        period: d.range,
        note: "Account-wide across all channel types. Search impression share and search terms are Search-only. 'ByTime' figures are on a conversion-date basis.",
        kpis: {
          spend: kpi(d.kpis.spend), impressions: kpi(d.kpis.impressions), clicks: kpi(d.kpis.clicks), ctr: kpi(d.kpis.ctr),
          avgCpc: kpi(d.kpis.avgCpc), conversions: kpi(d.kpis.conversions), costPerConv: kpi(d.kpis.costPerConv),
          conversionRate: kpi(d.kpis.convRate), revenue: kpi(d.kpis.convValue), roas: kpi(d.kpis.roas), aov: kpi(d.kpis.aov),
          conversionsByTime: kpi(d.kpis.conversionsByTime), revenueByTime: kpi(d.kpis.convValueByTime), roasByTime: kpi(d.kpis.roasByTime),
          searchImpressionShare: kpi(d.kpis.searchImprShare),
        },
        hasConversionValue: d.hasConversionValue,
        byChannel: d.byChannel,
        impressionShare: d.impressionShare,
        topCampaigns: d.byCampaign.slice(0, 8),
        conversionsByAction: d.byConversionAction,
        topSearchTerms: d.topSearchTerms.slice(0, 8),
        topAds: d.topAds.slice(0, 5),
        deviceSplit: d.byDevice,
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
        note: "Imported clients only. Bare MCC accounts are readable one at a time with get_account_report.",
      };
    }

    case "get_recent_changes": {
      const acc = account();
      if (!acc) return unresolved;
      const days = typeof input.days === "number" && input.days > 0 ? Math.min(input.days, 30) : 28;
      const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
      const changes = await getWeeklyOptimisations(acc.reportingId, ymd(start), ymd(end));
      return { company: acc.company, days, changes: changes.length ? changes : ["No account changes logged in this window."] };
    }

    case "get_search_terms": {
      const acc = account();
      if (!acc) return unresolved;
      const days = typeof input.days === "number" && input.days > 0 ? Math.min(input.days, 90) : 30;
      const rows = await gaqlSearch(
        acc.reportingId,
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
      if (terms.length === 0) return { company: acc.company, days, note: "No Search search-term data for this period (the account may have no active Search campaigns; PMax, Demand Gen and Shopping have no search terms).", terms: [] };
      return {
        company: acc.company,
        days,
        note: "Cost is in the account currency. Meaningful cost with near-zero conversions is a negative-keyword candidate. A query spanning many Search campaigns is a shared-negative candidate; one confined to a single campaign is a campaign-level negative.",
        terms,
      };
    }

    case "get_feed_audit": {
      const acc = account();
      if (!acc) return unresolved;
      const days = typeof input.days === "number" && input.days > 0 ? Math.min(input.days, 180) : 30;
      const f = await getFeedAudit(acc.reportingId, days);
      if (!f.hasShopping) {
        return { company: acc.company, hasShopping: false, note: "No Shopping or Performance Max activity found in this window, so there is nothing to audit at feed level." };
      }
      const dec = (n: number, dp = 2) => Number(n.toFixed(dp));
      const trimProduct = (p: import("@/lib/integrations/google-ads/feed").FeedProduct) => ({
        itemId: p.itemId, title: p.title.slice(0, 80), brand: p.brand, type: p.type,
        impressions: p.impressions, clicks: p.clicks, cost: dec(p.cost), conversions: dec(p.conversions), convValue: dec(p.convValue), roas: dec(p.roas),
      });
      const trimGroup = (g: import("@/lib/integrations/google-ads/feed").FeedGroup) => ({ label: g.label, spend: dec(g.spend), conversions: dec(g.conversions), convValue: dec(g.convValue), roas: dec(g.roas) });
      return {
        company: acc.company,
        currency: f.currency,
        window: f.window,
        hasShopping: true,
        totals: {
          products: f.totals.products, spend: dec(f.totals.spend), conversions: dec(f.totals.conversions),
          convValue: dec(f.totals.convValue), roas: dec(f.totals.roas),
          nonConvertingSpend: dec(f.totals.nonConvertingSpend), nonConvertingSpendPct: dec(f.totals.nonConvertingSpendPct, 1),
          zeroClickProducts: f.totals.zeroClickProducts, missingBrand: f.totals.missingBrand,
        },
        spendConcentrationTop10Pct: dec(f.spendConcentrationTop10Pct, 1),
        channelSplit: f.channelSplit.map(trimGroup),
        topProducts: f.topProducts.slice(0, 10).map(trimProduct),
        wastedProducts: f.wastedProducts.slice(0, 10).map(trimProduct),
        byBrand: f.byBrand.slice(0, 8).map(trimGroup),
        byType: f.byType.slice(0, 8).map(trimGroup),
        diagnoses: f.diagnoses,
        note: "Feed PERFORMANCE from the Google Ads API, not Merchant Center feed HEALTH (disapprovals, item errors). Base exclusion or bidding proposals on wastedProducts plus diagnoses.",
      };
    }

    case "run_audit": {
      const acc = account();
      if (!acc) return unresolved;
      if (!acc.imported || !acc.clientId) {
        return { error: `${acc.company} is visible under the MCC but is not an onboarded client, so there is no client record to attach an audit to. I can still report on it in chat.` };
      }
      return {
        account: { company: acc.company, customerId: acc.reportingId },
        download_path: `/api/audit/${acc.clientId}`,
        note: "Generated fresh from live account data when the founder opens it. Takes roughly two minutes.",
      };
    }

    case "propose_optimization": {
      const acc = account();
      if (!acc) return unresolved;
      if (!acc.clientId) {
        return { error: `${acc.company} is under the MCC but not imported as a client, so a proposal cannot be filed against it. It can still be analysed; to file and track proposals, import it first (Add managed account).` };
      }
      const action = input.action && typeof input.action === "object" ? { action: input.action } : {};
      const res = await createProposal({
        clientId: acc.clientId,
        type: String(input.type ?? "optimization"),
        title: String(input.title ?? "Optimisation"),
        rationale: String(input.rationale ?? ""),
        details: action,
        createdBy: `agent:${AGENT}`,
      });
      return "error" in res
        ? { error: res.error }
        : { ok: true, proposalId: res.id, note: `Filed for ${acc.company}, pending review in the Proposals page.` };
    }

    case "list_proposals": {
      const st = typeof input.status === "string" ? (input.status as ProposalStatus) : undefined;
      const rows = await listProposals(st);
      return rows.map((p) => ({ id: p.id, title: p.title, type: p.type, status: p.status, clientId: p.client_id, executable: Boolean(p.details?.action), createdAt: p.created_at }));
    }

    case "decide_proposal": {
      const id = String(input.proposal_id ?? "");
      const d = String(input.decision ?? "");
      if (!id || (d !== "approved" && d !== "dismissed")) return { error: "decide_proposal needs a proposal_id and a decision of approved or dismissed." };
      return decideProposal(id, d, ctx.actor);
    }

    case "apply_proposal": {
      const id = String(input.proposal_id ?? "");
      if (!id) return { error: "apply_proposal needs a proposal_id." };
      return applyProposal(id, ctx.actor);
    }

    case "dry_run_proposal": {
      const id = String(input.proposal_id ?? "");
      if (!id) return { error: "dry_run_proposal needs a proposal_id." };
      return dryRunProposal(id);
    }

    case "build_campaign": {
      const acc = account();
      if (!acc) return unresolved;
      const spec = {
        account: acc.reportingId,
        build_ref: String(input.build_ref ?? ""),
        campaign: input.campaign,
      } as unknown as GoogleBuildSpec;
      return buildGoogleCampaign(spec, ctx.actor, { validateOnly: input.validate_only === true });
    }

    case "remember": {
      const kind = String(input.kind ?? "");
      if (!(MEMORY_KINDS as string[]).includes(kind)) return { error: `kind must be one of: ${MEMORY_KINDS.join(", ")}` };
      const content = String(input.content ?? "");
      if (!content.trim()) return { error: "remember needs content." };
      return remember(AGENT, kind as MemoryKind, String(input.subject ?? "global"), content, ctx.actor, input.shared === true);
    }

    case "revise_memory": {
      const id = String(input.memory_id ?? "");
      if (!id) return { error: "revise_memory needs a memory_id from your memory block." };
      return reviseMemory(AGENT, id, String(input.content ?? ""));
    }

    case "forget": {
      const id = String(input.memory_id ?? "");
      if (!id) return { error: "forget needs a memory_id from your memory block." };
      return forgetMemory(AGENT, id, String(input.reason ?? "the founder asked me to forget it"));
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export async function runAgentChatStream(
  history: ChatMessage[],
  emit: (e: AgentEvent) => void,
  focusClientId?: string | null,
  actor = `agent:${AGENT}`,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit({ type: "error", text: "AI is not configured (ANTHROPIC_API_KEY missing)." });
    emit({ type: "done" });
    return;
  }

  const client = new Anthropic({ apiKey });
  const ctx: ToolContext = { roster: await loadRoster(), actor };
  const reviewMode = entityConfig.reviewMode;
  const tools = toolsFor(reviewMode);
  // Memory is read fresh each turn, so a memory written a moment ago is already
  // in scope, and it is scoped to Oscar so another agent's notes never leak in.
  // Review mode has no memory at all, so skip the read entirely.
  const memoryBlock = reviewMode ? "" : renderMemories(await loadMemories(AGENT), AGENT);
  const system = buildSystem(memoryBlock) + focusNote(ctx.roster, focusClientId);
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        system,
        tools,
        messages,
      });
      // The no-em-dash house rule enforced deterministically on the stream: a
      // prompt instruction does not survive long analytical replies. Stateful
      // per turn so a dash split across chunks still collapses.
      const scrub = makeEmDashScrubber();
      let turnText = "";
      stream.on("text", (t) => {
        turnText += t;
        const clean = scrub(t);
        if (clean) emit({ type: "delta", text: clean });
      });
      const msg = await stream.finalMessage();
      const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || toolUses.length === 0) {
        emit({ type: "done" });
        return;
      }
      messages.push({ role: "assistant", content: msg.content });

      // Drop "let me check…" preamble, never the answer. Oscar routinely writes
      // his reply and only then calls remember to file it; an unconditional
      // reset there deleted the whole reply and left the closing line alone.
      if (isPreamble(turnText, toolUses)) emit({ type: "reset" });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const inp = (tu.input ?? {}) as Record<string, unknown>;
        emit({ type: "status", text: statusFor(tu.name, inp) });
        let out: unknown;
        try {
          out = await runTool(tu.name, inp, ctx);
        } catch (e) {
          out = { error: e instanceof Error ? e.message : "Tool failed." };
        }
        // A prepared audit gets a first-class download chip in the panel.
        const dl = out as { download_path?: string; account?: { company?: unknown } } | null;
        if (tu.name === "run_audit" && dl?.download_path) {
          const who = typeof dl.account?.company === "string" ? dl.account.company : "account";
          emit({ type: "artifact", text: dl.download_path, label: `Download the ${who} Google Ads audit (.docx)` });
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 80_000) });
      }
      messages.push({ role: "user", content: results });
    }
    emit({ type: "delta", text: "\n\n(Stopped after several steps. Try narrowing the question to a specific account.)" });
    emit({ type: "done" });
  } catch (e) {
    emit({ type: "error", text: e instanceof Error ? e.message : "The assistant hit an error." });
    emit({ type: "done" });
  }
}

// Kept for the non-streaming callers (cron, scripts): same tools, same gates.
export async function runAgentChat(
  history: ChatMessage[],
  actor = `agent:${AGENT}`,
  focusClientId?: string | null,
): Promise<{ reply: string }> {
  let reply = "";
  await runAgentChatStream(
    history,
    (e) => { if (e.type === "delta") reply += e.text; if (e.type === "reset") reply = ""; },
    focusClientId,
    actor,
  );
  return { reply: reply.trim() || "(no answer)" };
}

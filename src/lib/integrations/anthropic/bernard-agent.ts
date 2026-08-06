// Bernard — the Meta strategist's conversational surface. Oscar's counterpart:
// same memory substrate, same voice rules, same NDJSON event contract, so the
// chat plumbing is shared.
//
// READ-ONLY, deliberately. The sibling portal dispatches Meta writes to a
// governed executor in a separate n8n estate; PPC Mastery does not run that
// estate (founder decision 2026-08-06), so Bernard has no write path at all.
// He reads, diagnoses, and drafts. A human makes every Meta change. That is a
// design choice, not a gap, and he should say so plainly rather than implying
// he could act if asked.
//
// Runtime: Claude Fable 5 at medium effort. Thinking is always on for Fable 5
// (no `thinking` param), and a server-side fallback to Opus 4.8 covers the rare
// classifier refusal so the founder never gets a dead reply.
import Anthropic from "@anthropic-ai/sdk";
import {
  listMetaAdAccounts,
  getMetaAuditData,
  metaConfigured,
  normalizeActId,
  readAdCopy,
  listCustomAudiences,
  getAdSetDetail,
  getCreativePerformance,
  getPixelStats,
} from "@/lib/integrations/meta";
import type { AgentEvent, ChatMessage } from "@/lib/integrations/anthropic/agent";
import type { Attachment } from "@/lib/attachments";
import { entityConfig } from "@/lib/config";
import { makeEmDashScrubber } from "@/lib/emdash";
import {
  loadMemories,
  renderMemories,
  remember,
  reviseMemory,
  forgetMemory,
  MEMORY_KINDS,
  type MemoryKind,
} from "@/lib/agent-memory";

const AGENT = "bernard";
const MODEL = "claude-fable-5";
const FALLBACK_MODEL = "claude-opus-4-8";

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "list_meta_accounts",
    description:
      "Every Meta ad account the system user can currently see, live from the token — the moment the founder assigns an account in Business Manager it appears here and is auditable. Returns name, account id, status, currency, business owner, lifetime spend. Use to resolve an account the founder names.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "run_audit",
    description:
      "Full READ-ONLY audit read of one Meta ad account, live from the account: account state, current-vs-prior period performance, daily spend and conversion trend, campaigns with budgets and objectives, ad sets with bid strategy, targeting and learning phase, ad counts, pixel presence and last fire. Nothing is modified. Use whenever the founder asks for an audit, a performance review, or what is wrong with an account. The result includes download_path, a link to the same audit as a formatted Word document.",
    input_schema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "The ad account id (digits, or act_ prefixed); resolve via list_meta_accounts if the founder gave a name" },
        days: { type: "number", description: "Review window in days (default 30, 7-90); compared against the prior window of the same length" },
      },
      required: ["account_id"],
    },
  },
  {
    name: "read_ad_copy",
    description:
      "READ the actual words in an account's ads: every headline, primary text and description variant, plus each creative's Instagram identity. Also returns deterministic flags for em dashes and discount or savings claims. Call this BEFORE recommending or reusing ANY creative: performance figures do not show you what an ad says, and a creative that looks like a winner can carry a claim the client has retired. Defaults to serving and in-review ads; pass status 'all' to sweep the paused pool.",
    input_schema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Ad account id (digits or act_ prefixed)" },
        status: { type: "string", enum: ["active", "all"], description: "Default 'active' (serving plus in review). 'all' includes paused and archived." },
        limit: { type: "number", description: "Max ads to scan, 1-200, default 200. The result carries a `truncated` flag: if it is true, ads are missing and you must not describe the account's copy as complete." },
      },
      required: ["account_id"],
    },
  },
  {
    name: "list_audiences",
    description:
      "READ an account's custom audiences: name, id, subtype, retention, the event sources and events behind each rule, whether exclusions exist, and crucially whether Meta says the audience can actually serve. Use before proposing any retargeting layer, and to check whether an audience you are about to ask for already exists. Audience SIZE is deliberately not returned: Meta suppresses it on advanced-matching website audiences and the API's count fields are placeholders that must never be quoted as counts. The result carries a `truncated` flag; when it is true the list is a partial page, so never say an audience does not exist on the strength of it.",
    input_schema: {
      type: "object",
      properties: { account_id: { type: "string", description: "Ad account id (digits or act_ prefixed)" } },
      required: ["account_id"],
    },
  },
  {
    name: "get_adset_detail",
    description:
      "READ one ad set's full live configuration: budget, optimisation goal and conversion event, pixel, bid strategy, geo, age, gender, included and excluded audiences, placements and devices. Use to verify what an ad set actually targets by read-back rather than trusting a report, yours or anyone else's.",
    input_schema: {
      type: "object",
      properties: { adset_id: { type: "string", description: "The ad set id" } },
      required: ["adset_id"],
    },
  },
  {
    name: "get_creative_performance",
    description:
      "READ ad-level performance ranked by spend: spend, impressions, CTR, add to carts, purchases, revenue and ROAS per ad. Use to judge which creative is actually earning rather than which is assumed to. Pair it with read_ad_copy before any creative recommendation: this tool tells you what performs, that one tells you what it says.",
    input_schema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Ad account id (digits or act_ prefixed)" },
        days: { type: "number", description: "Window in days. Omit for lifetime." },
      },
      required: ["account_id"],
    },
  },
  {
    name: "get_pixel_stats",
    description:
      "READ a pixel's event volume by event type over a window (PageView, ViewContent, AddToCart, Purchase and so on). Use to establish whether an audience pool can exist before blaming audience size, and to size an event window honestly (a 30-day AddToCart audience on 40 events a month is not an audience).",
    input_schema: {
      type: "object",
      properties: {
        pixel_id: { type: "string", description: "The pixel or dataset id" },
        days: { type: "number", description: "Window in days, 1-90, default 30" },
      },
      required: ["pixel_id"],
    },
  },
  {
    name: "remember",
    description:
      "Write something to your permanent memory. It survives the founder clearing the chat and every future session, so use it for anything you would be embarrassed to have forgotten next week: how a client operates, an account's baselines and quirks, a ruling the founder made and why, a standing preference about how he wants you to work, a strategic position you have taken. Do NOT store things you can look up live (current spend, today's delivery); store the judgement, not the reading. Check your existing memory first: if a memory is merely out of date, use revise_memory instead of adding a second version.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["client", "account", "decision", "preference", "strategy", "fact"], description: "client = how they operate; account = an ad account's quirks and baselines; decision = a founder ruling and its reason; preference = how he wants you to work; strategy = a standing position; fact = anything else durable" },
        subject: { type: "string", description: "What it is about: a client name, an act_ id, or 'global'" },
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

const SYSTEM_BASE = `You are Bernard, the senior paid social strategist for ${entityConfig.brandName || "the agency"}. Auditing accounts is something you do, not what you are: you own Meta strategy across every client, you carry the thread from one week to the next, and you are expected to have an opinion and defend it. Oscar is your counterpart on Google Ads.

You are talking to the founder inside the portal.

YOU ARE READ-ONLY ON META, BY DESIGN. You have no write path: no dispatch, no executor, no way to change an account. That is a deliberate choice on this deployment, not a missing feature and not a permission you might be granted mid-conversation. Say so plainly if asked, then do the part that is yours: read the ground truth, diagnose it, and hand the founder something specific enough to act on. Never imply you could make a change, never say you "will" change something, and never claim anything was changed.

YOUR MEMORY IS PERMANENT. Everything in the MEMORY block below is yours, written by you in earlier sessions, and it persists indefinitely. It survives the founder clearing the chat: clearing wipes the visible transcript only. So never say you have no memory across sessions, never say "as a new session I don't have context", and never ask the founder to re-explain something already in your memory. If a session feels contextless, that means you did not write things down, which is a failure to fix by using the remember tool more, not something to apologise about mid-conversation.

Use it like a strategist keeping a running file on every account:
- When you learn something durable (how a client operates, an account's baselines, a ruling the founder made and why, a preference about how he wants you to work, a strategic position) call remember. Do it as it happens, not at the end.
- Store judgement, not readings. Current spend and today's delivery are live lookups; the conclusion you drew from them is memory.
- Memories can be SHARED across agents. Anything marked "SHARED by <agent>" was written by a colleague: treat it as their testimony about their channel, trust it for client-level facts, and do not repeat their platform tactics on yours without thinking. Share your own client-level learnings back (the shared flag on remember); a multi-channel client should never depend on the founder ferrying facts between you and Oscar.
- When a fact changes, revise_memory rather than adding a second version. You cannot edit a colleague's shared memory: write your own shared correction and say so.
- Anything the founder rules on is worth remembering. If he corrects you, that correction is a memory.

WHAT YOU CAN DO HERE:
- list_meta_accounts shows every ad account the system user can see, live. Any account there is yours to read and audit immediately; assignment in Business Manager is the whole onboarding.
- run_audit reads one account's full ground truth so you can audit it in chat. Lead with the verdict and the strongest evidence; keep the chat version tight. The tool result carries download_path. ALWAYS give the founder that link at the end of an audit, on its own line. The document is generated fresh from the same live data when he clicks it.
- read_ad_copy, list_audiences, get_adset_detail, get_creative_performance and get_pixel_stats are your close-reading tools. Use them; do not reason about an account you have not read.

AUDIT CRAFT:
- Anchor every number to data you fetched. If a section came back with an error, say so instead of quietly working around it.
- NEVER recommend or endorse a creative whose words you have not read. Call read_ad_copy first, every time. Performance figures do not show you what an ad says: on the sibling portal a creative was recommended on its ROAS and carried a "Save up to 72%" headline an audit had already pledged to retire. read_ad_copy also flags em dashes (a standing founder ruling) and tells you whether an Instagram identity is attached at all.
- Before proposing an audience, call list_audiences: the one you are about to ask for may already exist. Audience SIZE is not available and no tool will give it to you. Meta suppresses it on advanced-matching website audiences, and the API's count fields are placeholders. Use canServe for usability and get_pixel_stats to judge whether a pool can exist. Never set a go/no-go threshold on a number you cannot obtain.
- On a "performance dropped" complaint, check in order: spend pacing and delivery gaps in the daily trend, learning-phase state and recent ad set churn (updated timestamps), budget or bid strategy changes, frequency and fatigue, then pixel health (last fire). Attribute the drop to what the data shows, not to a template.

HOW YOU SPEAK:
- A calm, senior strategist reporting to the principal: lead with the state or the answer, then the evidence. Concise and concrete.
- Never use an em dash, in anything you write: chat, drafts, documents, headings. Use a full stop, comma, colon or parentheses instead (en dashes only inside numeric ranges, like 45-54). The founder has ruled on this; anything you hand him must already comply.
- Anything drafted in the founder's voice (client messages, freelancer instructions) is first person SINGULAR: I, me, my. Never the agency "we/us/our", even where it feels natural. Sweep the draft for "we" before handing it over.
- Do not narrate tool use; call the tool, then answer.
- Never claim an action succeeded unless the tool result says so. If a read fails, report the failure plainly.`;

function buildSystem(memoryBlock: string): string {
  return `${SYSTEM_BASE}

=== MEMORY (yours, written by you, persists across all sessions) ===
${memoryBlock}
=== END MEMORY ===`;
}

type BetaBlock = Anthropic.Beta.BetaContentBlock;

// If a server-side fallback fired mid-turn, thinking/tool_use blocks BEFORE the
// last fallback boundary must not be echoed back (API rule); everything at or
// after it echoes normally. No fallback block means content passes untouched.
function sanitizeForEcho(content: BetaBlock[]): BetaBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  if (lastFallback < 0) return content;
  return content.filter(
    (b, i) =>
      i >= lastFallback ||
      (b.type !== "thinking" && b.type !== "redacted_thinking" && b.type !== "tool_use"),
  );
}

function statusLabel(name: string): string {
  switch (name) {
    case "list_meta_accounts": return "Listing ad accounts…";
    case "run_audit": return "Auditing the account (live reads)…";
    case "read_ad_copy": return "Reading the ad copy…";
    case "list_audiences": return "Reading the audiences…";
    case "get_adset_detail": return "Reading the ad set config…";
    case "get_creative_performance": return "Ranking the creatives…";
    case "get_pixel_stats": return "Reading pixel event volume…";
    case "remember": return "Committing that to memory…";
    case "revise_memory": return "Updating what I know…";
    case "forget": return "Forgetting that…";
    default: return "Working…";
  }
}

const META_NOT_CONFIGURED = {
  error:
    "Meta access is not configured on this deployment (META_ADS_TOKEN missing). Tell the founder it needs adding to the environment; do not guess at what the account contains.",
};

/** Shared guard for the account-scoped Meta reads. */
function requireMetaAccount(ref: unknown, tool: string): { digits: string } | { error: string } {
  if (!metaConfigured()) return META_NOT_CONFIGURED;
  const s = String(ref ?? "").trim();
  if (!/^(act_)?\d{6,}$/.test(s))
    return { error: `${tool} needs a numeric ad account id. Resolve the name via list_meta_accounts first.` };
  return { digits: normalizeActId(s).digits };
}

async function runTool(name: string, input: Record<string, unknown>, actor: string): Promise<unknown> {
  switch (name) {
    case "list_meta_accounts": {
      if (!metaConfigured()) return META_NOT_CONFIGURED;
      return listMetaAdAccounts();
    }
    case "run_audit": {
      const guard = requireMetaAccount(input.account_id, "run_audit");
      if ("error" in guard) return guard;
      const days = Math.min(90, Math.max(7, Math.round(Number(input.days) || 30)));
      const data = await getMetaAuditData(guard.digits, days);
      return { ...data, download_path: `/api/bernard/audit/${guard.digits}?days=${days}` };
    }
    case "read_ad_copy": {
      const guard = requireMetaAccount(input.account_id, "read_ad_copy");
      if ("error" in guard) return guard;
      const status = input.status === "all" ? "all" : "active";
      const limit = Number(input.limit) || undefined;
      return readAdCopy(guard.digits, { status, limit });
    }
    case "list_audiences": {
      const guard = requireMetaAccount(input.account_id, "list_audiences");
      if ("error" in guard) return guard;
      return listCustomAudiences(guard.digits);
    }
    case "get_adset_detail": {
      if (!metaConfigured()) return META_NOT_CONFIGURED;
      const id = String(input.adset_id ?? "").trim();
      if (!/^\d{6,}$/.test(id)) return { error: "get_adset_detail needs a numeric ad set id." };
      return getAdSetDetail(id);
    }
    case "get_creative_performance": {
      const guard = requireMetaAccount(input.account_id, "get_creative_performance");
      if ("error" in guard) return guard;
      const days = input.days ? Math.min(365, Math.max(1, Math.round(Number(input.days)))) : undefined;
      return getCreativePerformance(guard.digits, { days });
    }
    case "get_pixel_stats": {
      if (!metaConfigured()) return META_NOT_CONFIGURED;
      const id = String(input.pixel_id ?? "").trim();
      if (!/^\d{6,}$/.test(id)) return { error: "get_pixel_stats needs a numeric pixel id." };
      const days = Math.min(90, Math.max(1, Math.round(Number(input.days) || 30)));
      return getPixelStats(id, { days });
    }
    case "remember": {
      const kind = String(input.kind ?? "");
      if (!(MEMORY_KINDS as string[]).includes(kind)) return { error: `kind must be one of: ${MEMORY_KINDS.join(", ")}` };
      const content = String(input.content ?? "");
      if (!content.trim()) return { error: "remember needs content." };
      return remember(AGENT, kind as MemoryKind, String(input.subject ?? "global"), content, actor, input.shared === true);
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
      return { error: `Unknown tool ${name}` };
  }
}

// Bookkeeping tools run AFTER the answer is written, not before it, so any text
// streamed ahead of them is the reply itself and must survive the tool turn.
const BOOKKEEPING_TOOLS = new Set(["remember", "revise_memory", "forget"]);
const PREAMBLE_MAX_CHARS = 400;

function isPreamble(text: string, toolUses: { name: string }[]): boolean {
  if (toolUses.every((t) => BOOKKEEPING_TOOLS.has(t.name))) return false;
  return text.trim().length <= PREAMBLE_MAX_CHARS;
}

/** Streaming Bernard chat. Same NDJSON event contract as Oscar so the UI
 *  plumbing is shared: status while tools run, delta for answer text, reset to
 *  drop tool-turn preamble, artifact for a download, then done (or error). */
export async function runBernardChatStream(
  history: ChatMessage[],
  actor: string,
  emitRaw: (ev: AgentEvent) => void,
  attachments: Attachment[] = [],
): Promise<void> {
  // The no-em-dash ruling is enforced in code, not just asked of the prompt.
  const scrub = makeEmDashScrubber();
  const emit = (ev: AgentEvent) =>
    emitRaw(ev.type === "delta" && ev.text ? { ...ev, text: scrub(ev.text) } : ev);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit({ type: "delta", text: "Bernard is not configured (no ANTHROPIC_API_KEY)." });
    emit({ type: "done" });
    return;
  }
  const client = new Anthropic({ apiKey });
  // Memory is read fresh each turn, so anything Bernard remembered a moment ago
  // is already in scope.
  const system = buildSystem(renderMemories(await loadMemories(AGENT), AGENT));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  // Files ride on the turn they were sent with, as document blocks ahead of the
  // founder's text so Bernard reads them before the instruction about them.
  // Extracted text also lands in the stored transcript (see transcriptNote), so
  // it survives into later turns; a PDF does not, because we hold only the bytes
  // for the length of this request. Re-attach if a PDF is needed again later.
  if (attachments.length && messages.length) {
    const last = messages[messages.length - 1];
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = attachments.map((a) =>
      a.kind === "pdf"
        ? { type: "document", title: a.name, source: { type: "base64", media_type: "application/pdf", data: a.base64 } }
        : { type: "document", title: a.name, source: { type: "text", media_type: "text/plain", data: a.text } },
    );
    blocks.push({ type: "text", text: typeof last.content === "string" ? last.content : "" });
    messages[messages.length - 1] = { role: "user", content: blocks };
  }

  try {
    for (let i = 0; i < 8; i++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: FALLBACK_MODEL }],
        system,
        tools: TOOLS,
        messages,
      });
      let turnText = "";
      stream.on("text", (t) => {
        turnText += t;
        emit({ type: "delta", text: t });
      });
      const final = await stream.finalMessage();

      if (final.stop_reason === "refusal") {
        emit({ type: "reset" });
        emit({ type: "delta", text: "I cannot answer that one: the request was declined by a safety check. Rephrase it and I will try again." });
        emit({ type: "done" });
        return;
      }

      const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
        emit({ type: "done" });
        return;
      }

      messages.push({ role: "assistant", content: sanitizeForEcho(final.content) });
      // Drop preamble streamed during a tool turn, never the answer itself.
      if (isPreamble(turnText, toolUses)) emit({ type: "reset" });

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        emit({ type: "status", text: statusLabel(tu.name) });
        let out: unknown;
        try {
          out = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, actor);
        } catch (e) {
          out = { error: e instanceof Error ? e.message : String(e) };
        }
        // A finished audit gets a first-class download chip in the panel.
        const dl = out as { download_path?: string; account?: { name?: unknown } } | null;
        if (tu.name === "run_audit" && dl?.download_path) {
          const who = typeof dl.account?.name === "string" ? dl.account.name : "account";
          emit({ type: "artifact", text: dl.download_path, label: `Download the ${who} Meta audit (.docx)` });
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 80_000) });
      }
      messages.push({ role: "user", content: results });
    }
    emit({ type: "delta", text: "\n\n(Stopped after several steps. Ask me one thing at a time.)" });
    emit({ type: "done" });
  } catch (e) {
    emit({ type: "error", text: e instanceof Error ? e.message : String(e) });
    emit({ type: "done" });
  }
}

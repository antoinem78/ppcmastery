// POST /api/agent/chat — streams Oscar, the Google Ads analyst, as NDJSON (one
// JSON event per line: status | delta | reset | artifact | done | error).
// Admin-gated.
//
// The signed-in admin's email is passed as the ACTOR: Oscar can approve, apply
// and build on the founder's explicit word, and every one of those lands in
// write_audit / the proposal record. The approver recorded there must be the
// human who gave the word, never the agent that relayed it.
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { runAgentChatStream, type AgentEvent, type ChatMessage } from "@/lib/integrations/anthropic/agent";

export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session) return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
  const user = session.user as Record<string, unknown>;
  if (!isAgencyAdmin(user)) {
    return new Response(JSON.stringify({ error: "Agency admin role required." }), { status: 403 });
  }
  const actor = `admin:${typeof user.email === "string" ? user.email : "unknown"}`;

  let messages: ChatMessage[] = [];
  let focusClientId: string | null = null;
  try {
    const body = (await req.json()) as { messages?: ChatMessage[]; focusClientId?: string | null };
    messages = Array.isArray(body.messages) ? body.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : [];
    focusClientId = typeof body.focusClientId === "string" && body.focusClientId ? body.focusClientId : null;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400 });
  }
  if (messages.length === 0) return new Response(JSON.stringify({ error: "No messages." }), { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runAgentChatStream(messages, emit, focusClientId, actor);
      } catch (e) {
        emit({ type: "error", text: e instanceof Error ? e.message : "Stream failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

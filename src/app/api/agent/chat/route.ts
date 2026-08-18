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
import { attachmentsFromFormData, transcriptNote, AttachmentError, type Attachment } from "@/lib/attachments";

export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session) return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
  const user = session.user as Record<string, unknown>;
  if (!isAgencyAdmin(user)) {
    return new Response(JSON.stringify({ error: "Agency admin role required." }), { status: 403 });
  }
  const actor = `admin:${typeof user.email === "string" ? user.email : "unknown"}`;

  // Two request shapes, same contract as /api/bernard/chat so the client
  // plumbing stays shared: JSON (text only), or multipart/form-data (text plus
  // attachments) carrying the history as a "messages" JSON field.
  let body: { messages?: ChatMessage[]; focusClientId?: string | null };
  let attachments: Attachment[] = [];
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return new Response(JSON.stringify({ error: "Could not read the upload." }), { status: 400 });
    }
    try {
      body = JSON.parse(String(form.get("messages") ?? "{}")) as {
        messages?: ChatMessage[];
        focusClientId?: string | null;
      };
    } catch {
      return new Response(JSON.stringify({ error: "Invalid messages payload." }), { status: 400 });
    }
    // The focus account rides in the JSON with the history, but accept a
    // separate form field too, so a hand-rolled multipart caller cannot
    // silently land the turn in the general thread instead of the client's.
    const formFocus = form.get("focusClientId");
    if (typeof formFocus === "string" && formFocus) body.focusClientId = formFocus;
    try {
      attachments = await attachmentsFromFormData(form);
    } catch (e) {
      const msg = e instanceof AttachmentError ? e.message : "That file could not be read.";
      return new Response(JSON.stringify({ error: msg }), { status: 400 });
    }
  } else {
    try {
      body = (await req.json()) as { messages?: ChatMessage[]; focusClientId?: string | null };
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400 });
    }
  }

  const messages: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    : [];
  const focusClientId = typeof body.focusClientId === "string" && body.focusClientId ? body.focusClientId : null;
  if (messages.length === 0) return new Response(JSON.stringify({ error: "No messages." }), { status: 400 });
  if (attachments.length && messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "Attachments need a user message to ride on." }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      // Oscar's transcript persists CLIENT-side (per-scope, via
      // /api/agent/conversation), and the client never sees the extracted text
      // of an upload. Hand it back the turn as it should be stored: transcript
      // notes first, then the typed text, so extracted text survives into
      // later turns. PDFs store as a filename marker only.
      if (attachments.length) {
        emit({
          type: "user_stored",
          text: [...attachments.map(transcriptNote), messages[messages.length - 1].content].join("\n\n"),
        });
      }
      try {
        await runAgentChatStream(messages, emit, focusClientId, actor, attachments);
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

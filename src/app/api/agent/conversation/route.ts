// Load / save / clear a per-scope AI-analyst conversation. Admin-gated.
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { getConversation, saveConversation, clearConversation } from "@/lib/agent-conversations";
import type { ChatMessage } from "@/lib/integrations/anthropic/agent";

async function guard(): Promise<Response | null> {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return null;
}

const scopeOf = (req: Request) => new URL(req.url).searchParams.get("scope")?.trim() || "general";

export async function GET(req: Request) {
  const blocked = await guard();
  if (blocked) return blocked;
  return NextResponse.json({ messages: await getConversation(scopeOf(req)) });
}

export async function POST(req: Request) {
  const blocked = await guard();
  if (blocked) return blocked;
  let body: { scope?: string; messages?: ChatMessage[] };
  try {
    body = (await req.json()) as { scope?: string; messages?: ChatMessage[] };
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const scope = body.scope?.trim() || "general";
  const messages = Array.isArray(body.messages)
    ? body.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    : [];
  await saveConversation(scope, messages);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const blocked = await guard();
  if (blocked) return blocked;
  await clearConversation(scopeOf(req));
  return NextResponse.json({ ok: true });
}

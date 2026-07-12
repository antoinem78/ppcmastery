// Documenso webhook receiver. Documenso POSTs events with the webhook's shared
// secret in the X-Documenso-Secret header (constant-time compared here).
// DOCUMENT_COMPLETED marks the contract signed and advances the client to
// payment; other events are acknowledged and ignored.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { markContractSigned } from "@/lib/integrations/contracts";

// Needs Node crypto; never cached. (Auth0 is kept off api/webhooks via the
// proxy matcher.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request) {
  const secret = process.env.DOCUMENSO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("DOCUMENSO_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const provided = request.headers.get("x-documenso-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (!provided || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let payload: { event?: string; payload?: { id?: number; externalId?: string | null } };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.event !== "DOCUMENT_COMPLETED" || !payload.payload) {
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  // Prefer the externalId we set at creation (the client id); fall back to the
  // stored document id. Unknown = not ours -> 200 no-op (don't make Documenso retry).
  let clientId = payload.payload.externalId ?? null;
  if (!clientId && payload.payload.id != null) {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("onboarding_state")
      .select("client_id")
      .eq("pandadoc_document_id", String(payload.payload.id))
      .single();
    clientId = (data?.client_id as string | undefined) ?? null;
  }
  if (!clientId) return NextResponse.json({ ok: true, ignored: "unknown document" });

  await markContractSigned(clientId, "documenso-webhook");
  return NextResponse.json({ ok: true });
}

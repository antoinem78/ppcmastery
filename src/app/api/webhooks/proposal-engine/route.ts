// Proposal-engine webhook receiver. The engine POSTs proposal events with a
// hex HMAC-SHA256 of the raw body (shared secret PROPOSAL_ENGINE_WEBHOOK_SECRET)
// in the X-Signature header. proposal.accepted marks the contract signed and
// advances the client to payment; other events are acknowledged and ignored
// (the portal reads engagement stats from the engine directly when needed).
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { markContractSigned } from "@/lib/integrations/contracts";

// HMAC verification needs Node crypto + the untouched raw body — never the Edge
// runtime, never cached. (Auth0 is kept off api/webhooks via the proxy matcher.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request) {
  const secret = process.env.PROPOSAL_ENGINE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("PROPOSAL_ENGINE_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const signature = request.headers.get("x-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await request.text();
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let payload: { event?: string; proposal?: { id?: string } };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.event !== "proposal.accepted" || !payload.proposal?.id) {
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  // The provider's document id lives in pandadoc_document_id whichever provider
  // the deployment uses. Unknown id = not ours (or a foreign event) → 200 no-op
  // so the engine doesn't retry forever.
  const supabase = createSupabaseAdminClient();
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("client_id")
    .eq("pandadoc_document_id", payload.proposal.id)
    .single();
  if (!state) return NextResponse.json({ ok: true, ignored: "unknown document" });

  await markContractSigned(state.client_id as string, "proposal-engine-webhook");
  return NextResponse.json({ ok: true });
}

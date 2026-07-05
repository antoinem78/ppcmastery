// PandaDoc webhook receiver. PandaDoc POSTs an array of events with an HMAC
// signature in the ?signature= query param (SHA-256 over the raw body using
// the shared key shown when the webhook is created in PandaDoc settings).
// document_state_changed → document.completed marks the contract signed.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { markContractSigned } from "@/lib/integrations/pandadoc";

// HMAC verification needs Node crypto + the untouched raw body — never the Edge
// runtime, never cached. (Auth0 is also kept off this path via the proxy
// matcher; see src/proxy.ts.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request) {
  const secret = process.env.PANDADOC_WEBHOOK_KEY;
  if (!secret) {
    console.error("PANDADOC_WEBHOOK_KEY is not configured.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const signature = url.searchParams.get("signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const events = JSON.parse(rawBody) as Array<{
      event: string;
      data?: { status?: string; metadata?: Record<string, string> };
    }>;
    for (const e of events) {
      if (
        e.event === "document_state_changed" &&
        e.data?.status === "document.completed" &&
        e.data.metadata?.client_id
      ) {
        await markContractSigned(e.data.metadata.client_id, "pandadoc-webhook");
      }
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("PandaDoc webhook handling failed:", e);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }
}

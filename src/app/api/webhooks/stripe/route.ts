// Stripe webhook receiver. Stripe POSTs events here; the signature check
// proves they're really from Stripe. checkout.session.completed is the event
// that flips a client to paid + active (idempotent — the checkout-return path
// may have won the race already).
import { NextResponse } from "next/server";
import {
  constructWebhookEvent,
  finalizePaidClient,
} from "@/lib/integrations/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Signature verification needs the raw, unparsed body.
  const rawBody = await request.text();

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (e) {
    console.error("Stripe webhook signature verification failed:", e);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const clientId =
        session.client_reference_id ?? session.metadata?.client_id;
      if (clientId && session.payment_status === "paid") {
        await finalizePaidClient({
          clientId,
          stripeCustomerId:
            typeof session.customer === "string" ? session.customer : null,
          stripeSubscriptionId:
            typeof session.subscription === "string"
              ? session.subscription
              : null,
          source: "stripe-webhook",
        });
      }
    }
    // Other event types (payment failures, cancellations) get handlers as the
    // ops flows need them. Always 200 so Stripe doesn't retry forever.
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("Stripe webhook handling failed:", e);
    // Non-2xx makes Stripe retry with backoff — desirable for transient DB errors.
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }
}

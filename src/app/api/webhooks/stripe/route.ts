// Stripe webhook receiver. Stripe POSTs events here; the signature check
// proves they're really from Stripe. checkout.session.completed is the event
// that flips a client to paid + active (idempotent — the checkout-return path
// may have won the race already).
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  constructWebhookEvent,
  finalizePaidClient,
  markPaymentFailed,
  markPaymentRecovered,
  markSubscriptionEnded,
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
    const subIdOf = (inv: Stripe.Invoice): string | null => {
      const sub = (inv as unknown as { subscription?: string | { id: string } })
        .subscription;
      return typeof sub === "string" ? sub : (sub?.id ?? null);
    };

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const clientId = session.client_reference_id ?? session.metadata?.client_id;
        if (clientId && session.payment_status === "paid") {
          await finalizePaidClient({
            clientId,
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : null,
            stripeSubscriptionId:
              typeof session.subscription === "string" ? session.subscription : null,
            source: "stripe-webhook",
          });
        }
        break;
      }
      // A renewal payment failed → client goes into dunning ('past_due').
      case "invoice.payment_failed": {
        const subId = subIdOf(event.data.object);
        if (subId) await markPaymentFailed(subId);
        break;
      }
      // A renewal succeeded → recover a past_due client back to active.
      case "invoice.paid": {
        const subId = subIdOf(event.data.object);
        if (subId) await markPaymentRecovered(subId);
        break;
      }
      // Subscription fully ended at Stripe (after the 31-day notice) → churned.
      case "customer.subscription.deleted": {
        await markSubscriptionEnded(event.data.object.id);
        break;
      }
    }
    // Always 200 so Stripe doesn't retry forever (real failures throw → 500).
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("Stripe webhook handling failed:", e);
    // Non-2xx makes Stripe retry with backoff — desirable for transient DB errors.
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }
}

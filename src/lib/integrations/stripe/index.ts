// Stripe integration seam — Phase 2 (subscription collection).
// The rest of the app imports these functions; nothing else touches the SDK.
//
// Billing model: 1-month rolling subscription billed in advance on the signup
// date each month. Cancellation = 31 days' notice → set cancel_at on the
// subscription (NOT cancel_at_period_end); the renewal inside the notice
// window still bills.
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { entityConfig } from "@/lib/config";
import { getTier, tierName, CUSTOM_PLAN_NAME, type Tier } from "@/lib/tiers";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("PASTE_")) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  }
  return new Stripe(key);
}

/**
 * Find the Stripe Price for a tier via its lookup_key (= tier key, e.g.
 * "ps-5k"). Prices are seeded by scripts/seed-stripe-prices.mjs; if one is
 * missing we fail loudly rather than charging a wrong amount.
 */
async function getPriceIdForTier(tier: Tier): Promise<string> {
  const stripe = getStripe();
  const prices = await stripe.prices.list({
    lookup_keys: [tier.key],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `No Stripe price found for tier "${tier.key}". Run scripts/seed-stripe-prices.mjs.`,
    );
  }
  return price.id;
}

/**
 * Create a Stripe Checkout session for the client's configured tier — or, for
 * negotiated deals, their custom monthly price (ad-hoc price, same product
 * naming, still a monthly subscription anchored at signup).
 */
export async function createCheckoutSessionForClient(client: {
  id: string;
  contact_email: string;
  service_tier: string | null;
  custom_monthly_price?: number | null;
}): Promise<string> {
  const tier = getTier(client.service_tier);
  if (!tier && !client.custom_monthly_price) {
    throw new Error("Client has no valid service tier or custom price configured.");
  }

  const stripe = getStripe();
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";

  const lineItem = client.custom_monthly_price
    ? {
        price_data: {
          currency: entityConfig.currency.toLowerCase(),
          unit_amount: client.custom_monthly_price * 100,
          recurring: { interval: "month" as const },
          product_data: { name: CUSTOM_PLAN_NAME },
        },
        quantity: 1,
      }
    : { price: await getPriceIdForTier(tier!), quantity: 1 };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [lineItem],
    customer_email: client.contact_email,
    client_reference_id: client.id,
    metadata: { client_id: client.id },
    subscription_data: { metadata: { client_id: client.id } },
    // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect.
    success_url: `${base}/onboarding/${client.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/onboarding/${client.id}`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

/**
 * Mark a client paid + active. Idempotent: safe to call from both the webhook
 * and the success-URL path — whichever arrives first wins, the other no-ops.
 */
export async function finalizePaidClient(params: {
  clientId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  source: string; // "stripe-webhook" | "checkout-return"
}): Promise<{ alreadyDone: boolean }> {
  const supabase = createSupabaseAdminClient();

  const { data: state } = await supabase
    .from("onboarding_state")
    .select("payment_status")
    .eq("client_id", params.clientId)
    .single();
  if (!state) throw new Error(`No onboarding state for client ${params.clientId}.`);
  if (state.payment_status === "paid") return { alreadyDone: true };

  // Payment is the hinge: past it, the client sees the home/checklist (driven
  // by payment_status, not current_step). Mark the linear wizard complete.
  const { error: stateErr } = await supabase
    .from("onboarding_state")
    .update({ payment_status: "paid", current_step: "complete" })
    .eq("client_id", params.clientId);
  if (stateErr) throw new Error(stateErr.message);

  const { error: clientErr } = await supabase
    .from("clients")
    .update({
      status: "active",
      stripe_customer_id: params.stripeCustomerId,
      stripe_subscription_id: params.stripeSubscriptionId,
    })
    .eq("id", params.clientId);
  if (clientErr) throw new Error(clientErr.message);

  await logActivity({
    clientId: params.clientId,
    eventType: "payment_completed",
    actor: `system:${params.source}`,
    payload: { subscription_id: params.stripeSubscriptionId },
  });
  await logActivity({
    clientId: params.clientId,
    eventType: "client_activated",
    actor: `system:${params.source}`,
  });
  return { alreadyDone: false };
}

/**
 * Success-URL fallback path: verify the Checkout session with Stripe (never
 * trust the URL alone) and finalize if genuinely paid. Lets the local flow
 * complete without webhooks; in production the webhook usually wins the race.
 */
export async function finalizeFromCheckoutSession(
  clientId: string,
  sessionId: string,
): Promise<boolean> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (
    session.client_reference_id !== clientId ||
    session.payment_status !== "paid"
  ) {
    return false;
  }
  await finalizePaidClient({
    clientId,
    stripeCustomerId:
      typeof session.customer === "string"
        ? session.customer
        : (session.customer?.id ?? null),
    stripeSubscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : (session.subscription?.id ?? null),
    source: "checkout-return",
  });
  return true;
}

const NOTICE_DAYS = 31;

/**
 * Schedule cancellation with 31 days' notice: set the subscription's `cancel_at`
 * to now + 31 days (NOT cancel_at_period_end) so the renewal that falls inside
 * the notice window still bills — guaranteeing one final payment. The client
 * stays 'active' until Stripe actually ends it (customer.subscription.deleted →
 * churned). Returns the effective date.
 */
export async function scheduleCancellation(clientId: string): Promise<Date> {
  const supabase = createSupabaseAdminClient();
  const { data: client } = await supabase
    .from("clients")
    .select("stripe_subscription_id")
    .eq("id", clientId)
    .single();
  if (!client?.stripe_subscription_id) {
    throw new Error("This client has no Stripe subscription to cancel.");
  }

  const cancelAt = new Date(Date.now() + NOTICE_DAYS * 24 * 60 * 60 * 1000);
  await getStripe().subscriptions.update(client.stripe_subscription_id, {
    cancel_at: Math.floor(cancelAt.getTime() / 1000),
  });

  await supabase
    .from("clients")
    .update({ cancellation_effective_at: cancelAt.toISOString() })
    .eq("id", clientId);

  await logActivity({
    clientId,
    eventType: "subscription_cancellation_scheduled",
    actor: "admin",
    payload: { effective_at: cancelAt.toISOString(), notice_days: NOTICE_DAYS },
  });
  return cancelAt;
}

/** Undo a scheduled cancellation (clear cancel_at) before it takes effect. */
export async function resumeSubscription(clientId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { data: client } = await supabase
    .from("clients")
    .select("stripe_subscription_id")
    .eq("id", clientId)
    .single();
  if (!client?.stripe_subscription_id) {
    throw new Error("This client has no Stripe subscription.");
  }

  await getStripe().subscriptions.update(client.stripe_subscription_id, {
    cancel_at: null,
  });
  await supabase
    .from("clients")
    .update({ cancellation_effective_at: null })
    .eq("id", clientId);

  await logActivity({
    clientId,
    eventType: "subscription_cancellation_resumed",
    actor: "admin",
  });
}

/** Find the client behind a Stripe subscription id. */
async function clientBySubscription(subscriptionId: string) {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("clients")
    .select("id, status")
    .eq("stripe_subscription_id", subscriptionId)
    .single();
  return data;
}

/** Renewal payment failed → move the client into dunning ('past_due'). */
export async function markPaymentFailed(subscriptionId: string): Promise<void> {
  const client = await clientBySubscription(subscriptionId);
  if (!client || client.status === "past_due" || client.status === "churned") return;
  const supabase = createSupabaseAdminClient();
  await supabase.from("clients").update({ status: "past_due" }).eq("id", client.id);
  await logActivity({
    clientId: client.id,
    eventType: "payment_failed",
    actor: "system:stripe-webhook",
    payload: { subscription_id: subscriptionId },
  });
}

/** A renewal succeeded → if the client was in dunning, restore to 'active'. */
export async function markPaymentRecovered(subscriptionId: string): Promise<void> {
  const client = await clientBySubscription(subscriptionId);
  if (!client || client.status !== "past_due") return;
  const supabase = createSupabaseAdminClient();
  await supabase.from("clients").update({ status: "active" }).eq("id", client.id);
  await logActivity({
    clientId: client.id,
    eventType: "payment_recovered",
    actor: "system:stripe-webhook",
    payload: { subscription_id: subscriptionId },
  });
}

/** Subscription ended at Stripe (after the notice window) → client churned. */
export async function markSubscriptionEnded(subscriptionId: string): Promise<void> {
  const client = await clientBySubscription(subscriptionId);
  if (!client || client.status === "churned") return;
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("clients")
    .update({ status: "churned", cancellation_effective_at: null })
    .eq("id", client.id);
  await logActivity({
    clientId: client.id,
    eventType: "subscription_ended",
    actor: "system:stripe-webhook",
    payload: { subscription_id: subscriptionId },
  });
}

/** Verify + parse a webhook payload. Throws on bad signature. */
export function constructWebhookEvent(
  rawBody: string,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}

/** Seed/repair the per-tier products & prices. Used by the seed script. */
export async function ensureTierPrice(tier: Tier): Promise<string> {
  const stripe = getStripe();
  const existing = await stripe.prices.list({
    lookup_keys: [tier.key],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0].id;

  const product = await stripe.products.create({
    name: tierName(tier),
    metadata: { tier_key: tier.key },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: tier.monthlyPrice * 100,
    currency: entityConfig.currency.toLowerCase(),
    recurring: { interval: "month" },
    lookup_key: tier.key,
    metadata: { tier_key: tier.key },
  });
  return price.id;
}

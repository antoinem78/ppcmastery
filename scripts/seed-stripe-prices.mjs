// Seed the per-tier Stripe products & prices (idempotent — safe to re-run).
// Run with:  node scripts/seed-stripe-prices.mjs
//
// ⚠️ The bands below MUST match src/lib/tiers.ts (kept inline because this
// plain-node script can't import the TypeScript module). If tiers change,
// update both files and re-run this script.
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const BANDS = [
  ["ps-1k", 1_000, 99],
  ["ps-2k", 2_000, 129],
  ["ps-3k", 3_000, 149],
  ["ps-5k", 5_000, 199],
  ["ps-10k", 10_000, 399],
  ["ps-15k", 15_000, 499],
  ["ps-20k", 20_000, 599],
];

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const currency = (get("CURRENCY") || "USD").toLowerCase();
const stripe = new Stripe(get("STRIPE_SECRET_KEY"));

const fmt = new Intl.NumberFormat("en", {
  style: "currency",
  currency: currency.toUpperCase(),
  maximumFractionDigits: 0,
});

for (const [key, cap, monthly] of BANDS) {
  const existing = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (existing.data[0]) {
    const p = existing.data[0];
    const ok = p.unit_amount === monthly * 100 && p.currency === currency;
    console.log(`${key}: exists (${p.id}) ${ok ? "✓ amount/currency match" : "⚠️ MISMATCH — fix manually in Stripe"}`);
    continue;
  }
  const product = await stripe.products.create({
    name: `Paid Search — ad spend under ${fmt.format(cap)}/mo`,
    metadata: { tier_key: key },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: monthly * 100,
    currency,
    recurring: { interval: "month" },
    lookup_key: key,
    metadata: { tier_key: key },
  });
  console.log(`${key}: created product ${product.id} + price ${price.id} (${fmt.format(monthly)}/mo)`);
}
console.log("Done.");

# Demo runsheet — Baptiste call (~15 min)

Keep this on a second screen/phone, NOT the shared screen.

## Pre-flight (10 min before the call)

1. ☐ Run migration 0005 in Supabase SQL Editor, then ping Claude to push the
   platforms update — OR skip and demo the currently-deployed version.
2. ☐ Admin → New client: company `Jenard Test Co`, contact `Baptiste Jenard`,
   **his PandaDoc-workspace email**, platforms ticked, pick a tier (or custom
   plan + price for the fancier demo). Copy the onboarding link into a Slack
   DM draft to him — don't send yet.
3. ☐ Tabs open: ① admin `/clients` ② Slack workspace ③ Stripe dashboard
   (TEST mode → Payments) ④ PandaDoc documents list.
4. ☐ Test card on clipboard: `4242 4242 4242 4242` (any expiry/CVC).
5. ☐ Claude Code open in case anything misbehaves.

## Act 1 — Context (2 min, talk over the admin dashboard)

> "Phases 0–3 are live: a closed prospect gets one link and onboards
> themselves — contract, payment, Slack — zero touches from us. Everything
> you'll see is sandboxed: test money, [DEV] contracts."

## Act 2 — Baptiste plays the client (5 min, he drives)

Send him the DM with the link. He should:
1. **Confirm details** (his name/company pre-filled — typo protection for the contract)
2. **Generate & sign agreement** — point out HIS name, company, plan, price,
   today's date merged in. He signs in-page.
3. **Payment** → test card → Stripe checkout → back automatically.
4. **Slack step** → his email → tell him to watch his Slack sidebar:
   `#client-jenard-test-co` appears and he's invited (he's a workspace member).
5. **Questionnaire** (the real paid-search template) → submit → "You're all set!"

## Act 3 — You show the ops side (5 min, you drive)

1. Admin client page: status **active**, plan/price, platforms, Slack email,
   **questionnaire answers panel**.
2. **Activity log** — the star exhibit. Read it bottom-up:
   `client_created → details_confirmed → contract_generated →
   contract_signed (pandadoc-webhook) → checkout_started →
   payment_completed (stripe-webhook) → client_activated →
   slack_channel_created → questionnaire_submitted`
   > "Every step timestamped, every integration confirmed by webhook."
3. Stripe tab: his **subscription** (monthly, anchored to today).
4. Slack: the channel exists; PandaDoc: the signed doc.

## Act 4 — His to-do list + roadmap (3 min)

Asks (his side):
- ☐ Legal review of the agreement text — incl. two notes: §1 hard-codes
  "Google + Microsoft only" (should become [quote.channels] for Meta clients);
  §5 zero-calls clause doesn't fit premium/custom deals.
- ☐ Production PandaDoc API key (kills [DEV], enables sending to real clients).
- ☐ Site copy: "30-day" → "31-day" cancellation notice.
- ☐ Stripe display name still "adenergy.online".
- ☐ Polish VAT treatment for invoices (rate + reverse-charge question).

Roadmap:
- Phase 4: Google Ads linking — client enters customer ID → we approve → MCC
  invitation from the PPC Mastery MCC (rides WMI's dev token until BJ PPC's
  approves) → client accepts inside Google Ads. Microsoft mirrors it.
- Then: WMI UK clone (env-config only), live Stripe keys when first real
  client is imminent.

## If something breaks

- Contract won't send → his email isn't in the PandaDoc workspace → recreate
  client with admin@ppcmastery.ai.
- Page seems stuck after Stripe/signing → refresh once (fallback path
  completes it).
- "[DEV] on the contract?" → sandbox watermark; his production key removes it.
- Anything else → ping Claude live on the spot.

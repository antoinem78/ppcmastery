# Onboarding funnel rehearsal, app.ppcmastery.ai

**For:** Baptiste (owns Stripe and admin@ppcmastery.ai)
**Date:** 2026-08-06
**Time needed:** about 20 minutes, plus a few minutes in Stripe afterwards
**What it costs:** one real charge of $1, refunded at the end

## Why we are doing this

The portal's onboarding funnel is complete and deployed, and most of it has been
exercised. But several parts went live today and have never run with a real
client: the transactional email layer, the signed-copy delivery, the provider
execution block on the agreement, the VAT breakdown, and the page that now
advances itself after signature.

A funnel that has never been walked end to end by a human is not working, it is
untested. When the sibling WMI portal was walked for the first time, the walk
found five defects in two days, including a contract email that never sent and a
page that stranded the client after signing. We would rather find ours on a $1
throwaway than on a paying client.

Please walk it as a client would, and note anything that looks wrong even if it
seems trivial.

## What only you can do

Two things in this rehearsal depend on access that only you have.

**1. The Stripe live-mode webhook check. Do this before anything else.**

Stripe webhook endpoints are per-mode, and the portal is running a live secret
key. If the only endpoint is a test-mode one, the client pays and the portal
never activates them, and nothing looks broken until they ask why nothing
happened. This is a real failure that has bitten this codebase before.

In Stripe, with **Live mode** switched on (not Test):

- Developers, then Webhooks
- Confirm an endpoint exists for `https://app.ppcmastery.ai/api/webhooks/stripe`
- Confirm it is subscribed to `checkout.session.completed`
- Reveal its signing secret and tell Antoine the first eight characters, so he
  can confirm it matches the one in the deployment. Do not paste the whole
  secret anywhere.

If there is no live endpoint, stop and tell Antoine. The rest of the walk will
produce a misleading result without it.

**2. The inbox.** admin@ppcmastery.ai is configured as the provider copy
address, so the agency-side emails land with you. You should already have one
there titled "Email delivery test, PPC mastery" from earlier today. If that is
missing, say so before starting.

## Before you start

Use a personal email address you control for the client side, **not**
admin@ppcmastery.ai. The agency copies and the client copies need to be
distinguishable, and if both go to the same inbox you cannot tell which email
the system actually sent to whom.

Have a real card ready. This is live mode.

## The walk

Sign in at app.ppcmastery.ai.

### 1. Create the client

New client, with:

- Company name: `Rehearsal Aug 6` (or anything obviously disposable)
- Contact name: your name
- Contact email: **your personal address**, not the admin one
- Monthly price: `1`
- Platforms: tick **Google Ads** only

**Check:** an onboarding invite email arrives at your personal address within a
minute or so. This email has never been sent by this deployment before. Note the
subject line, whether the link works, and how the sign-off reads.

### 2. Open the client link and confirm details

Open the invite link (or copy the onboarding link from the client page).

**Check:** the plan is named "Managed Google Ads Service", not "Paid Search".
The plan name now derives from the platforms picked at creation, so a Meta-only
client is never handed a paid search agreement. Since you ticked Google Ads
only, it should say Google Ads.

**Check:** the quote shows the price and what happens next.

### 3. Generate the agreement

Press the button to generate and sign.

**Check, on your personal address:** nothing yet, but Documenso will email you a
signing link shortly.

**Check, in admin@ppcmastery.ai:** an email titled roughly "Issued: Rehearsal
Aug 6 agreement is with the client". This is new. It exists so the agency sees
the document before the client accepts it, rather than after.

**Check, in the agreement itself:** near the top, under the two parties, there
should now be a sentence reading "Executed for and on behalf of the Provider by
[name, title] on [date]. The Provider is bound by this Agreement from the date
of issue; the Client's acceptance below completes it." This is new today and
makes the document two-party rather than one-sided.

### 4. Sign it

Sign in the embedded Documenso pane. You can type your name for a stylised
signature or draw one; both are enabled.

**Check:** after signing, the page moves itself on to Payment **without you
reloading it**. It polls every four seconds. Previously the client sat on a dead
page until they refreshed, which is how the sibling portal lost a client's
attention on its first real run. If you have to reload, that is a defect worth
reporting.

**Check, on your personal address:** the signed agreement arrives with the
sealed PDF attached.

**Check, in admin@ppcmastery.ai:** the counter-copy arrives, also with the PDF.

### 5. The payment step

**Check:** how the amount is presented before you reach the card. If VAT is
configured it should break out service, VAT and the gross due today, described
as an estimate. If it shows a single "Due today" line, that is expected right
now (see Known issues below), not a bug to report.

Continue to Stripe checkout and pay the $1 with a real card.

**Check:** you land back in the portal and the client is now **active**, not
stuck on payment. This is the step the live-mode webhook check protects.

**Check, on your personal address:** a payment confirmation email. New today.

### 6. Look at the client record

Back in the admin area, open the client.

**Check:** status active, the agreement recorded as signed, the payment
recorded.

**Check:** on the dashboard link row, press **Enable link**. It should produce a
share URL. Open it in a private window: it should load a read-only dashboard.
Press **Disable link** and reload that URL: it should now be gone. Client share
links are off by default and revocable as of today.

## Known issues, please do not report these as defects

Two things are already known and are being handled separately. Flag anything
else, however small.

1. **The agreement names the Provider as "PPC mastery"** rather than the legal
   entity, sitting next to the Krakow registration address. A configuration
   value is not yet set. Expected.
2. **VAT may not be broken out** on the quote. The VAT rate is not yet
   configured, so the breakdown stays hidden. Expected.

## Cleanup, once the walk is done

In Stripe (live mode):

1. Refund the $1 charge
2. Cancel the subscription that was created, so it does not renew next month

In the portal:

3. Delete the rehearsal client

## What to send back

For each numbered step, whether it behaved as described. For anything that did
not, the most useful thing is what you saw, what you expected, and roughly when
it happened, so the server logs can be matched to it.

The emails matter most. Five separate messages should have arrived across the
two inboxes:

| # | To | What |
|---|---|---|
| 1 | your personal address | onboarding invite |
| 2 | admin@ppcmastery.ai | agreement issued notice |
| 3 | your personal address | signed agreement, PDF attached |
| 4 | admin@ppcmastery.ai | signed counter-copy, PDF attached |
| 5 | your personal address | payment confirmation |

If any of those five is missing, that is the single most valuable thing you can
tell us, because none of them has ever been sent by this deployment to a real
person before.

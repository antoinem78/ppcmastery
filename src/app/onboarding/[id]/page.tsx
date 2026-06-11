// Public, link-driven onboarding wizard. Prospects arrive having verbally
// agreed a quote, so the order optimises for time-to-signature:
//   confirm details -> contract -> payment -> Slack invite -> questionnaire.
// The step shown is driven by onboarding_state; each action advances it.
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  getTier,
  tierName,
  CUSTOM_PLAN_NAME,
  planBlurb,
  planFeatures,
} from "@/lib/tiers";
import { formatMoney } from "@/lib/config";
import { Wordmark } from "@/components/Wordmark";
import {
  confirmDetails,
  generateContract,
  confirmContractSigned,
  startCheckout,
  submitSlackEmail,
  submitQuestionnaire,
} from "./actions";
import { finalizeFromCheckoutSession } from "@/lib/integrations/stripe";
import {
  getDocumentStatus,
  createSigningSession,
  markContractSigned,
} from "@/lib/integrations/pandadoc";

// Contract generation polls PandaDoc for a few seconds; allow headroom.
export const maxDuration = 60;

export const dynamic = "force-dynamic";

const WIZARD_STEPS = [
  { key: "details", label: "Details" },
  { key: "contract", label: "Contract" },
  { key: "payment", label: "Payment" },
  { key: "slack", label: "Slack" },
  { key: "questionnaire", label: "Questionnaire" },
] as const;

export default async function OnboardingWizardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { id } = await params;
  const { session_id: sessionId } = await searchParams;
  const supabase = createSupabaseAdminClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, company_name, contact_name, contact_email, service_tier, custom_monthly_price, platforms",
    )
    .eq("id", id)
    .single();
  if (!client) notFound();

  const { data: state } = await supabase
    .from("onboarding_state")
    .select("current_step, details_confirmed, pandadoc_document_id")
    .eq("client_id", id)
    .single();

  let step: string = state?.current_step ?? "contract";

  // Contract step with a generated document: check its real status with
  // PandaDoc. Completed → advance (fallback for the webhook); otherwise mint a
  // fresh embedded-signing session for the iframe.
  let signingUrl: string | null = null;
  if (step === "contract" && state?.details_confirmed && state.pandadoc_document_id) {
    try {
      const status = await getDocumentStatus(state.pandadoc_document_id);
      if (status === "document.completed") {
        await markContractSigned(id, "contract-return");
        step = "payment";
      } else if (status === "document.sent" || status === "document.viewed") {
        signingUrl = await createSigningSession(
          state.pandadoc_document_id,
          client.contact_email,
        );
      }
    } catch (e) {
      console.error("Contract status check failed:", e);
    }
  }

  // Returning from Stripe Checkout: verify with Stripe (never trust the URL)
  // and finalize if paid — idempotent alongside the webhook.
  if (step === "payment" && sessionId) {
    try {
      const paid = await finalizeFromCheckoutSession(id, sessionId);
      if (paid) step = "slack";
    } catch (e) {
      console.error("Checkout-return verification failed:", e);
    }
  }

  // Custom price (or the custom pseudo-tier) → the client only ever sees the
  // neutral plan name, never the underlying band.
  const tier = getTier(client.service_tier);
  const price = client.custom_monthly_price ?? tier?.monthlyPrice ?? 0;
  const planName = client.custom_monthly_price
    ? CUSTOM_PLAN_NAME
    : tier
      ? tierName(tier)
      : null;
  const isCustom = !!client.custom_monthly_price;
  const isComplete = step === "complete" || step === "ad_linking";
  const displayStep = step === "contract" && !state?.details_confirmed ? "details" : step;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-4 text-lg">
          <Wordmark variant="dark" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {!isComplete && <StepIndicator current={displayStep} />}

        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          {displayStep === "details" && <DetailsStep id={id} client={client} />}
          {displayStep === "contract" && (
            <ContractStep
              id={id}
              planName={planName}
              price={price}
              isCustom={isCustom}
              platforms={client.platforms}
              signingUrl={signingUrl}
            />
          )}
          {displayStep === "payment" && (
            <PaymentStep
              id={id}
              planName={planName}
              price={price}
              isCustom={isCustom}
              platforms={client.platforms}
            />
          )}
          {displayStep === "slack" && (
            <SlackStep id={id} defaultEmail={client.contact_email} />
          )}
          {displayStep === "questionnaire" && <QuestionnaireStep id={id} />}
          {isComplete && <CompleteStep company={client.company_name} />}
        </div>
      </main>
    </div>
  );
}

function StepIndicator({ current }: { current: string }) {
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.key === current);
  const idx = currentIdx === -1 ? WIZARD_STEPS.length : currentIdx;
  return (
    <ol className="flex items-center gap-2">
      {WIZARD_STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-[#0B1F3A] text-white"
                    : "bg-zinc-200 text-zinc-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`hidden text-sm sm:inline ${active ? "font-medium text-zinc-900" : "text-zinc-500"}`}
            >
              {s.label}
            </span>
            {i < WIZARD_STEPS.length - 1 && (
              <span className="mx-1 h-px flex-1 bg-zinc-200" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DetailsStep({
  id,
  client,
}: {
  id: string;
  client: {
    company_name: string;
    contact_name: string | null;
    contact_email: string;
  };
}) {
  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">Confirm your details</h1>
      <p className="mt-1 text-sm text-zinc-500">
        These go into your agreement — please check they&rsquo;re exactly right.
      </p>

      <form action={confirmDetails.bind(null, id)} className="mt-6 space-y-5">
        <Field label="Company legal name" required>
          <input
            name="company_name"
            required
            defaultValue={client.company_name}
            className={inputClass}
          />
        </Field>
        <Field label="Your full name (signer)" required>
          <input
            name="contact_name"
            required
            defaultValue={client.contact_name ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Email" required>
          <input
            name="contact_email"
            type="email"
            required
            defaultValue={client.contact_email}
            className={inputClass}
          />
        </Field>
        <SubmitButton>Looks right — continue</SubmitButton>
      </form>
    </>
  );
}

function ContractStep({
  id,
  planName,
  price,
  isCustom,
  platforms,
  signingUrl,
}: {
  id: string;
  planName: string | null;
  price: number;
  isCustom: boolean;
  platforms: string[] | null;
  signingUrl: string | null;
}) {
  if (signingUrl) {
    return (
      <>
        <h1 className="text-xl font-semibold text-zinc-900">
          Review &amp; sign your agreement
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Read through the agreement below and sign where indicated.
        </p>
        <iframe
          src={signingUrl}
          className="mt-6 h-[700px] w-full rounded-md border border-zinc-200"
          title="Service agreement"
        />
        <form action={confirmContractSigned.bind(null, id)} className="mt-4">
          <SubmitButton>I&rsquo;ve signed — continue</SubmitButton>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">Your agreement</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Here&rsquo;s the plan we agreed — generate your agreement to sign online.
      </p>

      <QuoteSummary
        planName={planName}
        price={price}
        isCustom={isCustom}
        platforms={platforms}
      />

      <form action={generateContract.bind(null, id)} className="mt-6">
        <SubmitButton>Generate &amp; sign your agreement</SubmitButton>
      </form>
      <p className="mt-3 text-xs text-zinc-400">
        Takes a few seconds — your agreement is prepared with your details and
        opens here for signing.
      </p>
    </>
  );
}

function PaymentStep({
  id,
  planName,
  price,
  isCustom,
  platforms,
}: {
  id: string;
  planName: string | null;
  price: number;
  isCustom: boolean;
  platforms: string[] | null;
}) {
  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">Payment</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Billed today, then on the same date each month — cancel anytime with 31
        days&rsquo; notice.
      </p>

      <QuoteSummary
        planName={planName}
        price={price}
        isCustom={isCustom}
        platforms={platforms}
      />

      <p className="mt-6 text-xs text-zinc-400">
        You&rsquo;ll be taken to Stripe&rsquo;s secure checkout to enter your
        payment details.
      </p>

      <form action={startCheckout.bind(null, id)} className="mt-4">
        <SubmitButton>Continue to secure payment</SubmitButton>
      </form>
    </>
  );
}

function SlackStep({ id, defaultEmail }: { id: string; defaultEmail: string }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">
        Your Slack channel
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        All communication runs through your dedicated channel in our Slack — fast,
        async, in writing. Which email should we invite?
      </p>

      <form action={submitSlackEmail.bind(null, id)} className="mt-6 space-y-5">
        <Field label="Email for your Slack invite" required>
          <input
            name="slack_email"
            type="email"
            required
            defaultValue={defaultEmail}
            className={inputClass}
          />
        </Field>
        <SubmitButton>Set up my channel</SubmitButton>
      </form>
      <p className="mt-3 text-xs text-zinc-400">
        You&rsquo;ll receive your invitation by email shortly — joining is free.
      </p>
    </>
  );
}

function QuestionnaireStep({ id }: { id: string }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">
        Onboarding questionnaire
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Last step — this is what our specialists use to build your campaigns.
        ~5 minutes, and the more specific the better.
      </p>

      <form action={submitQuestionnaire.bind(null, id)} className="mt-6 space-y-5">
        <Field label="What is your monthly budget for your campaigns?" required>
          <input name="monthly_budget" required className={inputClass} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="CPL / CPA target">
            <input name="cpl_cpa_target" className={inputClass} />
          </Field>
          <Field label="ROAS target">
            <input name="roas_target" className={inputClass} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-zinc-700">
            Which channels do you want to advertise on?
          </legend>
          <div className="flex flex-wrap gap-4">
            {["Google Ads", "Microsoft Ads", "Meta Ads"].map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="channels" value={p} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="What locations would you like your ads to be targeting?">
          <input name="target_locations" className={inputClass} />
        </Field>

        <Field label="What areas of your business would you like to focus your ads on? (e.g. installation, product sale)">
          <textarea name="business_focus" rows={2} className={inputClass} />
        </Field>

        <Field label="Are there any particular keywords you want us to use as a priority?">
          <textarea name="priority_keywords" rows={2} className={inputClass} />
        </Field>

        <Field label="Any keywords or areas of your business you'd like us to avoid targeting?">
          <textarea name="avoid_keywords" rows={2} className={inputClass} />
        </Field>

        <Field label="Do you have any unique selling points we can use in your ads? (e.g. free delivery, 5★ reviews)">
          <textarea name="usps" rows={2} className={inputClass} />
        </Field>

        <Field
          label="Which actions on your website are the most valuable to you? (e.g. phone calls, purchases, form submissions)"
          required
        >
          <textarea name="valuable_actions" rows={2} required className={inputClass} />
        </Field>

        <Field label="Do you want your ads running at particular times of day / days of the week?">
          <input name="ad_schedule" className={inputClass} />
        </Field>

        <Field label="Is there a certain demographic to focus on? (age, behaviours, interests — be as specific as possible)">
          <textarea name="demographics" rows={2} className={inputClass} />
        </Field>

        <Field label="Top 5 competitors">
          <textarea name="competitors" rows={2} className={inputClass} />
        </Field>

        <Field label="Images / videos for our creatives — link to a drive (optional)">
          <input
            name="drive_link"
            type="text"
            inputMode="url"
            placeholder="drive.google.com/…"
            className={inputClass}
          />
        </Field>

        <SubmitButton>Submit &amp; finish</SubmitButton>
      </form>
    </>
  );
}

function CompleteStep({ company }: { company: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
        ✓
      </div>
      <h1 className="mt-4 text-xl font-semibold text-zinc-900">You&rsquo;re all set!</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Thanks, {company}. Your onboarding is complete — keep an eye on your
        inbox for the Slack invitation; our team takes it from there.
      </p>
    </div>
  );
}

function QuoteSummary({
  planName,
  price,
  isCustom,
  platforms,
}: {
  planName: string | null;
  price: number;
  isCustom: boolean;
  platforms: string[] | null;
}) {
  if (!planName || !price) {
    return (
      <div className="mt-6 rounded-md bg-zinc-100 p-4 text-sm text-zinc-500">
        No plan configured.
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-semibold text-zinc-900">
          {planName}
          {isCustom && (
            <span className="ml-2 text-xs font-normal text-zinc-400">
              (agreed pricing)
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm text-zinc-500">
          {formatMoney(price)}/mo
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">{planBlurb(platforms, isCustom)}</p>
      <ul className="mt-3 space-y-1 text-sm text-zinc-600">
        {planFeatures(platforms, isCustom).map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-zinc-100 pt-3 text-sm">
        <span className="text-zinc-500">Due today (first month): </span>
        <span className="font-semibold text-zinc-900">{formatMoney(price)}</span>
        <div className="mt-1 text-xs text-zinc-400">
          Then billed on the same date each month. Cancel anytime with 31
          days&rsquo; notice.
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="rounded-md bg-[#0B1F3A] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
    >
      {children}
    </button>
  );
}

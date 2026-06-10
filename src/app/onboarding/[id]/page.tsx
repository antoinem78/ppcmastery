// Public, link-driven onboarding wizard. The step shown is driven by
// onboarding_state.current_step; each step's form advances to the next.
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  getTier,
  tierName,
  TIER_BLURB,
  TIER_FEATURES,
  type Tier,
} from "@/lib/tiers";
import { formatMoney } from "@/lib/config";
import { Wordmark } from "@/components/Wordmark";
import {
  submitQuestionnaire,
  completeContract,
  completePayment,
} from "./actions";

export const dynamic = "force-dynamic";

const WIZARD_STEPS = [
  { key: "questionnaire", label: "Questionnaire" },
  { key: "contract", label: "Contract" },
  { key: "payment", label: "Payment" },
] as const;

export default async function OnboardingWizardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, company_name, service_tier")
    .eq("id", id)
    .single();
  if (!client) notFound();

  const { data: state } = await supabase
    .from("onboarding_state")
    .select("current_step")
    .eq("client_id", id)
    .single();

  const step = state?.current_step ?? "questionnaire";
  const tier = getTier(client.service_tier);
  const isComplete = step === "complete" || step === "slack" || step === "ad_linking";

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-4 text-lg">
          <Wordmark variant="dark" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {!isComplete && <StepIndicator current={step} />}

        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          {step === "questionnaire" && <QuestionnaireStep id={id} />}
          {step === "contract" && <ContractStep id={id} tier={tier} />}
          {step === "payment" && <PaymentStep id={id} tier={tier} />}
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
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
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
              className={`text-sm ${active ? "font-medium text-zinc-900" : "text-zinc-500"}`}
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

function QuestionnaireStep({ id }: { id: string }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">
        Tell us about your business
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        This helps us set up your campaigns. Takes ~2 minutes.
      </p>

      <form action={submitQuestionnaire.bind(null, id)} className="mt-6 space-y-5">
        <Field label="Website" required>
          <input
            name="website_url"
            type="text"
            inputMode="url"
            required
            placeholder="spacex.com"
            className={inputClass}
          />
        </Field>

        <Field label="Industry" required>
          <input name="industry" required className={inputClass} />
        </Field>

        <Field label="Monthly ad budget" required>
          <select name="monthly_budget" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select a range…
            </option>
            <option>Under €1,000</option>
            <option>€1,000 – €5,000</option>
            <option>€5,000 – €20,000</option>
            <option>€20,000+</option>
          </select>
        </Field>

        <Field label="Primary goal" required>
          <select name="primary_goal" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select a goal…
            </option>
            <option value="leads">Leads</option>
            <option value="sales">Sales</option>
            <option value="awareness">Brand awareness</option>
          </select>
        </Field>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-zinc-700">
            Current ad platforms
          </legend>
          <div className="flex flex-wrap gap-4">
            {["Google Ads", "Microsoft Ads", "Meta", "None yet"].map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="platforms" value={p} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Target locations">
          <input
            name="target_locations"
            placeholder="e.g. Ireland, UK"
            className={inputClass}
          />
        </Field>

        <Field label="Main competitors">
          <input name="competitors" className={inputClass} />
        </Field>

        <Field label="Anything else?">
          <textarea name="notes" rows={3} className={inputClass} />
        </Field>

        <SubmitButton>Continue</SubmitButton>
      </form>
    </>
  );
}

function ContractStep({ id, tier }: { id: string; tier: Tier | null }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">Your agreement</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Review your plan and continue to sign.
      </p>

      <QuoteSummary tier={tier} />

      <div className="mt-6 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
        📄 The signable contract (PandaDoc) is added in the next phase. For now,
        clicking continue stands in for signing.
      </div>

      <form action={completeContract.bind(null, id)} className="mt-6">
        <SubmitButton>Continue to payment</SubmitButton>
      </form>
    </>
  );
}

function PaymentStep({ id, tier }: { id: string; tier: Tier | null }) {
  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900">Payment</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Billed today, then on the same date each month — cancel anytime with 31
        days&rsquo; notice.
      </p>

      <QuoteSummary tier={tier} />

      <div className="mt-6 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
        💳 Stripe checkout is added in the next phase. For now, clicking continue
        stands in for a successful payment.
      </div>

      <form action={completePayment.bind(null, id)} className="mt-6">
        <SubmitButton>Pay &amp; finish</SubmitButton>
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
        Thanks, {company}. Your onboarding is complete — our team will be in touch
        on Slack shortly to get your campaigns live.
      </p>
    </div>
  );
}

function QuoteSummary({ tier }: { tier: Tier | null }) {
  if (!tier) {
    return (
      <div className="mt-6 rounded-md bg-zinc-100 p-4 text-sm text-zinc-500">
        No plan configured.
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-semibold text-zinc-900">{tierName(tier)}</span>
        <span className="shrink-0 text-sm text-zinc-500">
          {formatMoney(tier.monthlyPrice)}/mo
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">{TIER_BLURB}</p>
      <ul className="mt-3 space-y-1 text-sm text-zinc-600">
        {TIER_FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-zinc-100 pt-3 text-sm">
        <span className="text-zinc-500">Due today (first month): </span>
        <span className="font-semibold text-zinc-900">
          {formatMoney(tier.monthlyPrice)}
        </span>
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

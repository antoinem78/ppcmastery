// Public, link-driven client journey.
//   Pre-payment: a linear, gated wizard (details -> contract -> payment).
//   Post-payment: a persistent HOME / checklist the client returns to over
//   days (questionnaire, Slack, Google Ads, + access grants in 5.2) — any
//   order, with a % completion bar.
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
  submitGoogleAdsCustomerId,
  toggleChecklistTask,
  submitAssetsLink,
} from "./actions";
import {
  ACCESS_TASKS,
  isAccessTaskKey,
  getGrantEmails,
  type AccessTaskKey,
} from "@/lib/access-tasks";
import { getDashboard, type DashboardPayload, type ReportWindow } from "@/lib/integrations/google-ads/reporting";
import { AdsDashboard } from "@/components/AdsDashboard";

function parseRange(raw: string | undefined): ReportWindow {
  const n = Number(raw);
  return n === 7 || n === 90 ? n : 28;
}
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
] as const;

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string; range?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const sessionId = sp.session_id;
  const range = parseRange(sp.range);
  const supabase = createSupabaseAdminClient();

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, company_name, contact_name, contact_email, service_tier, custom_monthly_price, platforms, access_tasks, source",
    )
    .eq("id", id)
    .single();
  if (!client) notFound();

  // Reporting-only clients have no onboarding funnel — never show the wizard.
  if (client.source === "reporting_only") {
    return (
      <Shell>
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-900">
            {client.company_name}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Your account is managed by PPC Mastery — there&rsquo;s nothing to set
            up here. Your team will share performance updates in Slack.
          </p>
        </div>
      </Shell>
    );
  }

  const { data: state } = await supabase
    .from("onboarding_state")
    .select(
      "current_step, details_confirmed, pandadoc_document_id, payment_status, ad_link_status, google_ads_customer_id, google_ads_reporting_customer_id, slack_invite_email, questionnaire_data, checklist, assets_drive_link",
    )
    .eq("client_id", id)
    .single();

  let paymentDone = state?.payment_status === "paid";

  // Returning from Stripe Checkout: verify with Stripe (never trust the URL)
  // and finalize if paid — idempotent alongside the webhook.
  if (!paymentDone && sessionId) {
    try {
      if (await finalizeFromCheckoutSession(id, sessionId)) paymentDone = true;
    } catch (e) {
      console.error("Checkout-return verification failed:", e);
    }
  }

  // ---- Post-payment: the client home / checklist ----
  if (paymentDone) {
    // Performance dashboard once the Google Ads link is active (cached, guarded
    // so a reporting hiccup never breaks the home).
    let dashboard: DashboardPayload | null = null;
    const adApproved =
      state?.ad_link_status === "approved" && state?.google_ads_customer_id;
    const reportingId =
      state?.google_ads_reporting_customer_id ?? state?.google_ads_customer_id;
    if (adApproved && reportingId) {
      try {
        dashboard = await getDashboard(id, reportingId, range);
      } catch (e) {
        console.error("Dashboard fetch failed:", e);
      }
    }
    return (
      <Shell>
        <ClientHome
          id={id}
          companyName={client.company_name}
          slackEmail={state?.slack_invite_email ?? null}
          defaultEmail={client.contact_email}
          questionnaire={
            (state?.questionnaire_data as Record<string, unknown> | null) ?? {}
          }
          adLinkStatus={state?.ad_link_status ?? "not_started"}
          customerId={state?.google_ads_customer_id ?? null}
          accessTasks={
            ((client.access_tasks as string[] | null) ?? []).filter(
              isAccessTaskKey,
            )
          }
          checklist={(state?.checklist as Record<string, boolean> | null) ?? {}}
          assetsLink={state?.assets_drive_link ?? null}
          dashboard={adApproved ? dashboard : undefined}
          dashboardRange={range}
          dashboardBasePath={`/onboarding/${id}`}
        />
      </Shell>
    );
  }

  // ---- Pre-payment: the linear wizard ----
  let step: string = state?.current_step ?? "contract";

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

  const tier = getTier(client.service_tier);
  const price = client.custom_monthly_price ?? tier?.monthlyPrice ?? 0;
  const planName = client.custom_monthly_price
    ? CUSTOM_PLAN_NAME
    : tier
      ? tierName(tier)
      : null;
  const isCustom = !!client.custom_monthly_price;
  const displayStep =
    step === "contract" && !state?.details_confirmed ? "details" : step;

  return (
    <Shell>
      <StepIndicator current={displayStep} />
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
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-4 text-lg">
          <Wordmark variant="dark" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10">{children}</main>
    </div>
  );
}

/* ============================ POST-PAYMENT HOME ============================ */

function ClientHome({
  id,
  companyName,
  slackEmail,
  defaultEmail,
  questionnaire,
  adLinkStatus,
  customerId,
  accessTasks,
  checklist,
  assetsLink,
  dashboard,
  dashboardRange,
  dashboardBasePath,
}: {
  id: string;
  companyName: string;
  slackEmail: string | null;
  defaultEmail: string;
  questionnaire: Record<string, unknown>;
  adLinkStatus: string;
  customerId: string | null;
  accessTasks: AccessTaskKey[];
  checklist: Record<string, boolean>;
  assetsLink: string | null;
  dashboard?: DashboardPayload | null;
  dashboardRange: number;
  dashboardBasePath: string;
}) {
  const questionnaireDone = !!questionnaire.monthly_budget;
  const slackDone = !!slackEmail;
  const adDone = adLinkStatus === "approved";
  const assetsDone = !!assetsLink || checklist.assets === true;
  const grantEmails = getGrantEmails();

  const done = [
    questionnaireDone,
    adDone,
    ...accessTasks.map((k) => checklist[k] === true),
    assetsDone,
    slackDone,
  ];
  const doneCount = done.filter(Boolean).length;
  const total = done.length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <>
      <h1 className="text-2xl font-semibold text-zinc-900">
        Welcome aboard, {companyName} 🎉
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        A few things to set up so we can get your campaigns live. Do them in any
        order — your progress is saved, so you can come back to this page anytime.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
          <div
            className="h-2 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-medium text-zinc-600">
          {doneCount}/{total} done
        </span>
      </div>

      <div className="mt-8 space-y-4">
        <TaskCard title="Tell us about your campaigns" done={questionnaireDone}>
          <QuestionnaireFields id={id} defaults={questionnaire} done={questionnaireDone} />
        </TaskCard>

        <TaskCard
          title="Connect your Google Ads account"
          done={adDone}
          statusLabel={adLinkBadge(adLinkStatus)[1]}
        >
          <AdLinkContent id={id} status={adLinkStatus} customerId={customerId} />
        </TaskCard>

        {accessTasks.map((k) => (
          <TaskCard key={k} title={ACCESS_TASKS[k].label} done={checklist[k] === true}>
            <AccessTaskContent
              id={id}
              taskKey={k}
              emails={grantEmails}
              done={checklist[k] === true}
            />
          </TaskCard>
        ))}

        <TaskCard title="Share your creative assets" done={assetsDone}>
          <AssetsContent id={id} link={assetsLink} done={assetsDone} />
        </TaskCard>

        <TaskCard title="Join your Slack channel" done={slackDone}>
          <SlackFields id={id} defaultEmail={slackEmail ?? defaultEmail} done={slackDone} />
        </TaskCard>
      </div>

      {doneCount === total && (
        <p className="mt-8 text-center text-sm text-emerald-600">
          All done — our team takes it from here. Thanks, {companyName}!
        </p>
      )}

      {dashboard !== undefined && (
        <div className="mt-10">
          <AdsDashboard
            payload={dashboard}
            basePath={dashboardBasePath}
            range={dashboardRange}
          />
        </div>
      )}
    </>
  );
}

function AccessTaskContent({
  id,
  taskKey,
  emails,
  done,
}: {
  id: string;
  taskKey: AccessTaskKey;
  emails: string[];
  done: boolean;
}) {
  const task = ACCESS_TASKS[taskKey];
  return (
    <>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600">
        {task.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-4 rounded-md bg-zinc-50 p-3">
        <div className="text-xs font-medium text-zinc-500">Grant access to:</div>
        <ul className="mt-1 space-y-0.5">
          {emails.length ? (
            emails.map((e) => (
              <li key={e} className="font-mono text-sm text-zinc-800">
                {e}
              </li>
            ))
          ) : (
            <li className="text-sm text-zinc-400">
              (ask your PPC Mastery contact for the email)
            </li>
          )}
        </ul>
      </div>
      <form action={toggleChecklistTask.bind(null, id, taskKey)} className="mt-4">
        {done ? (
          <button
            type="submit"
            className="text-sm text-zinc-500 underline hover:text-zinc-800"
          >
            Mark as not done
          </button>
        ) : (
          <SubmitButton>I&rsquo;ve granted access</SubmitButton>
        )}
      </form>
    </>
  );
}

function AssetsContent({
  id,
  link,
  done,
}: {
  id: string;
  link: string | null;
  done: boolean;
}) {
  return (
    <>
      <p className="text-sm text-zinc-500">
        Share a drive folder with your logos, images and videos so our team can
        build your creatives. Paste a Google Drive (or similar) link.
      </p>
      <form action={submitAssetsLink.bind(null, id)} className="mt-4 flex items-start gap-3">
        <input
          name="assets_link"
          type="text"
          inputMode="url"
          defaultValue={link ?? ""}
          placeholder="drive.google.com/…"
          className={`${inputClass} max-w-sm`}
        />
        <SubmitButton>Save link</SubmitButton>
      </form>
      {!done && (
        <form action={toggleChecklistTask.bind(null, id, "assets")} className="mt-3">
          <button
            type="submit"
            className="text-xs text-zinc-400 underline hover:text-zinc-700"
          >
            No assets to share / I&rsquo;ll send them via Slack
          </button>
        </form>
      )}
    </>
  );
}

// Native <details> disclosure card — no client JS, progressive by default.
function TaskCard({
  title,
  done,
  statusLabel,
  children,
}: {
  title: string;
  done: boolean;
  statusLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
        <span className="flex items-center gap-3">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
              done ? "bg-emerald-500 text-white" : "border border-zinc-300 text-zinc-400"
            }`}
          >
            {done ? "✓" : ""}
          </span>
          <span className="font-medium text-zinc-900">{title}</span>
        </span>
        <span className="flex items-center gap-3">
          {statusLabel && !done && (
            <span className="text-xs text-zinc-400">{statusLabel}</span>
          )}
          <span className="text-zinc-400 transition-transform group-open:rotate-90">
            ›
          </span>
        </span>
      </summary>
      <div className="border-t border-zinc-100 px-5 py-5">{children}</div>
    </details>
  );
}

function SlackFields({
  id,
  defaultEmail,
  done,
}: {
  id: string;
  defaultEmail: string;
  done: boolean;
}) {
  return (
    <>
      <p className="text-sm text-zinc-500">
        All communication runs through your dedicated Slack channel — fast,
        async, in writing. Which email should we invite? (Joining is free.)
      </p>
      <form action={submitSlackEmail.bind(null, id)} className="mt-4 space-y-4">
        <Field label="Email for your Slack invite" required>
          <input
            name="slack_email"
            type="email"
            required
            defaultValue={defaultEmail}
            className={inputClass}
          />
        </Field>
        <SubmitButton>{done ? "Update email" : "Set up my channel"}</SubmitButton>
      </form>
    </>
  );
}

function AdLinkContent({
  id,
  status,
  customerId,
}: {
  id: string;
  status: string;
  customerId: string | null;
}) {
  if (status === "not_started") {
    return (
      <>
        <p className="text-sm text-zinc-500">
          Tell us your Google Ads customer ID and we&rsquo;ll send a management
          request for your approval — we never need your password.
        </p>
        <form
          action={submitGoogleAdsCustomerId.bind(null, id)}
          className="mt-4 flex items-start gap-3"
        >
          <input
            name="customer_id"
            required
            inputMode="numeric"
            pattern="[0-9- ]{10,14}"
            maxLength={14}
            placeholder="123-456-7890"
            className="w-44 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none"
          />
          <SubmitButton>Submit</SubmitButton>
        </form>
        <p className="mt-3 text-xs text-zinc-400">
          Where to find it: sign in at ads.google.com — your customer ID is the
          10-digit number in the top-right corner, like 123-456-7890.
        </p>
      </>
    );
  }
  if (status === "requested") {
    return (
      <p className="text-sm text-zinc-500">
        Thanks — we have your ID
        {customerId ? ` (${formatCustomerId(customerId)})` : ""}. Our team is
        reviewing it and will send the linking request shortly.
      </p>
    );
  }
  if (status === "invited") {
    return (
      <>
        <p className="text-sm text-zinc-500">
          One last step — we&rsquo;ve sent the management request to{" "}
          {customerId ? formatCustomerId(customerId) : "your account"}. Approve
          it in Google Ads and you&rsquo;re done.
        </p>
        <a
          href="https://ads.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-md bg-[#0B1F3A] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
        >
          Open Google Ads →
        </a>
        <p className="mt-3 text-xs text-zinc-400">
          You&rsquo;ll find the request under Admin → Access and security →
          Managers.
        </p>
      </>
    );
  }
  if (status === "approved") {
    return (
      <p className="text-sm text-zinc-500">
        Connected ✓ — our team manages{" "}
        {customerId ? formatCustomerId(customerId) : "your account"} from here.
      </p>
    );
  }
  return (
    <p className="text-sm text-zinc-500">
      The linking request was {status === "refused" ? "declined" : "cancelled"}.
      Message us in your Slack channel and we&rsquo;ll sort it out.
    </p>
  );
}

function adLinkBadge(status: string): [string, string] {
  const styles: Record<string, [string, string]> = {
    not_started: ["", "to do"],
    requested: ["", "under review"],
    invited: ["", "awaiting your approval"],
    approved: ["", "connected"],
    refused: ["", "declined"],
    cancelled: ["", "cancelled"],
  };
  return styles[status] ?? styles.not_started;
}

function formatCustomerId(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/* ============================ PRE-PAYMENT WIZARD ========================== */

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
          <input name="company_name" required defaultValue={client.company_name} className={inputClass} />
        </Field>
        <Field label="Your full name (signer)" required>
          <input name="contact_name" required defaultValue={client.contact_name ?? ""} className={inputClass} />
        </Field>
        <Field label="Email" required>
          <input name="contact_email" type="email" required defaultValue={client.contact_email} className={inputClass} />
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
      <QuoteSummary planName={planName} price={price} isCustom={isCustom} platforms={platforms} />
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
      <QuoteSummary planName={planName} price={price} isCustom={isCustom} platforms={platforms} />
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
            <span className="ml-2 text-xs font-normal text-zinc-400">(agreed pricing)</span>
          )}
        </span>
        <span className="shrink-0 text-sm text-zinc-500">{formatMoney(price)}/mo</span>
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

/* ============================ QUESTIONNAIRE FIELDS ======================== */

function QuestionnaireFields({
  id,
  defaults,
  done,
}: {
  id: string;
  defaults: Record<string, unknown>;
  done: boolean;
}) {
  const s = (k: string) => (typeof defaults[k] === "string" ? (defaults[k] as string) : "");
  const channels = Array.isArray(defaults.channels) ? (defaults.channels as string[]) : [];
  return (
    <>
      {done && (
        <p className="mb-4 text-sm text-emerald-600">
          ✓ Submitted — you can update your answers below anytime.
        </p>
      )}
      <form action={submitQuestionnaire.bind(null, id)} className="space-y-5">
        <Field label="What is your monthly budget for your campaigns?" required>
          <input name="monthly_budget" required defaultValue={s("monthly_budget")} className={inputClass} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="CPL / CPA target">
            <input name="cpl_cpa_target" defaultValue={s("cpl_cpa_target")} className={inputClass} />
          </Field>
          <Field label="ROAS target">
            <input name="roas_target" defaultValue={s("roas_target")} className={inputClass} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-zinc-700">
            Which channels do you want to advertise on?
          </legend>
          <div className="flex flex-wrap gap-4">
            {["Google Ads", "Microsoft Ads", "Meta Ads"].map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="channels" value={p} defaultChecked={channels.includes(p)} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="What locations would you like your ads to be targeting?">
          <input name="target_locations" defaultValue={s("target_locations")} className={inputClass} />
        </Field>
        <Field label="What areas of your business would you like to focus your ads on? (e.g. installation, product sale)">
          <textarea name="business_focus" rows={2} defaultValue={s("business_focus")} className={inputClass} />
        </Field>
        <Field label="Are there any particular keywords you want us to use as a priority?">
          <textarea name="priority_keywords" rows={2} defaultValue={s("priority_keywords")} className={inputClass} />
        </Field>
        <Field label="Any keywords or areas of your business you'd like us to avoid targeting?">
          <textarea name="avoid_keywords" rows={2} defaultValue={s("avoid_keywords")} className={inputClass} />
        </Field>
        <Field label="Do you have any unique selling points we can use in your ads? (e.g. free delivery, 5★ reviews)">
          <textarea name="usps" rows={2} defaultValue={s("usps")} className={inputClass} />
        </Field>
        <Field label="Which actions on your website are the most valuable to you? (e.g. phone calls, purchases, form submissions)" required>
          <textarea name="valuable_actions" rows={2} required defaultValue={s("valuable_actions")} className={inputClass} />
        </Field>
        <Field label="Do you want your ads running at particular times of day / days of the week?">
          <input name="ad_schedule" defaultValue={s("ad_schedule")} className={inputClass} />
        </Field>
        <Field label="Is there a certain demographic to focus on? (age, behaviours, interests — be as specific as possible)">
          <textarea name="demographics" rows={2} defaultValue={s("demographics")} className={inputClass} />
        </Field>
        <Field label="Top 5 competitors">
          <textarea name="competitors" rows={2} defaultValue={s("competitors")} className={inputClass} />
        </Field>
        <SubmitButton>{done ? "Save changes" : "Submit"}</SubmitButton>
      </form>
    </>
  );
}

/* ================================ SHARED ================================= */

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

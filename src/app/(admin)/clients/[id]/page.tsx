// Single client record: details, configured quote, the shareable onboarding
// link, onboarding progress, and the append-only activity log.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getTier, tierNameFor } from "@/lib/tiers";
import { formatMoney } from "@/lib/config";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const STEP_ORDER = [
  "details",
  "contract",
  "payment",
  "slack",
  "questionnaire",
  "complete",
] as const;
const STEP_LABELS: Record<string, string> = {
  details: "Details confirmed",
  contract: "Contract",
  payment: "Payment",
  slack: "Slack",
  questionnaire: "Questionnaire",
  complete: "Complete",
};

const QUESTION_LABELS: Record<string, string> = {
  monthly_budget: "Monthly budget",
  cpl_cpa_target: "CPL/CPA target",
  roas_target: "ROAS target",
  channels: "Channels",
  target_locations: "Target locations",
  business_focus: "Business focus",
  priority_keywords: "Priority keywords",
  avoid_keywords: "Avoid keywords/areas",
  usps: "USPs",
  valuable_actions: "Most valuable actions",
  ad_schedule: "Ad schedule",
  demographics: "Demographics",
  competitors: "Top competitors",
  drive_link: "Creatives drive link",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();
  if (!client) notFound();

  const { data: state } = await supabase
    .from("onboarding_state")
    .select("*")
    .eq("client_id", id)
    .single();

  const { data: events } = await supabase
    .from("activity_log")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const tier = getTier(client.service_tier);

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const onboardingUrl = `${proto}://${host}/onboarding/${id}`;

  // "details" is a gate inside the contract step, not its own enum value.
  const currentStep =
    state?.current_step === "contract" && !state?.details_confirmed
      ? "details"
      : (state?.current_step ?? "details");
  const currentIdx = STEP_ORDER.indexOf(currentStep as (typeof STEP_ORDER)[number]);
  const price = client.custom_monthly_price ?? tier?.monthlyPrice ?? null;
  const questionnaire =
    (state?.questionnaire_data as Record<string, unknown> | null) ?? null;
  const hasAnswers =
    questionnaire &&
    Object.values(questionnaire).some((v) =>
      Array.isArray(v) ? v.length > 0 : !!v,
    );

  return (
    <div className="p-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">{client.company_name}</h1>
        <StatusBadge status={client.status} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Details + quote */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Details</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Contact" value={client.contact_name || "—"} />
            <Row label="Email" value={client.contact_email} />
            <Row label="Tier" value={tierNameFor(client.service_tier) ?? "—"} />
            <Row
              label="Platforms"
              value={(client.platforms as string[] | null)?.join(", ") || "—"}
            />
            {price !== null && (
              <>
                <Row
                  label="Monthly"
                  value={`${formatMoney(price)}/mo${client.custom_monthly_price ? " (custom)" : ""}`}
                />
                <Row label="Billing" value="Monthly rolling (31-day notice)" />
              </>
            )}
            {state?.slack_invite_email && (
              <Row label="Slack invite" value={state.slack_invite_email} />
            )}
            {state?.google_ads_customer_id && (
              <Row
                label="Google Ads ID"
                value={`${state.google_ads_customer_id} (${state.ad_link_status})`}
              />
            )}
          </dl>
        </section>

        {/* Onboarding */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Onboarding</h2>

          <ol className="mt-4 space-y-2">
            {STEP_ORDER.map((step, i) => {
              const done = i < currentIdx || currentStep === "complete";
              const active = i === currentIdx && currentStep !== "complete";
              return (
                <li key={step} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                          ? "bg-[#0B1F3A] text-white"
                          : "bg-zinc-200 text-zinc-500"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={active ? "font-medium text-zinc-900" : "text-zinc-600"}>
                    {STEP_LABELS[step]}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-6">
            <div className="mb-1 text-xs font-medium text-zinc-500">Onboarding link</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">
                {onboardingUrl}
              </code>
              <CopyButton value={onboardingUrl} />
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Send this to the prospect. Anyone with the link can complete the wizard.
            </p>
          </div>
        </section>
      </div>

      {/* Questionnaire answers */}
      {hasAnswers && (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">
            Questionnaire answers
          </h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {Object.entries(QUESTION_LABELS).map(([key, label]) => {
              const raw = questionnaire?.[key];
              const value = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
              if (!value) return null;
              return (
                <div key={key}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    {label}
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-zinc-800">
                    {key === "drive_link" ? (
                      <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0B1F3A] underline"
                      >
                        {value}
                      </a>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {/* Activity log */}
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Activity log</h2>
        {!events || events.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No activity yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300" />
                <div>
                  <span className="font-medium text-zinc-800">{e.event_type}</span>
                  <span className="text-zinc-400"> · {e.actor}</span>
                  <div className="text-xs text-zinc-400">
                    {new Date(e.created_at).toLocaleString("en-IE")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium text-zinc-800">{value}</dd>
    </div>
  );
}

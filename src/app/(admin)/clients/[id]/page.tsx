// Single client record: details, configured quote, the shareable onboarding
// link, onboarding progress, and the append-only activity log.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getTier, tierNameFor } from "@/lib/tiers";
import { ACCESS_TASKS, isAccessTaskKey } from "@/lib/access-tasks";
import { formatMoney } from "@/lib/config";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import {
  approveGoogleAdsLink,
  refreshGoogleAdsLinkStatus,
  deleteClient,
} from "../actions";
import {
  getDashboard,
  type DashboardPayload,
  type ReportWindow,
} from "@/lib/integrations/google-ads/reporting";
import { AdsDashboard } from "@/components/AdsDashboard";

export const dynamic = "force-dynamic";

function parseRange(raw: string | undefined): ReportWindow {
  const n = Number(raw);
  return n === 7 || n === 90 ? n : 28;
}

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
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const range = parseRange((await searchParams).range);
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

  const price = client.custom_monthly_price ?? tier?.monthlyPrice ?? null;
  const questionnaire =
    (state?.questionnaire_data as Record<string, unknown> | null) ?? null;
  const hasAnswers =
    questionnaire &&
    Object.values(questionnaire).some((v) =>
      Array.isArray(v) ? v.length > 0 : !!v,
    );

  // Full onboarding journey (pre-payment gates + post-payment checklist), so
  // the team sees exactly where a client is. Mirrors the client home.
  const cl = (state?.checklist as Record<string, boolean> | null) ?? {};
  const accessTasks = ((client.access_tasks as string[] | null) ?? []).filter(
    isAccessTaskKey,
  );
  const journey: { label: string; done: boolean; detail?: string }[] = [
    { label: "Details confirmed", done: !!state?.details_confirmed },
    { label: "Contract signed", done: state?.contract_status === "signed" },
    { label: "Payment", done: state?.payment_status === "paid" },
    { label: "Questionnaire", done: !!questionnaire?.monthly_budget },
    {
      label: "Google Ads link",
      done: state?.ad_link_status === "approved",
      detail:
        state?.ad_link_status && state.ad_link_status !== "not_started"
          ? state.ad_link_status
          : undefined,
    },
    ...accessTasks.map((k) => ({
      label: `${ACCESS_TASKS[k].short} access`,
      done: cl[k] === true,
    })),
    {
      label: "Creative assets",
      done: !!state?.assets_drive_link || cl.assets === true,
    },
    { label: "Slack invite", done: !!state?.slack_invite_email },
  ];
  const journeyDone = journey.filter((j) => j.done).length;
  const journeyPct = Math.round((journeyDone / journey.length) * 100);

  // Performance dashboard once the Google Ads link is active (cached, guarded).
  let dashboard: DashboardPayload | null = null;
  const adApproved =
    state?.ad_link_status === "approved" && state?.google_ads_customer_id;
  const reportingId =
    state?.google_ads_reporting_customer_id ?? state?.google_ads_customer_id;
  if (adApproved && reportingId) {
    try {
      dashboard = await getDashboard(id, reportingId, range);
    } catch (e) {
      console.error("Admin dashboard fetch failed:", e);
    }
  }

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
            {state?.google_ads_reporting_customer_id &&
              state.google_ads_reporting_customer_id !==
                state.google_ads_customer_id && (
                <Row
                  label="Reporting account"
                  value={`${state.google_ads_reporting_customer_id} (under MCC ${state.google_ads_customer_id})`}
                />
              )}
            {state?.assets_drive_link && (
              <Row label="Assets link" value={state.assets_drive_link} />
            )}
          </dl>
        </section>

        {/* Onboarding checklist (reporting-only clients skip the funnel) */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          {client.source === "reporting_only" ? (
            <>
              <h2 className="text-sm font-semibold text-zinc-900">Managed account</h2>
              <p className="mt-2 text-sm text-zinc-500">
                Reporting-only client (no onboarding funnel). Their Google Ads
                account is managed under our MCC; the dashboard is below.
              </p>
            </>
          ) : (
          <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900">Onboarding</h2>
            <span className="text-xs font-medium text-zinc-500">
              {journeyDone}/{journey.length} · {journeyPct}%
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-1.5 rounded-full bg-emerald-500"
              style={{ width: `${journeyPct}%` }}
            />
          </div>

          <ul className="mt-4 space-y-2">
            {journey.map((j) => (
              <li key={j.label} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    j.done ? "bg-emerald-500 text-white" : "bg-zinc-200 text-zinc-400"
                  }`}
                >
                  {j.done ? "✓" : ""}
                </span>
                <span className={j.done ? "text-zinc-600" : "text-zinc-500"}>
                  {j.label}
                </span>
                {j.detail && !j.done && (
                  <span className="text-xs text-zinc-400">· {j.detail}</span>
                )}
              </li>
            ))}
          </ul>

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
          </>
          )}
        </section>
      </div>

      {/* Google Ads linking */}
      {state?.google_ads_customer_id && (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-zinc-900">
              Google Ads linking
            </h2>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {state.ad_link_status}
            </span>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Customer ID" value={state.google_ads_customer_id} />
          </dl>

          {state.ad_link_status === "requested" && (
            <>
              {(() => {
                // Surface the most recent send failure (events are newest-first).
                const lastAttempt = events?.find((e) =>
                  ["ad_link_invite_failed", "ad_link_invited"].includes(e.event_type),
                );
                if (lastAttempt?.event_type !== "ad_link_invite_failed") return null;
                const msg = (lastAttempt.payload as { message?: string })?.message;
                return (
                  <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Last attempt failed: {msg ?? "unknown error"}
                  </p>
                );
              })()}
              <form action={approveGoogleAdsLink.bind(null, id)} className="mt-4">
                <button
                  type="submit"
                  className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
                >
                  Approve &amp; send link invitation
                </button>
              </form>
              <p className="mt-2 text-xs text-zinc-400">
                Sends a management request from our MCC. The client then
                approves it inside Google Ads.
              </p>
            </>
          )}

          {state.ad_link_status === "invited" && (
            <>
              <p className="mt-3 text-sm text-zinc-500">
                Invitation sent — waiting for the client to approve inside
                Google Ads.
              </p>
              <form
                action={refreshGoogleAdsLinkStatus.bind(null, id)}
                className="mt-3"
              >
                <button
                  type="submit"
                  className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  Refresh status
                </button>
              </form>
            </>
          )}

          {state.ad_link_status === "approved" && (
            <p className="mt-3 text-sm text-emerald-600">
              Link active — this account is connected and managed under our MCC.
            </p>
          )}

          {(state.ad_link_status === "refused" ||
            state.ad_link_status === "cancelled") && (
            <p className="mt-3 text-sm text-red-600">
              The link was {state.ad_link_status} on Google&rsquo;s side — follow
              up with the client in Slack.
            </p>
          )}
        </section>
      )}

      {/* Performance dashboard */}
      {adApproved && (
        <div className="mt-6">
          <AdsDashboard payload={dashboard} basePath={`/clients/${id}`} range={range} />
        </div>
      )}

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
                    {value}
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

      {/* Danger zone */}
      <section className="mt-6 rounded-xl border border-red-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Permanently delete this client and all their data (onboarding state,
          activity log, cached reports, weekly reports). This cannot be undone, and
          it does not cancel any Stripe subscription or archive their Slack channel.
        </p>
        <form action={deleteClient.bind(null, id)} className="mt-3">
          <ConfirmSubmitButton
            message={`Delete ${client.company_name}? This permanently removes the client and all their data and cannot be undone.`}
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
          >
            Delete client
          </ConfirmSubmitButton>
        </form>
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

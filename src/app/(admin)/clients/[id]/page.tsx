// Single client record: details, configured quote, the shareable onboarding
// link, onboarding progress, and the append-only activity log.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getTier, tierName } from "@/lib/tiers";
import { formatMoney } from "@/lib/config";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const STEP_ORDER = ["questionnaire", "contract", "payment", "complete"] as const;
const STEP_LABELS: Record<string, string> = {
  questionnaire: "Questionnaire",
  contract: "Contract",
  payment: "Payment",
  complete: "Complete",
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

  const currentStep = state?.current_step ?? "questionnaire";
  const currentIdx = STEP_ORDER.indexOf(currentStep as (typeof STEP_ORDER)[number]);

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
            <Row label="Tier" value={tier ? tierName(tier) : "—"} />
            {tier && (
              <>
                <Row label="Monthly" value={`${formatMoney(tier.monthlyPrice)}/mo`} />
                <Row label="Billing" value="Monthly rolling (31-day notice)" />
              </>
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

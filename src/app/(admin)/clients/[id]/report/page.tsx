// Print-ready client report: brand header + a computed performance summary +
// the full dashboard (KPIs, charts, tables). Designed for Save-as-PDF (the
// sidebar and range buttons are print-hidden). Range comes from ?range=.
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getDashboard, type ReportWindow, type Kpi } from "@/lib/integrations/google-ads/reporting";
import { entityConfig } from "@/lib/config";
import { AdsDashboard } from "@/components/AdsDashboard";
import { SavePdfButton } from "@/components/SavePdfButton";

export const dynamic = "force-dynamic";

function parseRange(raw: string | undefined): ReportWindow {
  if (raw === "month" || raw === "0") return 0;
  const n = Number(raw);
  return n === 28 || n === 90 ? n : 7;
}

export default async function ReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const range = parseRange((await searchParams).range);
  const supabase = createSupabaseAdminClient();

  const { data: client } = await supabase.from("clients").select("company_name").eq("id", id).single();
  if (!client) notFound();
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("google_ads_customer_id, google_ads_reporting_customer_id, ad_link_status")
    .eq("client_id", id)
    .single();

  const reportingId = (state?.google_ads_reporting_customer_id as string | null) ?? (state?.google_ads_customer_id as string | null);
  const approved = state?.ad_link_status === "approved" && reportingId;
  const dash = approved ? await getDashboard(id, reportingId as string, range).catch(() => null) : null;

  const brand = entityConfig.brandName || "PPC Mastery";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const money = (n: number, dp = 0) =>
    dash ? new Intl.NumberFormat("en", { style: "currency", currency: dash.currency, maximumFractionDigits: dp }).format(n) : String(n);
  const dec = (n: number, dp = 1) => new Intl.NumberFormat("en", { maximumFractionDigits: dp }).format(n);
  const delta = (k: Kpi) => (k.deltaPct == null ? "" : ` (${k.deltaPct >= 0 ? "up" : "down"} ${Math.abs(k.deltaPct).toFixed(0)}% vs prior period)`);

  const summary: string[] = [];
  if (dash) {
    const k = dash.kpis;
    summary.push(
      `Over ${dash.range.start} to ${dash.range.end}, the account spent ${money(k.spend.value)}${delta(k.spend)} and recorded ${dec(k.conversions.value)} conversions${delta(k.conversions)}, at a cost per conversion of ${money(k.costPerConv.value, 2)}${delta(k.costPerConv)}.`,
    );
    if (dash.hasConversionValue) {
      summary.push(`Conversion value was ${money(k.convValue.value)} at a ${dec(k.roas.value, 2)}x return on ad spend${delta(k.roas)}.`);
    }
    const top = dash.byCampaign[0];
    if (top) summary.push(`The largest campaign by spend was ${top.name} (${top.channel}): ${money(top.spend)} for ${dec(top.conversions)} conversions.`);
  }

  return (
    <div className="mx-auto max-w-[920px] bg-white p-8 print:p-0">
      <div className="mb-6 flex items-start justify-between gap-4 border-b-2 border-[#3C83F6] pb-4">
        <div>
          <div className="text-2xl font-bold text-[#0B1F3A]">{brand}</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900">Google Ads Performance Report</div>
          <div className="text-sm text-zinc-600">{client.company_name}{dash ? ` · ${dash.range.start} to ${dash.range.end}` : ""}</div>
          <div className="text-xs text-zinc-400">Prepared {today}</div>
        </div>
        <SavePdfButton />
      </div>

      {summary.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Summary</h2>
          <div className="mt-2 space-y-2 text-sm text-zinc-800">
            {summary.map((p, i) => <p key={i}>{p}</p>)}
          </div>
          {dash && dash.weekly.changeLines.length > 0 && (
            <p className="mt-2 text-sm text-zinc-700"><span className="font-medium text-zinc-500">Recent optimisations: </span>{dash.weekly.changeLines.join(", ")}.</p>
          )}
        </section>
      )}

      {dash ? (
        <AdsDashboard payload={dash} basePath={`/clients/${id}/report`} range={range} />
      ) : (
        <p className="text-sm text-zinc-500">No performance data available for this client (the Google Ads link must be approved).</p>
      )}
    </div>
  );
}

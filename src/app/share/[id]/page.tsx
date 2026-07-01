// Public, dashboard-only client link. Outside the (admin) group, so no sidebar
// and no admin gate — access is via the client id in the URL (the same
// share-by-link model as /onboarding/[id]). Read-only: brand header + the
// performance dashboard, nothing else. Send this to a client who only needs the
// numbers.
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { resolveDashboard } from "@/lib/integrations/google-ads/reporting";
import { entityConfig } from "@/lib/config";
import { Wordmark } from "@/components/Wordmark";
import { AdsDashboard } from "@/components/AdsDashboard";

export const dynamic = "force-dynamic";

export default async function SharedDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
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
  let dash = null;
  let rangeKey = "mon_sun";
  if (approved) {
    try {
      const r = await resolveDashboard(id, reportingId as string, sp);
      dash = r.payload;
      rangeKey = r.rangeKey;
    } catch { /* leave dash null */ }
  }
  const brand = entityConfig.brandName || "PPC Mastery";

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="text-lg">
            <Wordmark variant="dark" />
          </div>
          <div className="text-sm font-medium text-zinc-600">{client.company_name}</div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-4 text-xl font-semibold text-zinc-900">Google Ads Performance</h1>
        {dash ? (
          <AdsDashboard payload={dash} basePath={`/share/${id}`} range={rangeKey} />
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
            Performance data isn&rsquo;t available yet. Please check back once the account is connected.
          </div>
        )}
        <p className="mt-6 text-center text-xs text-zinc-400">Powered by {brand}</p>
      </main>
    </div>
  );
}

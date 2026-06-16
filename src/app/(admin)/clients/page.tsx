// Client book — the list of all clients. Built to stay usable at scale (the MCC
// Command Center can hold 100+ accounts): name search + a Google Ads ID column,
// and a source-aware "Type" (service tier for funnel clients, "Reporting" for
// managed accounts).
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { tierNameFor } from "@/lib/tiers";
import { StatusBadge } from "@/components/StatusBadge";
import { entityConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

function fmtId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const supabase = createSupabaseAdminClient();
  let sel = supabase
    .from("clients")
    .select(
      "id, company_name, contact_email, status, service_tier, source, created_at, onboarding_state(google_ads_customer_id, google_ads_reporting_customer_id)",
    )
    .order("created_at", { ascending: false });
  if (query) sel = sel.ilike("company_name", `%${query}%`);
  const { data: clients, error } = await sel;

  return (
    <div className="p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">Clients</h1>
        <div className="flex gap-2">
          <Link
            href="/clients/import"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Import from MCC
          </Link>
          <Link
            href="/clients/reporting"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Add managed account
          </Link>
          {!entityConfig.reportingOnly && (
            <Link
              href="/clients/new"
              className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
            >
              New client
            </Link>
          )}
        </div>
      </div>

      {/* Search (server-side; no JS needed) */}
      <form method="get" className="mt-6 flex items-center gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search company name…"
          className="w-72 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Search
        </button>
        {query && (
          <Link href="/clients" className="text-sm text-zinc-500 hover:text-zinc-800">
            Clear
          </Link>
        )}
        {clients && (
          <span className="ml-auto text-xs text-zinc-400">
            {clients.length} {clients.length === 1 ? "client" : "clients"}
            {query ? ` matching “${query}”` : ""}
          </span>
        )}
      </form>

      {error && (
        <p className="mt-6 text-sm text-red-600">Could not load clients: {error.message}</p>
      )}

      {!error && (!clients || clients.length === 0) && (
        <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-500">
            {query ? (
              <>No clients match “{query}”.</>
            ) : entityConfig.reportingOnly ? (
              <>
                No accounts yet. Click{" "}
                <span className="font-medium">Add managed account</span> to add one
                from the MCC and start reporting.
              </>
            ) : (
              <>
                No clients yet. Click <span className="font-medium">New client</span>{" "}
                to create one and generate an onboarding link.
              </>
            )}
          </p>
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Google Ads ID</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {clients.map((c) => {
                const st = (
                  Array.isArray(c.onboarding_state)
                    ? c.onboarding_state[0]
                    : c.onboarding_state
                ) as
                  | {
                      google_ads_customer_id?: string | null;
                      google_ads_reporting_customer_id?: string | null;
                    }
                  | null
                  | undefined;
                const adId =
                  st?.google_ads_reporting_customer_id ?? st?.google_ads_customer_id;
                const type =
                  c.source === "reporting_only"
                    ? "Reporting"
                    : (tierNameFor(c.service_tier) ?? "—");
                return (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/clients/${c.id}`}
                        className="font-medium text-[#0B1F3A] hover:underline"
                      >
                        {c.company_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-zinc-600">{type}</td>
                    <td className="px-5 py-3 font-mono text-xs text-zinc-500">
                      {fmtId(adId)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

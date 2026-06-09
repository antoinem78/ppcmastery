// Client book — the list of all PPC Mastery clients.
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  prospect: "bg-zinc-100 text-zinc-600",
  onboarding: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-orange-100 text-orange-700",
  churned: "bg-red-100 text-red-700",
};

export default async function ClientsPage() {
  const supabase = createSupabaseAdminClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, company_name, contact_email, status, service_tier, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">Clients</h1>
        <Link
          href="/clients/new"
          className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
        >
          New client
        </Link>
      </div>

      {error && (
        <p className="mt-6 text-sm text-red-600">Could not load clients: {error.message}</p>
      )}

      {!error && (!clients || clients.length === 0) && (
        <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-500">
            No clients yet. Click <span className="font-medium">New client</span> to create
            one and generate an onboarding link.
          </p>
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 font-medium">Tier</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-medium text-[#0B1F3A] hover:underline"
                    >
                      {c.company_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-zinc-600">{c.contact_email}</td>
                  <td className="px-5 py-3 text-zinc-600">
                    {getTier(c.service_tier)?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        statusStyles[c.status] ?? "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

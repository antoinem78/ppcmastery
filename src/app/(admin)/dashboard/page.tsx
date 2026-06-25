// Admin dashboard. For Phase 0 its job is simply to PROVE the Supabase
// connection works end to end: it reads the live count of clients from the
// database. With no clients yet, that's 0 — which still confirms the app can
// reach Supabase with the secret key.

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { entityConfig } from "@/lib/config";

export const dynamic = "force-dynamic"; // always read fresh from the DB

async function getClientCount(): Promise<
  { ok: true; count: number } | { ok: false; message: string }
> {
  try {
    const supabase = createSupabaseAdminClient();
    const { count, error } = await supabase
      .from("clients")
      .select("*", { count: "exact", head: true });
    if (error) return { ok: false, message: error.message };
    return { ok: true, count: count ?? 0 };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export default async function DashboardPage() {
  const result = await getClientCount();

  return (
    <div className="p-10">
      <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500">{entityConfig.brandName} — internal ops</p>

      <div className="mt-8 max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        {result.ok ? (
          <>
            <div className="text-sm font-medium text-zinc-500">Total clients</div>
            <div className="mt-2 text-4xl font-semibold text-zinc-900">
              {result.count}
            </div>
            <div className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Supabase connected
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium text-red-600">
              Could not reach the database
            </div>
            <p className="mt-2 text-xs text-zinc-500">{result.message}</p>
          </>
        )}
      </div>
    </div>
  );
}

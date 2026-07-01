// Bulk import managed accounts from the MCC. Lists every leaf account under
// this deployment's MCC (login-customer-id) with checkboxes; already-imported
// accounts are shown ticked + disabled. Built for the MCC Command Center clone
// (BJ main MCC, ~129 accounts), but works for any deployment.
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { listManagedAccounts, GoogleAdsError } from "@/lib/integrations/google-ads";
import { SelectAllCheckboxes } from "@/components/SelectAllCheckboxes";
import { addReportingClientsBulk } from "../actions";

export const dynamic = "force-dynamic";

export default async function ImportAccountsPage() {
  let leaves: Awaited<ReturnType<typeof listManagedAccounts>> = [];
  let loadError: string | null = null;
  try {
    leaves = await listManagedAccounts();
  } catch (e) {
    loadError =
      e instanceof GoogleAdsError ? e.message : "Couldn't reach the MCC account list.";
  }

  const supabase = createSupabaseAdminClient();
  const { data: existing } = await supabase
    .from("onboarding_state")
    .select("google_ads_customer_id");
  const have = new Set(
    (existing ?? []).map((r) => r.google_ads_customer_id).filter(Boolean) as string[],
  );

  const available = leaves.filter((l) => !have.has(l.id));
  const alreadyIn = leaves.filter((l) => have.has(l.id));

  return (
    <div className="max-w-2xl p-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">Import from MCC</h1>
        <Link href="/clients" className="text-sm text-zinc-500 hover:text-zinc-800">
          Back to clients
        </Link>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Every ad account under your MCC. Tick the ones to manage — each becomes a
        reporting-only client with its dashboard and weekly report. Already-imported
        accounts are ticked and locked.
      </p>

      {loadError && (
        <p className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
      )}

      {!loadError && leaves.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500">No accounts found under this MCC.</p>
      )}

      {leaves.length > 0 && (
        <form action={addReportingClientsBulk} className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <span>
              {available.length} available · {alreadyIn.length} already imported ·{" "}
              {leaves.length} total
            </span>
            {available.length > 0 && <SelectAllCheckboxes />}
          </div>

          <div className="max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200 bg-white">
            {available.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50"
              >
                <input
                  type="checkbox"
                  name="account_ids"
                  value={l.id}
                  defaultChecked
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span className="flex-1 truncate text-zinc-800">
                  {l.name || `Account ${l.id}`}
                </span>
                <span className="text-xs text-zinc-400">{l.currency}</span>
                <span className="font-mono text-xs text-zinc-400">{fmtId(l.id)}</span>
              </label>
            ))}
            {alreadyIn.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm opacity-50"
              >
                <input type="checkbox" checked disabled className="h-4 w-4" />
                <span className="flex-1 truncate text-zinc-600">
                  {l.name || `Account ${l.id}`}
                </span>
                <span className="text-xs text-zinc-400">imported</span>
                <span className="font-mono text-xs text-zinc-400">{fmtId(l.id)}</span>
              </div>
            ))}
          </div>

          {available.length > 0 && (
            <button
              type="submit"
              className="mt-5 rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
            >
              Import selected accounts
            </button>
          )}
        </form>
      )}
    </div>
  );
}

function fmtId(id: string): string {
  return id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

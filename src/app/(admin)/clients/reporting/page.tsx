// Admin form to add a reporting-only client — an existing client whose Google
// Ads account already sits under our MCC (no wizard / contract / payment).
import Link from "next/link";
import { addReportingClient } from "../actions";

export default function AddReportingClientPage() {
  return (
    <div className="max-w-xl p-10">
      <h1 className="text-2xl font-semibold text-zinc-900">Add managed account</h1>
      <p className="mt-1 text-sm text-zinc-500">
        For an existing client whose Google Ads account is already under the PPC
        Mastery MCC. No contract or payment — we just stand up their dashboard
        and weekly reports.
      </p>

      <form action={addReportingClient} className="mt-8 space-y-5">
        <Field label="Company name" required>
          <input name="company_name" required className={inputClass} />
        </Field>
        <Field label="Contact email" required>
          <input name="contact_email" type="email" required className={inputClass} />
        </Field>
        <Field label="Google Ads ID (account or its MCC)" required>
          <input
            name="customer_id"
            required
            inputMode="numeric"
            placeholder="123-456-7890"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-400">
            Enter the account ID, or the MCC it sits under — we&rsquo;ll find the
            ad account inside. It must already be linked under our MCC.
          </p>
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
          >
            Add &amp; verify access
          </button>
          <Link href="/clients" className="text-sm text-zinc-500 hover:text-zinc-800">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

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

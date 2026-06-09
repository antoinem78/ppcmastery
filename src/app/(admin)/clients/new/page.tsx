// Admin form to create a new client + configure their locked-tier quote.
import Link from "next/link";
import { createClient } from "../actions";
import { TIER_LIST, formatEur } from "@/lib/tiers";

export default function NewClientPage() {
  return (
    <div className="max-w-xl p-10">
      <h1 className="text-2xl font-semibold text-zinc-900">New client</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Create the record and configure the quote. You&rsquo;ll get a shareable
        onboarding link on the next screen.
      </p>

      <form action={createClient} className="mt-8 space-y-5">
        <Field label="Company name" required>
          <input
            name="company_name"
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none"
          />
        </Field>

        <Field label="Contact name">
          <input
            name="contact_name"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none"
          />
        </Field>

        <Field label="Contact email" required>
          <input
            name="contact_email"
            type="email"
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none"
          />
        </Field>

        <Field label="Service tier" required>
          <select
            name="service_tier"
            required
            defaultValue=""
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none"
          >
            <option value="" disabled>
              Select a tier…
            </option>
            {TIER_LIST.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name} — {formatEur(t.monthlyPriceEur)}/mo
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
          >
            Create client
          </button>
          <Link href="/clients" className="text-sm text-zinc-500 hover:text-zinc-800">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

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

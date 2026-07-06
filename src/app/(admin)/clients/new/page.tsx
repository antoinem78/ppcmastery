// Admin form to create a new client + set their bespoke monthly quote.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "../actions";
import { PLATFORM_OPTIONS } from "@/lib/tiers";
import { ACCESS_TASK_LIST } from "@/lib/access-tasks";
import { entityConfig } from "@/lib/config";

export default function NewClientPage() {
  // Reviewer/demo deployments: no client creation at all.
  if (entityConfig.reviewMode) notFound();
  // Reporting-only deployments have no onboarding funnel — there is no "new
  // client" flow; managed accounts are added instead.
  if (entityConfig.reportingOnly) redirect("/clients/reporting");
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

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-zinc-700">
            Advertising platforms <span className="text-red-500">*</span>
          </legend>
          <div className="flex flex-wrap gap-4">
            {PLATFORM_OPTIONS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  name="platforms"
                  value={p}
                  defaultChecked={p !== "Meta Ads"}
                />
                {p}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Shown on the quote and contract (e.g. &ldquo;Managed Google Ads &amp;
            Microsoft Ads&rdquo;).
          </p>
        </fieldset>

        <Field label="Monthly price" required>
          <input
            name="custom_monthly_price"
            type="number"
            min="1"
            step="1"
            required
            placeholder="e.g. 1500"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[#0B1F3A] focus:outline-none"
          />
          <p className="mt-1 text-xs text-zinc-400">
            The negotiated monthly subscription (in {entityConfig.currency}). Quote,
            contract, and billing all use this amount.
          </p>
        </Field>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-zinc-700">
            Access grants needed (client checklist)
          </legend>
          <div className="flex flex-wrap gap-4">
            {ACCESS_TASK_LIST.map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="access_tasks" value={t.key} defaultChecked />
                {t.short}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Which access tasks appear on this client&rsquo;s onboarding checklist.
          </p>
        </fieldset>

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

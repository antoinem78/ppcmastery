// Client lifecycle badge — one source of truth for status colors so the list
// and detail pages always match.
const STATUS_STYLES: Record<string, string> = {
  prospect: "bg-zinc-100 text-zinc-600",
  onboarding: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  past_due: "bg-rose-100 text-rose-700",
  paused: "bg-orange-100 text-orange-700",
  churned: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  past_due: "past due",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? "bg-zinc-100 text-zinc-600"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

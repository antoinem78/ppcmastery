// Pulse-skeleton primitives for route loading states. Server pages here block
// on live Google Ads pulls (seconds, not ms) — without a loading.tsx the whole
// navigation freezes with zero feedback, which reads as "the app hung".
export function Bone({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-200/70 ${className}`} />;
}

export function KpiCardBones({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 bg-white p-5">
          <Bone className="h-3 w-16" />
          <Bone className="mt-3 h-7 w-24" />
          <Bone className="mt-2 h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export function TableBones({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-3">
        <Bone className="h-3 w-40" />
      </div>
      <div className="divide-y divide-zinc-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-6 px-5 py-3.5">
            <Bone className="h-4 w-44" />
            <Bone className="h-4 w-20" />
            <Bone className="h-4 w-24" />
            <Bone className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full dashboard-shaped skeleton (KPIs + chart + tables) with a status line. */
export function DashboardBones({ note }: { note?: string }) {
  return (
    <div className="space-y-6">
      {note && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
          {note}
        </div>
      )}
      <div className="rounded-2xl bg-[#0B1F3A] p-6">
        <Bone className="h-4 w-48 bg-white/20" />
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Bone className="h-3 w-16 bg-white/20" />
              <Bone className="mt-2 h-6 w-20 bg-white/20" />
            </div>
          ))}
        </div>
      </div>
      <KpiCardBones count={8} />
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <Bone className="h-3 w-32" />
        <Bone className="mt-4 h-40 w-full" />
      </div>
      <TableBones rows={6} />
    </div>
  );
}

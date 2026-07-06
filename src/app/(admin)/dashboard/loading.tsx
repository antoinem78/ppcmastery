// Command Center loading state — the roll-up fans out live account summaries,
// so this is one of the slowest pages in the app.
import { Bone, KpiCardBones, TableBones } from "@/components/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="p-10">
      <Bone className="h-8 w-64" />
      <Bone className="mt-2 h-4 w-80" />
      <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
        Pulling live account summaries…
      </div>
      <div className="mt-6 space-y-6">
        <KpiCardBones count={2} />
        <TableBones rows={5} />
      </div>
    </div>
  );
}

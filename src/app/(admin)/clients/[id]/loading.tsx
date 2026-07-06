// Client-page loading state — this page pulls the full live dashboard (a dozen
// GAQL queries) before it can render.
import { Bone, DashboardBones } from "@/components/Skeleton";

export default function ClientLoading() {
  return (
    <div className="p-10">
      <Bone className="h-8 w-72" />
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <Bone className="h-4 w-24" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-4 w-full" />)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <Bone className="h-4 w-28" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-4 w-full" />)}
          </div>
        </div>
      </div>
      <div className="mt-8">
        <DashboardBones note="Loading live Google Ads data…" />
      </div>
    </div>
  );
}

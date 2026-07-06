// Public share-link loading state — a client may open this on a slow phone;
// the live pull takes seconds, so show a branded skeleton, not a blank page.
import { Bone, DashboardBones } from "@/components/Skeleton";

export default function ShareLoading() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Bone className="h-6 w-36" />
          <Bone className="h-4 w-28" />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Bone className="h-6 w-64" />
        <div className="mt-6">
          <DashboardBones note="Loading performance data…" />
        </div>
      </main>
    </div>
  );
}

// Client onboarding/home loading state (dashboard pulls for paid/reporting
// clients make this page slow on first hit).
import { Bone } from "@/components/Skeleton";

export default function OnboardingLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
          Loading your workspace…
        </div>
        <div className="mt-6 space-y-4">
          <Bone className="h-8 w-72" />
          <Bone className="h-4 w-96" />
          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8">
            <div className="space-y-4">
              {Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-4 w-full" />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

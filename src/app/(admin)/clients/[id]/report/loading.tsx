// Print-report loading state (live dashboard pull + summary assembly).
import { Bone, DashboardBones } from "@/components/Skeleton";

export default function ReportLoading() {
  return (
    <div className="mx-auto max-w-[920px] bg-white p-8">
      <Bone className="h-8 w-64" />
      <Bone className="mt-3 h-4 w-96" />
      <div className="mt-8">
        <DashboardBones note="Building the report…" />
      </div>
    </div>
  );
}

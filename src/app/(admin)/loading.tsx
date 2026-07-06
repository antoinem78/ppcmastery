// Route-group loading state: shows instantly on any admin navigation while the
// server page (often a live Google Ads pull) renders. Without this the click
// appears to do nothing for seconds.
import { Bone, TableBones } from "@/components/Skeleton";

export default function AdminLoading() {
  return (
    <div className="p-10">
      <Bone className="h-8 w-56" />
      <div className="mt-8 space-y-6">
        <TableBones rows={6} />
      </div>
    </div>
  );
}

// Bernard's page: the Meta strategist's own surface, separate from the Oscar
// panel because Meta work is a different conversation with a different memory
// and its own deliverable (the Meta audit .docx). Admin-gated by the (admin)
// layout; hidden entirely on the reviewer deployment, which is a Google Ads
// window and must not advertise a channel it does not demonstrate.
import { notFound } from "next/navigation";
import { entityConfig } from "@/lib/config";
import { BernardChat } from "@/components/BernardChat";

export const dynamic = "force-dynamic";

export default function BernardPage() {
  if (entityConfig.reviewMode) notFound();

  const configured = Boolean(process.env.META_ADS_TOKEN ?? process.env.META_ACCESS_TOKEN);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900">Meta</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Bernard reads any Meta ad account assigned to the system user: performance, live ad copy, audiences,
        ad set configuration and pixel volume. He is read-only on Meta by design, so every change stays a human action.
      </p>

      {!configured && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Meta access is not configured on this deployment.</strong>{" "}
          Add META_ADS_TOKEN to the environment and redeploy. Until then Bernard will say what he cannot see rather
          than guessing, which is the intended behaviour, but no account data is available.
        </div>
      )}

      <div className="mt-5">
        <BernardChat />
      </div>
    </div>
  );
}

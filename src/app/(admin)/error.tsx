"use client";
// Admin-area error boundary — renders inside the sidebar shell (the layout
// persists), so an operator keeps navigation when one page fails.
import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <div className="p-10">
      <div className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-lg font-semibold text-zinc-900">This page could not load</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Usually a slow or briefly unavailable data source (Google Ads or the database). Your other
          pages still work.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
          >
            Try again
          </button>
          {error.digest && <span className="text-[11px] text-zinc-400">Reference: {error.digest}</span>}
        </div>
      </div>
    </div>
  );
}

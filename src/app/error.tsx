"use client";
// Global error boundary — a Google/Supabase hiccup must never show a raw stack
// screen (clients see /share and /onboarding). Branded, no internals leaked,
// one-click retry. The digest is shown so an operator can find the server log.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg font-semibold text-[#0B1F3A]">
          PPC <span className="font-normal">mastery</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-500">
          The page hit a temporary problem (often a slow data source). Trying again usually fixes it.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-md bg-[#0B1F3A] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
        >
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 text-[11px] text-zinc-400">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  );
}

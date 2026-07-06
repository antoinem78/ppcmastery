// Branded 404 (typed URLs, stale links, review-mode-hidden routes).
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg">
          <Wordmark variant="dark" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">Page not found</h1>
        <p className="mt-2 text-sm text-zinc-500">
          This page does not exist or is not available on this workspace.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-[#0B1F3A] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

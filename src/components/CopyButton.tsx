"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard may be unavailable (e.g. non-HTTPS) — ignore.
        }
      }}
      className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

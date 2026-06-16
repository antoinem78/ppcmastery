"use client";

import { useState } from "react";

// Type-to-confirm delete: the button stays disabled until the admin types
// DELETE, so a client can't be removed by a stray click. `action` is the
// server action (bound to the client id) passed in from the server component.
export function DeleteClientForm({
  action,
  companyName,
}: {
  action: () => Promise<void>;
  companyName: string;
}) {
  const [text, setText] = useState("");
  const armed = text === "DELETE";

  return (
    <form action={action} className="mt-3">
      <label className="block text-xs text-zinc-500">
        Type <span className="font-mono font-semibold text-red-700">DELETE</span> to
        permanently remove <span className="font-medium">{companyName}</span>.
      </label>
      <div className="mt-2 flex items-center gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          className="w-40 rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-red-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!armed}
          className={
            armed
              ? "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
              : "cursor-not-allowed rounded-md border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-300"
          }
        >
          Delete client
        </button>
      </div>
    </form>
  );
}

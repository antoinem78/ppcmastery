// Server-side Supabase client.
//
// This uses the SECRET key, which has full database access and bypasses RLS.
// It must ONLY ever run on the server (Server Components, Route Handlers, Server
// Actions) — never in the browser. Next.js guarantees this: SUPABASE_SECRET_KEY
// is NOT prefixed with NEXT_PUBLIC_, so it is never bundled into client code.
//
// This is the single seam through which the whole app talks to the database.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local (then restart the dev server).",
    );
  }

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

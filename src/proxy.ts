// Next.js 16 renamed "middleware" to "proxy" — same job: run code at the network
// boundary on every matched request. The Auth0 SDK uses this to (a) mount its
// /auth/* routes (login, logout, callback) and (b) keep the session cookie fresh.
//
// This file does NOT do authorization — that happens close to the data, in
// src/app/(admin)/layout.tsx. (Per Next.js guidance, proxy is for lightweight
// request handling, not as the security gate.)
import { auth0 } from "@/lib/auth/auth0";

export async function proxy(request: Request) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets and metadata files — AND except
    // machine endpoints that self-authenticate: api/webhooks (Stripe/PandaDoc
    // HMAC signatures) and api/cron (CRON_SECRET). Auth0 must never touch these:
    // it buffers/alters the raw body (breaking signature verification) or
    // redirects the session-less POST into the login flow. See HANDOVER A10.
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/webhooks|api/cron).*)",
  ],
};

// POST /api/builder/analyze-site — fetch + analyse a business website to ground
// keyword, ad, and sitelink generation. Admin-gated.
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { analyzeSite } from "@/lib/integrations/anthropic/site-analysis";
import { entityConfig } from "@/lib/config";
import type { AnalyzeSiteRequest } from "@/lib/builder/contract";

export async function POST(req: Request) {
  // No Builder on reviewer/demo deployments — block its endpoints too.
  if (entityConfig.reviewMode) {
    return NextResponse.json({ error: "The Builder is disabled on the review workspace." }, { status: 403 });
  }
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) {
    return NextResponse.json({ error: "Agency admin role required." }, { status: 403 });
  }

  let body: AnalyzeSiteRequest;
  try {
    body = (await req.json()) as AnalyzeSiteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.url?.trim()) return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });

  const model = body.model === "sonnet" ? "sonnet" : "opus";
  try {
    const analysis = await analyzeSite(model, body.url);
    return NextResponse.json({ analysis });
  } catch (e) {
    if (e instanceof TypeError) return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
    const message = e instanceof Error ? e.message : "Analysis failed.";
    console.error("Site analysis failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

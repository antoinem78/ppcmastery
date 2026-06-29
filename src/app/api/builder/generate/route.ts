// POST /api/builder/generate — AI copy for the AdForge builder.
//
// Gated to agency_admin (the builder is an internal MaaS tool). Dispatches by
// `kind` to the Anthropic generators, which enforce every Google Ads limit
// server-side before returning. Errors come back as JSON so the client can fall
// back to the deterministic copy already on screen.
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import {
  generateAds,
  generateCallouts,
  generateSitelinks,
} from "@/lib/integrations/anthropic/adforge-copy";
import type { GenerateRequest } from "@/lib/builder/contract";

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) {
    return NextResponse.json({ error: "Agency admin role required." }, { status: 403 });
  }

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const model = body.model === "sonnet" ? "sonnet" : "opus";

  try {
    switch (body.kind) {
      case "ads": {
        if (!body.adGroup?.name) return NextResponse.json({ error: "Missing ad group." }, { status: 400 });
        return NextResponse.json(await generateAds(model, body.context, body.adGroup));
      }
      case "sitelinks":
        return NextResponse.json(await generateSitelinks(model, body.context));
      case "callouts":
        return NextResponse.json(await generateCallouts(model, body.context));
      default:
        return NextResponse.json({ error: "Unknown generation kind." }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed.";
    console.error("AdForge AI generation failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

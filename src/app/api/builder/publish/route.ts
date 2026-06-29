// POST /api/builder/publish — push an AdForge campaign to Google Ads.
//
// Admin-gated. Accepts the campaign the admin built client-side plus the target
// customer ID and daily budget. `validateOnly` checks the request against
// Google without writing — the UI runs that first, then the real publish. The
// campaign is always created PAUSED (see publish.ts).
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { GoogleAdsError } from "@/lib/integrations/google-ads";
import { publishCampaign, PublishValidationError } from "@/lib/integrations/google-ads/publish";
import type { Campaign } from "@/lib/adforge";

interface PublishBody {
  customerId?: string;
  dailyBudget?: number;
  validateOnly?: boolean;
  campaign?: Campaign;
}

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) {
    return NextResponse.json({ error: "Agency admin role required." }, { status: 403 });
  }

  let body: PublishBody;
  try {
    body = (await req.json()) as PublishBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.customerId) return NextResponse.json({ error: "Target Google Ads customer ID is required." }, { status: 400 });
  if (!body.campaign) return NextResponse.json({ error: "No campaign to publish." }, { status: 400 });

  const dailyBudget = typeof body.dailyBudget === "number" && body.dailyBudget > 0 ? body.dailyBudget : 10;

  try {
    const result = await publishCampaign(body.customerId, body.campaign, dailyBudget, body.validateOnly === true);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PublishValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof GoogleAdsError) {
      return NextResponse.json({ error: e.message, isInvalidCustomer: e.isInvalidCustomer }, { status: 502 });
    }
    const message = e instanceof Error ? e.message : "Publish failed.";
    console.error("AdForge publish failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

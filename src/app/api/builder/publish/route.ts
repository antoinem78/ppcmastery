// POST /api/builder/publish — push an AdForge campaign to Google Ads.
//
// Admin-gated. Accepts the campaign the admin built client-side plus the target
// customer ID and daily budget. `validateOnly` checks the request against
// Google without writing — the UI runs that first, then the real publish. The
// campaign is always created PAUSED (see publish.ts).
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { entityConfig } from "@/lib/config";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { GoogleAdsError } from "@/lib/integrations/google-ads";
import { assertMccBoundary, accountAllowed, allowAllMccAccounts } from "@/lib/integrations/google-ads/write";
import { recordWriteAudit } from "@/lib/write-audit";
import { publishCampaign, PublishValidationError } from "@/lib/integrations/google-ads/publish";
import type { Campaign } from "@/lib/adforge";

const DEPLOYMENT = process.env.APP_BASE_URL ?? "unknown";

interface PublishBody {
  customerId?: string;
  dailyBudget?: number;
  validateOnly?: boolean;
  campaign?: Campaign;
}

export async function POST(req: Request) {
  // Reviewer/demo deployments have no Builder (route 404s); block its write
  // endpoint too — defense in depth against a direct POST.
  if (entityConfig.reviewMode) {
    return NextResponse.json({ error: "Publishing is disabled on the review workspace." }, { status: 403 });
  }
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
  const validateOnly = body.validateOnly === true;
  const approver = (session.user as { email?: string })?.email ?? "admin";

  // Publish is a write — identical enforcement path as P5-Lite. (1) Hard MCC
  // boundary on BOTH validate and real. (2) Account allowlist on real writes
  // only (validate a real account before allowlisting it). The admin session is
  // the human approver. Every outcome is audit-logged.
  const boundary = await assertMccBoundary(body.customerId);
  if (!boundary.ok) {
    await recordWriteAudit({
      deployment: DEPLOYMENT, mcc: boundary.mcc, customerId: boundary.customerId,
      source: "publish", action: "publish_campaign", phase: "publish",
      mccCheck: "violation", approver, result: "boundary_violation",
      detail: { validateOnly, reason: boundary.reason, campaign: body.campaign.name },
    });
    return NextResponse.json({ error: boundary.reason }, { status: 403 });
  }

  const allowlistOk = accountAllowed(body.customerId);
  if (!validateOnly && !allowlistOk) {
    await recordWriteAudit({
      deployment: DEPLOYMENT, mcc: boundary.mcc, customerId: boundary.customerId,
      source: "publish", action: "publish_campaign", phase: "publish",
      mccCheck: "passed", allowlistCheck: "not_listed", approver, result: "blocked",
      detail: { validateOnly, campaign: body.campaign.name },
    });
    return NextResponse.json({ error: "This account is not on the write allowlist (GOOGLE_ADS_WRITE_CUSTOMERS)." }, { status: 403 });
  }

  const allowlistCheck = validateOnly ? "skipped" : allowAllMccAccounts() ? "allow_all" : "allowed";

  try {
    const result = await publishCampaign(body.customerId, body.campaign, dailyBudget, validateOnly);
    await recordWriteAudit({
      deployment: DEPLOYMENT, mcc: boundary.mcc, customerId: boundary.customerId,
      source: "publish", action: "publish_campaign", phase: "publish",
      mccCheck: "passed", allowlistCheck, approver, result: "ok",
      detail: { validateOnly, campaign: body.campaign.name, operationCount: result.operationCount, campaignResourceName: result.campaignResourceName },
    });
    return NextResponse.json(result);
  } catch (e) {
    await recordWriteAudit({
      deployment: DEPLOYMENT, mcc: boundary.mcc, customerId: boundary.customerId,
      source: "publish", action: "publish_campaign", phase: "publish",
      mccCheck: "passed", allowlistCheck, approver, result: "failed",
      detail: { validateOnly, campaign: body.campaign.name, error: e instanceof Error ? e.message : "unknown" },
    });
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

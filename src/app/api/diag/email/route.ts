// POST /api/diag/email — sends ONE real test message to CONTRACT_COPY_TO and
// reports the provider's verdict. Presence of RESEND_API_KEY proves nothing
// (we have seen it present and empty, and present with an unverified domain):
// test the function, not the configuration. Sends only to our own copy
// address, so it can never spam a client.
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { entityConfig } from "@/lib/config";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!process.env.RESEND_API_KEY?.trim() || !process.env.EMAIL_FROM?.trim()) {
    return NextResponse.json({
      ok: false,
      reason: "RESEND_API_KEY and/or EMAIL_FROM not set — email layer is a no-op.",
    });
  }
  if (!entityConfig.contractCopyTo) {
    return NextResponse.json({
      ok: false,
      reason: "CONTRACT_COPY_TO not set — nowhere safe to send the test.",
    });
  }

  const sent = await sendEmail({
    to: entityConfig.contractCopyTo,
    subject: `Email delivery test, ${entityConfig.brandName}`,
    text: [
      "This is the /api/diag/email delivery test.",
      "",
      `From: ${process.env.EMAIL_FROM}`,
      `Deployment: ${process.env.APP_BASE_URL ?? "(APP_BASE_URL unset)"}`,
      "",
      "If you are reading this, the sending domain and API key both work.",
    ].join("\n"),
  });

  return NextResponse.json(
    sent
      ? { ok: true, to: entityConfig.contractCopyTo }
      : { ok: false, reason: "Resend rejected the send — check the function logs for the provider response." },
  );
}

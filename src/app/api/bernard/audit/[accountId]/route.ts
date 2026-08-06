// GET /api/bernard/audit/[accountId]?days=30 — generate and download the Meta
// Ads audit .docx for one ad account. Admin-gated. Read-only throughout: the
// account data is pulled live from the Graph API when the link is opened, so the
// document is never stale.
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { generateMetaAudit } from "@/lib/audit/meta-generate";

export const maxDuration = 300;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) {
    return NextResponse.json({ error: "Agency admin role required." }, { status: 403 });
  }

  const { accountId } = await params;
  if (!/^(act_)?\d{6,}$/.test(accountId.trim())) {
    return NextResponse.json({ error: "Not a valid ad account id." }, { status: 400 });
  }
  const daysRaw = Number(new URL(req.url).searchParams.get("days"));
  const days = Math.min(90, Math.max(7, Math.round(Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 30)));

  try {
    const { buffer, accountName } = await generateMetaAudit(accountId, days);
    const safe = accountName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": `attachment; filename="${safe}-meta-ads-audit.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Meta audit generation failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Audit generation failed." }, { status: 500 });
  }
}

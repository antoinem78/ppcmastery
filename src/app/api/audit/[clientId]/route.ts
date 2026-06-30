// GET /api/audit/[clientId] — generate and download the Google Ads audit .docx
// for a client. Admin-gated. Resolves the client's reporting (leaf) account,
// pulls a read-only 12-month findings artifact, and streams the branded document.
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { generateAudit } from "@/lib/audit/generate";

export const maxDuration = 300;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) {
    return NextResponse.json({ error: "Agency admin role required." }, { status: 403 });
  }

  const { clientId } = await params;
  const supabase = createSupabaseAdminClient();
  const { data: row } = await supabase
    .from("onboarding_state")
    .select("google_ads_customer_id, google_ads_reporting_customer_id, ad_link_status, clients(company_name)")
    .eq("client_id", clientId)
    .single();

  if (!row || !row.google_ads_customer_id) {
    return NextResponse.json({ error: "This client has no linked Google Ads account." }, { status: 400 });
  }
  if (row.ad_link_status !== "approved") {
    return NextResponse.json({ error: "The Google Ads link is not approved yet." }, { status: 400 });
  }

  const reportingId = (row.google_ads_reporting_customer_id as string | null) ?? (row.google_ads_customer_id as string);
  const company = (row.clients as unknown as { company_name?: string } | null)?.company_name ?? "Account";

  try {
    const { buffer, filename } = await generateAudit(reportingId, company);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Audit generation failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Audit generation failed." }, { status: 500 });
  }
}

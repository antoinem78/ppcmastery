// GET /api/agent/accounts — the approved-account roster for the chat's account
// selector. Admin-gated.
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { listApprovedAccounts } from "@/lib/command-center";

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAgencyAdmin(session.user as Record<string, unknown>)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const roster = await listApprovedAccounts();
  return NextResponse.json({ accounts: roster.map((r) => ({ clientId: r.clientId, company: r.company })) });
}

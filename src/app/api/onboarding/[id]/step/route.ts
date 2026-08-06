// Current onboarding step for a client, polled by the wizard so the page
// advances itself when a server-side event (contract signed via webhook)
// moves the state. Capability model matches the onboarding page itself: the
// client id is an unguessable uuid and the response carries nothing but the
// step name.
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("onboarding_state")
    .select("current_step")
    .eq("client_id", id)
    .single();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { step: data.current_step },
    { headers: { "Cache-Control": "no-store" } },
  );
}

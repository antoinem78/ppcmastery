// Daily cron (vercel.json): auto-refresh all pending Google Ads link
// invitations and nag the team when a client hasn't accepted after 3 days.
// Protected by CRON_SECRET — Vercel sends it as a Bearer token automatically.
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import {
  getLinkStatus,
  portalStatusFor,
} from "@/lib/integrations/google-ads";

export const maxDuration = 60;

const NAG_AFTER_DAYS = 3;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: pending } = await supabase
    .from("onboarding_state")
    .select("client_id, google_ads_customer_id, clients(company_name)")
    .eq("ad_link_status", "invited")
    .not("google_ads_customer_id", "is", null);

  let transitions = 0;
  let nags = 0;

  for (const row of pending ?? []) {
    const clientId = row.client_id as string;
    const customerId = row.google_ads_customer_id as string;
    const companyName =
      (row.clients as unknown as { company_name?: string } | null)?.company_name ?? "";

    try {
      const googleStatus = await getLinkStatus(customerId);
      const next = portalStatusFor(googleStatus);

      if (next) {
        await supabase
          .from("onboarding_state")
          .update({ ad_link_status: next })
          .eq("client_id", clientId);
        await logActivity({
          clientId,
          eventType: `ad_link_${next}`,
          actor: "system:cron",
          payload: { customer_id: customerId, google_status: googleStatus },
        });
        transitions++;

        if (next === "approved" && process.env.SLACK_BOT_TOKEN && companyName) {
          try {
            const { postMessage, channelNameFor } = await import(
              "@/lib/integrations/slack"
            );
            await postMessage(
              `#${channelNameFor(companyName)}`,
              `✅ Google Ads account ${customerId} is now connected — campaign work can begin.`,
            );
          } catch {
            /* channel may not exist — non-fatal */
          }
        }
        continue;
      }

      // Still pending — nag if the invitation is older than NAG_AFTER_DAYS and
      // we haven't nagged within the same window.
      const cutoff = new Date(
        Date.now() - NAG_AFTER_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: invitedEvents } = await supabase
        .from("activity_log")
        .select("created_at")
        .eq("client_id", clientId)
        .eq("event_type", "ad_link_invited")
        .order("created_at", { ascending: false })
        .limit(1);
      const invitedAt = invitedEvents?.[0]?.created_at;
      if (!invitedAt || invitedAt > cutoff) continue; // too fresh

      const { data: recentNags } = await supabase
        .from("activity_log")
        .select("created_at")
        .eq("client_id", clientId)
        .eq("event_type", "ad_link_nag_sent")
        .gt("created_at", cutoff)
        .limit(1);
      if (recentNags?.length) continue; // already nagged this window

      if (process.env.SLACK_BOT_TOKEN && companyName) {
        try {
          const { postMessage, channelNameFor } = await import(
            "@/lib/integrations/slack"
          );
          const target =
            process.env.SLACK_OPS_CHANNEL || `#${channelNameFor(companyName)}`;
          await postMessage(
            target,
            `⏳ Reminder: the Google Ads management request for ${companyName} (account ${customerId}) has been waiting ${NAG_AFTER_DAYS}+ days — team, please follow up. Approve in Google Ads: Admin → Access and security → Managers.`,
          );
        } catch {
          /* non-fatal */
        }
      }
      await logActivity({
        clientId,
        eventType: "ad_link_nag_sent",
        actor: "system:cron",
        payload: { customer_id: customerId, days_waiting: NAG_AFTER_DAYS },
      });
      nags++;
    } catch (e) {
      console.error(`Cron link check failed for client ${clientId}:`, e);
    }
  }

  return NextResponse.json({
    checked: pending?.length ?? 0,
    transitions,
    nags,
  });
}

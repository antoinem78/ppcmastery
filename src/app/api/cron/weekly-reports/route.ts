// Weekly cron (vercel.json, Mondays): for every client with an active Google
// Ads link, generate the weekly report and post a review draft to Slack.
// CRON_SECRET-protected. Figures come from the data layer; the prose is an LLM
// narrative (falls back to a bulleted template when no Anthropic key).
//
// Scale: clients run with bounded concurrency (each is a dashboard pull + an
// LLM call, ~25s), so a Command-Center-sized book (up to ~40) completes inside
// the 300s function window instead of timing out part-way.
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import {
  getDashboard,
  getWeeklyOptimisations,
  formatWeeklyText,
} from "@/lib/integrations/google-ads/reporting";
import { generateNarrative } from "@/lib/integrations/anthropic/narrative";

export const maxDuration = 300;

// How many clients to process at once. High enough to clear ~40 clients in the
// window, low enough to stay friendly to the Google/Anthropic/Slack limits.
const CONCURRENCY = 5;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: rows } = await supabase
    .from("onboarding_state")
    .select(
      "client_id, google_ads_customer_id, google_ads_reporting_customer_id, clients(company_name)",
    )
    .eq("ad_link_status", "approved")
    .not("google_ads_customer_id", "is", null);

  const clients = rows ?? [];
  const base = process.env.APP_BASE_URL ?? "https://ppcmastery.vercel.app";
  const reviewChannel = process.env.SLACK_REVIEW_CHANNEL;
  const slackOn = !!process.env.SLACK_BOT_TOKEN && !!reviewChannel;

  let sent = 0;
  let failed = 0;

  async function processClient(row: (typeof clients)[number]): Promise<void> {
    const clientId = row.client_id as string;
    const customerId = row.google_ads_customer_id as string;
    // Report on the leaf account (the linked id may be a manager/MCC).
    const reportingId =
      (row.google_ads_reporting_customer_id as string | null) ?? customerId;
    const companyName =
      (row.clients as unknown as { company_name?: string } | null)?.company_name ?? "";

    try {
      // One dashboard pull (cached) gives us the verified weekly numbers + the
      // material for the narrative — no separate weekly recompute.
      const dash = await getDashboard(clientId, reportingId, 7);
      const optimisations = await getWeeklyOptimisations(
        reportingId,
        dash.weekly.start,
        dash.weekly.end,
      );

      let narrative: string | null = null;
      try {
        narrative = await generateNarrative(dash, companyName, optimisations);
      } catch (e) {
        console.error(`Narrative skipped for ${clientId}:`, e);
      }
      const body = narrative ?? formatWeeklyText(dash.weekly, dash.currency);

      if (slackOn) {
        try {
          const { postMessage } = await import("@/lib/integrations/slack");
          const draft = [
            `📊 *Weekly report draft — ${companyName}* (${dash.weekly.start} → ${dash.weekly.end})`,
            "",
            body,
            "",
            `👉 Client dashboard: ${base}/onboarding/${clientId}`,
            "_Draft for review — not yet sent to the client._",
          ].join("\n");
          await postMessage(reviewChannel!, draft);
        } catch (e) {
          console.error(`Weekly draft post failed for ${clientId}:`, e);
        }
      }

      try {
        await supabase.from("weekly_reports").insert({
          client_id: clientId,
          period_start: dash.weekly.start,
          period_end: dash.weekly.end,
          payload: { ...dash.weekly, narrative },
        });
      } catch {
        /* table may not exist yet */
      }

      await logActivity({
        clientId,
        eventType: "weekly_report_sent",
        actor: "system:cron",
        payload: { period_end: dash.weekly.end },
      });
      sent++;
    } catch (e) {
      console.error(`Weekly report failed for client ${clientId}:`, e);
      failed++;
    }
  }

  // Bounded-concurrency worker pool over the client list.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, clients.length) }, async () => {
      while (cursor < clients.length) {
        const row = clients[cursor++];
        await processClient(row);
      }
    }),
  );

  return NextResponse.json({ clients: clients.length, sent, failed });
}

// Weekly cron (vercel.json, Mondays): for every client with an active Google
// Ads link, generate the weekly report and post it to their Slack channel.
// CRON_SECRET-protected. Figures come from the data layer; the text is a
// template (LLM wording can swap in later without touching the numbers).
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import {
  generateWeeklyReport,
  getDashboard,
  getWeeklyOptimisations,
} from "@/lib/integrations/google-ads/reporting";
import { generateNarrative } from "@/lib/integrations/anthropic/narrative";

export const maxDuration = 300;

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

  let sent = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const clientId = row.client_id as string;
    const customerId = row.google_ads_customer_id as string;
    // Report on the leaf account (the linked id may be a manager/MCC).
    const reportingId =
      (row.google_ads_reporting_customer_id as string | null) ?? customerId;
    const companyName =
      (row.clients as unknown as { company_name?: string } | null)?.company_name ?? "";

    try {
      const report = await generateWeeklyReport(reportingId);

      // Richer prose narrative (LLM, words only). Needs the fuller weekly
      // dashboard for material; falls back to the bulleted template if the
      // dashboard or the Anthropic key is unavailable.
      let narrative: string | null = null;
      try {
        const dash = await getDashboard(clientId, reportingId, 7);
        const optimisations = await getWeeklyOptimisations(
          reportingId,
          dash.weekly.start,
          dash.weekly.end,
        );
        narrative = await generateNarrative(dash, companyName, optimisations);
      } catch (e) {
        console.error(`Narrative skipped for ${clientId}:`, e);
      }
      const body = narrative ?? report.text;

      // Post a DRAFT to the internal review channel (not the client's channel) —
      // the team reviews + edits before it goes to the client. Includes a link
      // to the client's live dashboard.
      const reviewChannel = process.env.SLACK_REVIEW_CHANNEL;
      if (process.env.SLACK_BOT_TOKEN && reviewChannel) {
        try {
          const { postMessage } = await import("@/lib/integrations/slack");
          const base = process.env.APP_BASE_URL ?? "https://ppcmastery.vercel.app";
          const draft = [
            `📊 *Weekly report draft — ${companyName}* (${report.weekly.start} → ${report.weekly.end})`,
            "",
            body,
            "",
            `👉 Client dashboard: ${base}/onboarding/${clientId}`,
            "_Draft for review — not yet sent to the client._",
          ].join("\n");
          await postMessage(reviewChannel, draft);
        } catch (e) {
          console.error(`Weekly draft post failed for ${clientId}:`, e);
        }
      }

      // Store the report (best-effort — works once migration 0009 is run).
      try {
        await supabase.from("weekly_reports").insert({
          client_id: clientId,
          period_start: report.weekly.start,
          period_end: report.weekly.end,
          payload: { ...report.weekly, narrative },
        });
      } catch {
        /* table may not exist yet */
      }

      await logActivity({
        clientId,
        eventType: "weekly_report_sent",
        actor: "system:cron",
        payload: { period_end: report.weekly.end },
      });
      sent++;
    } catch (e) {
      console.error(`Weekly report failed for client ${clientId}:`, e);
      failed++;
    }
  }

  return NextResponse.json({ clients: rows?.length ?? 0, sent, failed });
}

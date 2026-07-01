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
      "client_id, google_ads_customer_id, google_ads_reporting_customer_id, clients(company_name, contact_name, report_prompt)",
    )
    .eq("ad_link_status", "approved")
    .not("google_ads_customer_id", "is", null);

  // Optional single-account filter for one-off test runs (no spam): pass
  // ?clientId=<uuid> (exact) or ?company=<substring> (case-insensitive). With
  // neither, the full book runs (the scheduled behaviour).
  const url = new URL(request.url);
  const onlyClientId = url.searchParams.get("clientId");
  const onlyCompany = url.searchParams.get("company");
  // ?window=month → last complete calendar month vs the month before (monthly
  // narrative). Default is the Mon-Sun weekly report.
  const isMonthly = url.searchParams.get("window") === "month";
  const reportRange = isMonthly ? "month" : "mon_sun";
  const companyOf = (r: { clients?: unknown }) =>
    (r.clients as unknown as { company_name?: string } | null)?.company_name ?? "";

  let clients = rows ?? [];
  if (onlyClientId) {
    clients = clients.filter((r) => r.client_id === onlyClientId);
  } else if (onlyCompany) {
    const q = onlyCompany.toLowerCase();
    clients = clients.filter((r) => companyOf(r).toLowerCase().includes(q));
  }

  // Dry-run roster: ?list=1 returns the eligible accounts (after any filter)
  // WITHOUT generating reports or posting to Slack — for discovering exact
  // names / confirming an account is in the approved+linked set.
  if (url.searchParams.get("list") === "1") {
    return NextResponse.json({
      total: clients.length,
      accounts: clients.map((r) => ({
        clientId: r.client_id,
        company: companyOf(r),
        customerId: r.google_ads_customer_id,
      })),
    });
  }
  const base = process.env.APP_BASE_URL ?? "https://ppcmastery.vercel.app";
  const reviewChannel = process.env.SLACK_REVIEW_CHANNEL;
  const slackOn = !!process.env.SLACK_BOT_TOKEN && !!reviewChannel;

  let sent = 0;
  let failed = 0;
  let slackFailed = 0;
  const slackErrors: string[] = [];

  async function processClient(row: (typeof clients)[number]): Promise<void> {
    const clientId = row.client_id as string;
    const customerId = row.google_ads_customer_id as string;
    // Report on the leaf account (the linked id may be a manager/MCC).
    const reportingId =
      (row.google_ads_reporting_customer_id as string | null) ?? customerId;
    const clientMeta = row.clients as unknown as
      | { company_name?: string; contact_name?: string | null; report_prompt?: string | null }
      | null;
    const companyName = clientMeta?.company_name ?? "";
    const contactName = clientMeta?.contact_name ?? null;
    const reportPrompt = clientMeta?.report_prompt ?? null;

    try {
      // One dashboard pull (cached) gives us the verified numbers + the material
      // for the narrative. The period is the Mon-Sun week, or the last calendar
      // month when window=month.
      const dash = await getDashboard(clientId, reportingId, reportRange);
      const period = isMonthly ? dash.range : dash.weekly;
      const optimisations = await getWeeklyOptimisations(reportingId, period.start, period.end);

      let narrative: string | null = null;
      try {
        narrative = await generateNarrative(dash, companyName, optimisations, contactName, {
          accountPrompt: reportPrompt,
          cadence: isMonthly ? "monthly" : "weekly",
        });
      } catch (e) {
        console.error(`Narrative skipped for ${clientId}:`, e);
      }
      const body = narrative ?? formatWeeklyText(dash.weekly, dash.currency);

      // Deliver the draft to the review channel. A wrong/uninvited channel must
      // NOT look like success — surface the failure instead of swallowing it.
      // (Prefer the channel ID over a #name in SLACK_REVIEW_CHANNEL: names that
      //  don't resolve fail silently.)
      let delivered = !slackOn; // nothing to deliver when Slack is off
      if (slackOn) {
        try {
          const { postMessage } = await import("@/lib/integrations/slack");
          const draft = [
            `📊 *${isMonthly ? "Monthly" : "Weekly"} report draft: ${companyName}* (${period.start} to ${period.end})`,
            "",
            body,
            "",
            `👉 Client dashboard: ${base}/onboarding/${clientId}`,
            "_Draft for review, not yet sent to the client._",
          ].join("\n");
          await postMessage(reviewChannel!, draft);
          delivered = true;
        } catch (e) {
          slackFailed++;
          slackErrors.push(`${companyName || clientId}: ${e instanceof Error ? e.message : "unknown error"}`);
          console.error(`Weekly draft post failed for ${clientId}:`, e);
        }
      }

      try {
        await supabase.from("weekly_reports").insert({
          client_id: clientId,
          period_start: period.start,
          period_end: period.end,
          payload: { ...dash.weekly, narrative, cadence: isMonthly ? "monthly" : "weekly" },
        });
      } catch {
        /* table may not exist yet */
      }

      await logActivity({
        clientId,
        eventType: delivered ? "weekly_report_sent" : "weekly_report_generated",
        actor: "system:cron",
        payload: { period_end: dash.weekly.end, slack_delivered: delivered },
      });
      if (delivered) sent++;
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

  const filtered = !!(onlyClientId || onlyCompany);
  return NextResponse.json({
    clients: clients.length,
    sent,
    failed,
    slackFailed,
    ...(slackErrors.length ? { slackErrors } : {}),
    ...(filtered ? { matched: clients.map(companyOf) } : {}),
  });
}

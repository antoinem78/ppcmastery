// On-demand report push: build a report for a named range and post the draft to
// the Slack review channel (same destination as the weekly cron). Reused by the
// client-page "Send to Slack" button. Manual, admin-triggered; a draft for human
// review, never sent to the client automatically.
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import {
  getDashboardForRange,
  getDashboardForCustomRange,
  getWeeklyOptimisations,
  formatWeeklyText,
  REPORT_RANGES,
  cadenceFor,
  type ReportRange,
} from "@/lib/integrations/google-ads/reporting";
import { generateNarrative } from "@/lib/integrations/anthropic/narrative";

export async function sendClientReportToSlack(
  clientId: string,
  range: ReportRange | "custom",
  actor = "admin",
  opts?: { start?: string; end?: string },
): Promise<{ ok: true; message: string } | { error: string }> {
  const isCustom = range === "custom";
  if (isCustom && (!opts?.start || !opts?.end)) return { error: "Custom range needs a start and end date." };
  if (isCustom && opts!.start! > opts!.end!) return { error: "Start date must be on or before the end date." };
  const supabase = createSupabaseAdminClient();
  const { data: st } = await supabase
    .from("onboarding_state")
    .select("google_ads_customer_id, google_ads_reporting_customer_id, ad_link_status, clients(company_name, contact_name, report_prompt)")
    .eq("client_id", clientId)
    .single();

  if (!st || !st.google_ads_customer_id) return { error: "This client has no linked Google Ads account." };
  if (st.ad_link_status !== "approved") return { error: "The Google Ads link is not approved yet." };

  const channel = process.env.SLACK_REVIEW_CHANNEL;
  if (!process.env.SLACK_BOT_TOKEN || !channel) {
    return { error: "Slack is not configured (SLACK_BOT_TOKEN / SLACK_REVIEW_CHANNEL)." };
  }

  const reportingId = (st.google_ads_reporting_customer_id as string | null) ?? (st.google_ads_customer_id as string);
  const meta = st.clients as unknown as { company_name?: string; contact_name?: string | null; report_prompt?: string | null } | null;
  const company = meta?.company_name ?? "";
  const rangeLabel = isCustom ? `${opts!.start} to ${opts!.end}` : REPORT_RANGES.find((r) => r.key === range)?.label ?? range;

  try {
    const dash = isCustom
      ? await getDashboardForCustomRange(reportingId, opts!.start!, opts!.end!)
      : await getDashboardForRange(reportingId, range as ReportRange);
    // Custom cadence: treat a span of ~3 weeks+ as monthly framing.
    const spanDays = Math.round((new Date(dash.range.end).getTime() - new Date(dash.range.start).getTime()) / 86_400_000) + 1;
    const cadence = isCustom ? (spanDays >= 20 ? "monthly" : "weekly") : cadenceFor(range as ReportRange);
    const optimisations = await getWeeklyOptimisations(reportingId, dash.range.start, dash.range.end);
    let body: string | null = null;
    try {
      body = await generateNarrative(dash, company, optimisations, meta?.contact_name ?? null, {
        accountPrompt: meta?.report_prompt ?? null,
        cadence,
      });
    } catch (e) {
      console.error("Report narrative failed (using template):", e);
    }
    const text = body ?? formatWeeklyText(dash.weekly, dash.currency);
    const base = process.env.APP_BASE_URL ?? "https://ppcmastery.vercel.app";
    const draft = [
      `📊 *Report draft: ${company}* — ${rangeLabel} (${dash.range.start} to ${dash.range.end})`,
      "",
      text,
      "",
      `👉 Client dashboard: ${base}/onboarding/${clientId}`,
      "_Draft for review, not yet sent to the client._",
    ].join("\n");

    const { postMessage } = await import("@/lib/integrations/slack");
    await postMessage(channel, draft);
    await logActivity({
      clientId,
      eventType: "report_pushed_to_slack",
      actor,
      payload: { range, period_start: dash.range.start, period_end: dash.range.end },
    });
    return { ok: true, message: `${rangeLabel} report posted to the review channel.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to build or post the report." };
  }
}

// Command Center — agency overview + live alerts across every approved account.
//
// Pulls the lightweight getAccountSummary (most recent complete Mon-Sun week vs
// the prior week) for each approved+linked account with bounded concurrency,
// evaluates alerts, and rolls totals up PER CURRENCY (never summed across
// currencies). Single-agency: the account roster is the same approved set the
// weekly cron reports on.
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getAccountSummary, type AccountSummary } from "@/lib/integrations/google-ads/reporting";

// Tunable alert thresholds.
const MEANINGFUL_SPEND = 50; // ignore noise on tiny-spend accounts
const CONV_DROP_CRITICAL = -25; // % WoW
const CONV_DROP_WARNING = -10;
const SPEND_SPIKE_WARNING = 40;
const CONCURRENCY = 5;

export type AlertSeverity = "critical" | "warning";
export interface AccountAlert {
  severity: AlertSeverity;
  message: string;
}

export interface CommandCenterAccount {
  clientId: string;
  company: string;
  customerId: string; // the reporting (leaf) id
  currency: string;
  summary: AccountSummary | null; // null when the pull failed
  alerts: AccountAlert[];
  status: "healthy" | "action";
  error?: string;
}

export interface CurrencyTotals {
  currency: string;
  accounts: number;
  spend: number;
  conversions: number;
  convValue: number;
}

export interface CommandCenter {
  generatedAt: string;
  accounts: CommandCenterAccount[];
  totalsByCurrency: CurrencyTotals[];
  openAlerts: { critical: number; warning: number };
}

export function evaluateAlerts(s: AccountSummary): AccountAlert[] {
  const alerts: AccountAlert[] = [];
  const round = (n: number) => Math.round(n);

  if (s.spend.value >= MEANINGFUL_SPEND && s.conversions.value === 0) {
    alerts.push({ severity: "critical", message: `Spent ${s.currency} ${round(s.spend.value)} with no conversions this week` });
  }
  if (s.conversions.deltaPct != null) {
    if (s.conversions.deltaPct <= CONV_DROP_CRITICAL) {
      alerts.push({ severity: "critical", message: `Conversions down ${round(Math.abs(s.conversions.deltaPct))}% week on week` });
    } else if (s.conversions.deltaPct <= CONV_DROP_WARNING) {
      alerts.push({ severity: "warning", message: `Conversions down ${round(Math.abs(s.conversions.deltaPct))}% week on week` });
    }
  }
  if (s.spend.deltaPct != null && s.spend.deltaPct >= SPEND_SPIKE_WARNING) {
    alerts.push({ severity: "warning", message: `Spend up ${round(s.spend.deltaPct)}% week on week` });
  }
  return alerts;
}

interface Roster {
  clientId: string;
  company: string;
  reportingId: string;
}

async function approvedAccounts(): Promise<Roster[]> {
  const supabase = createSupabaseAdminClient();
  const { data: rows } = await supabase
    .from("onboarding_state")
    .select("client_id, google_ads_customer_id, google_ads_reporting_customer_id, clients(company_name)")
    .eq("ad_link_status", "approved")
    .not("google_ads_customer_id", "is", null);
  return (rows ?? []).map((r) => ({
    clientId: r.client_id as string,
    company: (r.clients as unknown as { company_name?: string } | null)?.company_name ?? "",
    reportingId: (r.google_ads_reporting_customer_id as string | null) ?? (r.google_ads_customer_id as string),
  }));
}

// Action-first, then by spend desc (within what we could load).
const severityRank = (a: CommandCenterAccount) =>
  a.alerts.some((x) => x.severity === "critical") ? 0 : a.alerts.some((x) => x.severity === "warning") ? 1 : a.error ? 2 : 3;

export async function getCommandCenter(): Promise<CommandCenter> {
  const roster = await approvedAccounts();
  const accounts: CommandCenterAccount[] = new Array(roster.length);

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, roster.length) }, async () => {
      while (cursor < roster.length) {
        const i = cursor++;
        const r = roster[i];
        try {
          const summary = await getAccountSummary(r.reportingId);
          const alerts = evaluateAlerts(summary);
          accounts[i] = {
            clientId: r.clientId,
            company: r.company,
            customerId: r.reportingId,
            currency: summary.currency,
            summary,
            alerts,
            status: alerts.length ? "action" : "healthy",
          };
        } catch (e) {
          accounts[i] = {
            clientId: r.clientId,
            company: r.company,
            customerId: r.reportingId,
            currency: "",
            summary: null,
            alerts: [],
            status: "action",
            error: e instanceof Error ? e.message : "Could not load this account",
          };
        }
      }
    }),
  );

  // Per-currency roll-up (never cross-currency).
  const byCurrency = new Map<string, CurrencyTotals>();
  for (const a of accounts) {
    if (!a.summary) continue;
    const t = byCurrency.get(a.currency) ?? { currency: a.currency, accounts: 0, spend: 0, conversions: 0, convValue: 0 };
    t.accounts += 1;
    t.spend += a.summary.spend.value;
    t.conversions += a.summary.conversions.value;
    t.convValue += a.summary.convValue.value;
    byCurrency.set(a.currency, t);
  }

  const openAlerts = accounts.reduce(
    (acc, a) => {
      for (const al of a.alerts) acc[al.severity] += 1;
      return acc;
    },
    { critical: 0, warning: 0 },
  );

  accounts.sort((a, b) => severityRank(a) - severityRank(b) || (b.summary?.spend.value ?? 0) - (a.summary?.spend.value ?? 0));

  return {
    generatedAt: new Date().toISOString(),
    accounts,
    totalsByCurrency: [...byCurrency.values()].sort((a, b) => b.spend - a.spend),
    openAlerts,
  };
}

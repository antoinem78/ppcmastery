"use client";
import { useState } from "react";
import { useStore, CURRENCY_SYMBOLS } from "@/lib/store";
import { qualityScore, recommendations, differentiation, toExport, exportFilename } from "@/lib/adforge";
import { Button, Card, cx, inputClass } from "@/components/ui";

const typeTag = (t: string) => (t === "skag-exact" ? "SKAG [E]" : t === "skag-phrase" ? 'SKAG "P"' : "STAG");

interface PublishOk { validateOnly: boolean; operationCount: number; campaignResourceName: string | null }

export default function ReviewStep() {
  const { campaign, currency, setStep } = useStore();
  const symbol = CURRENCY_SYMBOLS[currency] ?? "$";
  const [showPublish, setShowPublish] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10");
  const [busy, setBusy] = useState<"validate" | "publish" | null>(null);
  const [publishErr, setPublishErr] = useState<string | null>(null);
  const [publishOk, setPublishOk] = useState<{ kind: "validate" | "publish"; msg: string } | null>(null);

  if (!campaign) return null;
  const qs = qualityScore(campaign);
  const recs = recommendations(campaign);
  const diff = differentiation(campaign);

  const skags = campaign.adGroups.filter((g) => g.type !== "stag").length;
  const stags = campaign.adGroups.filter((g) => g.type === "stag").length;
  const keywords = campaign.adGroups.reduce((n, g) => n + g.keywords.length, 0);
  const negatives = campaign.adGroups.reduce((n, g) => n + g.negativeKeywords.length, 0);

  const missingUrls = campaign.ads.some((a) => !a.finalUrl.trim());
  const missingDesc = campaign.ads.some((a) => a.descriptions.every((d) => !d.text.trim()));

  const ringColor = qs.total >= 80 ? "text-success" : qs.total >= 60 ? "text-primary" : qs.total >= 40 ? "text-warning" : "text-destructive";
  const R = 42;
  const C = 2 * Math.PI * R;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(toExport(campaign), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(campaign.name);
    a.click();
    URL.revokeObjectURL(url);
  };

  const runPublish = async (validateOnly: boolean) => {
    setPublishErr(null);
    setPublishOk(null);
    setBusy(validateOnly ? "validate" : "publish");
    try {
      const res = await fetch("/api/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, dailyBudget: Number(dailyBudget) || 10, validateOnly, campaign }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error || "Publish failed.");
      const ok = data as PublishOk;
      setPublishOk({
        kind: validateOnly ? "validate" : "publish",
        msg: validateOnly
          ? `Validation passed — ${ok.operationCount} operations are ready to publish.`
          : `Published (PAUSED) to account ${customerId}. ${ok.campaignResourceName ?? "Campaign created"}. Review and enable it in Google Ads.`,
      });
    } catch (e) {
      setPublishErr(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setBusy(null);
    }
  };

  const buckets = [
    { label: "Ads Quality", b: qs.categories.ads },
    { label: "Keyword Strategy", b: qs.categories.keywords },
    { label: "Campaign Structure", b: qs.categories.structure },
    { label: "Assets Usage", b: qs.categories.assets },
  ];
  const stats = [
    { label: "SKAGs", value: skags, accent: "text-primary" },
    { label: "STAGs", value: stags, accent: "text-accent-foreground" },
    { label: "Keywords", value: keywords, accent: "text-foreground" },
    { label: "Negatives", value: negatives, accent: negatives > 0 ? "text-destructive" : "text-foreground" },
    { label: "Ads", value: campaign.ads.length, accent: "text-foreground" },
    { label: "Sitelinks", value: campaign.sitelinks.length, accent: campaign.sitelinks.length ? "text-foreground" : "text-muted-foreground" },
    { label: "Callouts", value: campaign.callouts.length, accent: campaign.callouts.length ? "text-foreground" : "text-muted-foreground" },
  ];

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold tracking-tight">Review &amp; Publish</h1>
      <p className="text-sm text-muted-foreground">Review your campaign before publishing to Google Ads.</p>

      {/* differentiation checklist */}
      <Card className="mt-5 p-5">
        <div className="text-sm font-semibold">Differentiation Checklist</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            { ok: diff.uspDetected, label: "USP detected" },
            { ok: diff.uspInHeadlines, label: "USP in headlines" },
            { ok: diff.uniqueMessaging, label: "Unique messaging" },
          ].map((c) => (
            <div key={c.label} className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", c.ok ? "border-success/40 text-foreground" : "border-border text-muted-foreground")}>
              <span className={c.ok ? "text-success" : "text-muted-foreground"}>{c.ok ? "✓" : "○"}</span>
              {c.label}
            </div>
          ))}
        </div>
      </Card>

      {/* quality score */}
      <Card className="mt-5 p-5">
        <div className="text-sm font-semibold">Campaign Quality Score</div>
        <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative h-28 w-28 shrink-0">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
              <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - qs.total / 100)} className={ringColor} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cx("text-2xl font-bold", ringColor)}>{qs.total}</span>
              <span className="text-[10px] text-muted-foreground">/ 100</span>
            </div>
          </div>
          <div className="flex-1 space-y-2.5">
            {buckets.map(({ label, b }) => (
              <div key={label}>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{b.score}/{b.max}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(b.score / b.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <span className={cx("self-start rounded-full px-3 py-1 text-xs font-medium", ringColor, "bg-muted")}>{qs.label}</span>
        </div>

        {recs.length > 0 && (
          <div className="mt-5 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">Recommendations to improve your score</div>
            {recs.map((r, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", r.priority === "high" ? "bg-destructive/15 text-destructive" : r.priority === "medium" ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground")}>{r.category} · {r.priority}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* summary */}
      <Card className="mt-5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">✓ {campaign.name}</div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>Network: <b className="text-foreground">Google Search only</b></span>
          <span>Location: <b className="text-foreground">{campaign.settings.locationTargeting[0]?.name ?? "Online"}</b></span>
          <span>Languages: <b className="text-foreground">English</b></span>
          <span>USP Strength: <b className="text-foreground capitalize">{campaign.settings.uspStrength}</b></span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border p-3 text-center">
              <div className={cx("text-xl font-bold tabular-nums", s.accent)}>{s.value}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1.5">
          {campaign.adGroups.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{g.name}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{typeTag(g.type)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{g.keywords.length} kw</span>
                <span>{g.negativeKeywords.length} neg</span>
                <span>{campaign.ads.filter((a) => a.adGroupId === g.id).length} ads</span>
                <span className="tabular-nums">{symbol}{g.maxCpc.toFixed(2)} CPC</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* validation */}
      {(missingUrls || missingDesc) && (
        <div className="mt-4 space-y-2">
          {missingUrls && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">Some ads are missing Final URLs. Add them before publishing.</div>}
          {missingDesc && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">Some ads are missing descriptions. Add at least one description per ad.</div>}
        </div>
      )}

      {showPublish && (
        <Card className="mt-4 space-y-4 p-5">
          <div>
            <div className="text-sm font-semibold">Publish to Google Ads</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Creates the campaign <b>PAUSED</b> in the target account so you can review it inside Google Ads before it spends.
              Validate first (no changes written), then publish. Location and language targeting are set in Google Ads after publish.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-muted-foreground">Target customer ID</span>
              <input className={cx(inputClass, "py-2")} value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="123-456-7890" />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-muted-foreground">Daily budget ({symbol})</span>
              <input className={cx(inputClass, "py-2")} value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} placeholder="10" inputMode="decimal" />
            </label>
          </div>
          {publishErr && <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{publishErr}</div>}
          {publishOk && (
            <div className={cx("rounded-lg border px-3 py-2 text-sm", publishOk.kind === "publish" ? "border-success/40 bg-success/5 text-foreground" : "border-primary/40 bg-primary/5 text-foreground")}>
              {publishOk.kind === "publish" ? "✓ " : "✓ "}{publishOk.msg}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!customerId.trim() || busy !== null || missingUrls || missingDesc} onClick={() => runPublish(true)}>
              {busy === "validate" ? "Validating…" : "Validate"}
            </Button>
            <Button variant="gradient" disabled={!customerId.trim() || busy !== null || missingUrls || missingDesc} onClick={() => runPublish(false)}>
              {busy === "publish" ? "Publishing…" : "⬆ Publish (paused)"}
            </Button>
          </div>
          {(missingUrls || missingDesc) && <div className="text-xs text-muted-foreground">Resolve the validation warnings above before publishing.</div>}
        </Card>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => setStep(4)}>← Back</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportJson}>⬇ Export JSON</Button>
          <Button variant="gradient" onClick={() => setShowPublish((v) => !v)}>⬆ Publish to Google Ads</Button>
        </div>
      </div>
    </div>
  );
}

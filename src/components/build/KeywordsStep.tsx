"use client";
import { useState } from "react";
import { useStore, useSettings, CURRENCY_SYMBOLS } from "@/lib/store";
import { USP_CATALOG, campaignNameSuggestions, uspStrength } from "@/lib/adforge";
import { Button, Card, Chip, Field, inputClass, cx } from "@/components/ui";
import { generateKeywordSuggestions } from "./ai";

export default function KeywordsStep() {
  const s = useStore();
  const expert = useSettings((x) => x.expertMode);
  const [custom, setCustom] = useState("");
  const [customUsp, setCustomUsp] = useState<Record<string, string>>({});
  const [kwBusy, setKwBusy] = useState(false);
  const [kwErr, setKwErr] = useState<string | null>(null);

  const onAiKeywords = async () => {
    setKwErr(null);
    setKwBusy(true);
    try {
      const { keywords } = await generateKeywordSuggestions();
      keywords.forEach((k) => s.addCustomKeyword(k));
    } catch (e) {
      setKwErr(e instanceof Error ? e.message : "Keyword suggestion failed.");
    } finally {
      setKwBusy(false);
    }
  };

  const symbol = CURRENCY_SYMBOLS[s.currency] ?? "$";
  const nameSuggestions = campaignNameSuggestions(s.conversation.services, s.conversation.location);
  const strength = uspStrength(s.selectedUSPs);
  const uspCount = s.selectedUSPs.reduce((n, c) => n + c.options.length, 0);
  const n = s.selectedKeywords.length;
  const isUspSelected = (cat: string, text: string) =>
    s.selectedUSPs.find((c) => c.category === cat)?.options.some((o) => o.text === text) ?? false;

  const missing = [
    !s.campaignName.trim() && "a campaign name",
    uspCount < 1 && "at least 1 USP",
    n < 1 && "at least 1 keyword",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Keywords Setup</h1>
        <p className="text-sm text-muted-foreground">Choose your keyword source, select keywords, and configure your campaign.</p>
      </div>

      {/* keyword source */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Keyword Source</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => s.setKeywordSource("smart")}
            className={cx("rounded-xl border bg-card p-4 text-left", s.keywordSource === "smart" ? "border-primary ring-2 ring-ring/30" : "border-border")}
          >
            <div className="flex items-center gap-2 font-semibold"><span className="text-accent">✦</span> Smart Keyword Suggestions</div>
            {expert && <p className="mt-1 text-xs text-muted-foreground">Deterministic pattern expansion from your services and location. No API needed.</p>}
          </button>
          <div className="relative rounded-xl border border-border bg-muted/40 p-4 opacity-70">
            <span className="absolute right-3 top-3 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent-foreground">Recommended</span>
            <div className="font-semibold text-muted-foreground">Google Keyword Planner</div>
            {expert && <p className="mt-1 text-xs text-muted-foreground">Live search-volume data. Requires connecting your Google Ads account.</p>}
            <button type="button" disabled className="mt-3 inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">🔒 Connect to unlock</button>
          </div>
        </div>
      </Card>

      {/* generated keywords */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Generated Keywords</h2>
          <Button variant="secondary" disabled={kwBusy} onClick={onAiKeywords}>
            {kwBusy ? "Suggesting…" : "✦ AI keyword suggestions"}
          </Button>
        </div>
        {kwErr && <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{kwErr}</div>}
        <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
          {s.generatedKeywords.map((k) => (
            <Chip key={k} selected={s.selectedKeywords.includes(k)} onClick={() => s.toggleKeyword(k)}>{k}</Chip>
          ))}
          {s.generatedKeywords.length === 0 && <p className="text-sm text-muted-foreground">No keywords yet, go back and add services.</p>}
        </div>
        <div className="mt-3 flex max-w-md gap-2">
          <input
            className={inputClass}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (s.addCustomKeyword(custom), setCustom("")))}
            placeholder="Add custom keyword…"
          />
          <Button variant="secondary" onClick={() => (s.addCustomKeyword(custom), setCustom(""))}>+</Button>
        </div>
        <p className="mt-2 text-xs font-medium text-muted-foreground">{n} keyword(s) → {n * 2} SKAGs + 1 STAG</p>
      </Card>

      {/* core campaign info */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Core Campaign Info</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Campaign Name">
            <input className={inputClass} value={s.campaignName} onChange={(e) => s.setCampaignName(e.target.value)} placeholder="e.g. Botox London - Search" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {nameSuggestions.map((sug) => (
                <button key={sug} type="button" onClick={() => s.setCampaignName(sug)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">
                  {sug}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Default Max CPC (${symbol})`}>
            <div className="flex items-center gap-2">
              <Button variant="secondary" className="px-3" onClick={() => s.setMaxCpc(Math.max(0.1, Math.round((s.maxCpc - 0.5) * 100) / 100))}>−</Button>
              <input className={cx(inputClass, "text-center")} value={s.maxCpc.toFixed(2)} onChange={(e) => s.setMaxCpc(Number(e.target.value) || 0)} />
              <Button variant="secondary" className="px-3" onClick={() => s.setMaxCpc(Math.round((s.maxCpc + 0.5) * 100) / 100)}>+</Button>
            </div>
          </Field>
          <Field label="Currency" hint="Symbol shown in the builder. Budgets publish in the target account's own currency.">
            <select className={inputClass} value={s.currency} onChange={(e) => s.setCurrency(e.target.value)}>
              {Object.keys(CURRENCY_SYMBOLS).map((code) => (
                <option key={code} value={code}>{code} ({CURRENCY_SYMBOLS[code]})</option>
              ))}
            </select>
          </Field>
          <Field label="Location Targeting">
            <input
              className={inputClass}
              value={s.conversation.location}
              onChange={(e) => s.setLocation(e.target.value)}
              placeholder={s.conversation.isOnline ? "Online (optional)" : "e.g. London"}
            />
          </Field>
          <Field label="Language">
            <input className={cx(inputClass, "bg-muted/40")} value="English" readOnly />
          </Field>
        </div>
      </Card>

      {/* USPs */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">What Makes Your Offer Different? <span className="text-destructive">*</span></h2>
          <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", strength === "strong" ? "bg-success/15 text-success" : strength === "average" ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground")}>
            {strength} ({uspCount} USP{uspCount === 1 ? "" : "s"})
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {USP_CATALOG.map((cat) => (
            <div key={cat.id} className="rounded-xl border border-border p-4">
              <div className="text-sm font-semibold">{cat.label}</div>
              <div className="text-xs text-muted-foreground">{cat.description}</div>
              <div className="mt-3 space-y-1.5">
                {cat.options.map((opt) => (
                  <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={isUspSelected(cat.id, opt)} onChange={() => s.toggleUsp(cat.id, opt)} className="accent-primary" />
                    {opt}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  className={cx(inputClass, "py-1.5 text-xs")}
                  value={customUsp[cat.id] ?? ""}
                  onChange={(e) => setCustomUsp((m) => ({ ...m, [cat.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (s.addCustomUsp(cat.id, customUsp[cat.id] ?? ""), setCustomUsp((m) => ({ ...m, [cat.id]: "" }))))}
                  placeholder="Add custom USP…"
                />
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => (s.addCustomUsp(cat.id, customUsp[cat.id] ?? ""), setCustomUsp((m) => ({ ...m, [cat.id]: "" })))}>+</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => s.setStep(0)}>← Back</Button>
        <div className="flex items-center gap-3">
          {missing.length > 0 && <span className="text-xs text-muted-foreground">Need: {missing.join(", ")}</span>}
          <Button variant="gradient" disabled={!s.canGenerate()} onClick={s.generateCampaign}>Generate Campaign &amp; Continue to Ads →</Button>
        </div>
      </div>
    </div>
  );
}

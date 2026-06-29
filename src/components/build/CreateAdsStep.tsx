"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Card, Counter, cx, inputClass } from "@/components/ui";
import { HEADLINE_MAX, DESC_MAX } from "@/lib/adforge";
import { generateAds } from "./ai";

const headlineKind = (i: number) => (i < 5 ? "keyword" : i < 10 ? "USP" : "CTA");

export default function CreateAdsStep() {
  const { campaign, updateHeadline, updateDescription, updateAdField, deleteAd, setAdGroupCopy, setStep } = useStore();
  const [activeId, setActiveId] = useState<string | null>(campaign?.adGroups[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null); // ad group id, or "ALL"
  const [error, setError] = useState<string | null>(null);

  if (!campaign) return <p className="py-10 text-sm text-muted-foreground">Generate a campaign first.</p>;
  const active = campaign.adGroups.find((g) => g.id === activeId) ?? campaign.adGroups[0];
  const ads = campaign.ads.filter((a) => a.adGroupId === active.id);
  const adGroups = campaign.adGroups;

  async function genGroup(groupId: string) {
    const g = adGroups.find((x) => x.id === groupId);
    if (!g) return;
    const { headlines, descriptions } = await generateAds({ name: g.name, keywords: g.keywords.map((k) => k.text) });
    setAdGroupCopy(groupId, headlines, descriptions);
  }

  async function onGenerateActive() {
    setError(null);
    setBusy(active.id);
    try {
      await genGroup(active.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onGenerateAll() {
    setError(null);
    setBusy("ALL");
    try {
      for (const g of adGroups) await genGroup(g.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  }

  const busyAny = busy !== null;

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create Ads</h1>
          <p className="text-sm text-muted-foreground">Two responsive search ads per ad group. Generate copy with AI, then fine-tune.</p>
        </div>
        <Button variant="gradient" disabled={busyAny} onClick={onGenerateAll}>
          {busy === "ALL" ? "Generating all…" : `✦ Generate all ${adGroups.length} ad groups`}
        </Button>
      </div>

      {error && <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[16rem_1fr]">
        {/* ad group rail */}
        <div className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
          {adGroups.map((g) => {
            const count = campaign.ads.filter((a) => a.adGroupId === g.id).length;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveId(g.id)}
                className={cx(
                  "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  g.id === active.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{g.name}</span>
                  {busy === g.id && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary" />}
                </div>
                <div className="text-[11px] text-muted-foreground">{count} ads</div>
              </button>
            );
          })}
        </div>

        {/* ad editor */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{active.name}</div>
            <Button variant="secondary" disabled={busyAny} onClick={onGenerateActive}>
              {busy === active.id ? "Generating…" : "✦ Generate with AI"}
            </Button>
          </div>
          {ads.map((ad, ai) => {
            const isDki = ad.headlines[0]?.text.startsWith("{KeyWord:");
            return (
              <Card key={ad.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    Ad {ai + 1}
                    {isDki && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent-foreground">DKI</span>}
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">✦ Uses USP</span>
                  </div>
                  <button type="button" onClick={() => deleteAd(ad.id)} className="text-muted-foreground hover:text-destructive" aria-label="Delete ad">🗑</button>
                </div>

                <div className="mt-3 text-xs font-medium text-muted-foreground">Headlines (up to 15)</div>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {ad.headlines.map((h, i) => (
                    <div key={h.id} className="rounded-lg border border-border px-2.5 py-1.5">
                      <input
                        className="w-full bg-transparent text-sm outline-none"
                        value={h.text}
                        onChange={(e) => updateHeadline(ad.id, i, e.target.value)}
                      />
                      <div className="flex items-center justify-between">
                        <span className={cx("text-[9px] uppercase tracking-wide", headlineKind(i) === "USP" ? "text-primary" : "text-muted-foreground/60")}>{headlineKind(i)}</span>
                        <Counter value={h.text.length} max={HEADLINE_MAX} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 text-xs font-medium text-muted-foreground">Descriptions (up to 4)</div>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  {ad.descriptions.map((d, i) => (
                    <div key={d.id} className="rounded-lg border border-border px-2.5 py-1.5">
                      <input
                        className="w-full bg-transparent text-sm outline-none"
                        value={d.text}
                        placeholder={`Description ${i + 1}`}
                        onChange={(e) => updateDescription(ad.id, i, e.target.value)}
                      />
                      <div className="text-right"><Counter value={d.text.length} max={DESC_MAX} /></div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-muted-foreground">Final URL</span>
                    <input className={cx(inputClass, "py-2")} value={ad.finalUrl} onChange={(e) => updateAdField(ad.id, "finalUrl", e.target.value)} placeholder="https://example.com/page" />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-muted-foreground">Path 1</span>
                    <input className={cx(inputClass, "py-2")} value={ad.path1} maxLength={15} onChange={(e) => updateAdField(ad.id, "path1", e.target.value)} placeholder="path1" />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-muted-foreground">Path 2</span>
                    <input className={cx(inputClass, "py-2")} value={ad.path2} maxLength={15} onChange={(e) => updateAdField(ad.id, "path2", e.target.value)} placeholder="path2" />
                  </label>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep(1)}>← Back</Button>
        <Button variant="gradient" onClick={() => setStep(3)}>Continue to Sitelinks →</Button>
      </div>
    </div>
  );
}

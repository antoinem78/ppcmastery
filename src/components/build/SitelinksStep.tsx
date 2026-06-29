"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { generateSitelinks } from "./ai";

const empty = { adGroupId: "", linkText: "", finalUrl: "", descriptionLine1: "", descriptionLine2: "", platformTargeting: "All Platforms", devicePreference: "All Devices" };

export default function SitelinksStep() {
  const { campaign, addSitelink, addSitelinks, removeSitelink, setStep } = useStore();
  const [form, setForm] = useState(empty);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!campaign) return null;
  const sitelinks = campaign.sitelinks;
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onGenerate = async () => {
    setError(null);
    setBusy(true);
    try {
      const { sitelinks: items } = await generateSitelinks();
      addSitelinks(items.map((s) => ({ ...empty, ...s })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!form.linkText.trim()) return;
    addSitelink(form);
    setForm(empty);
    setAdding(false);
  };

  return (
    <div className="py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sitelinks</h1>
          <p className="text-sm text-muted-foreground">Add sitelinks to provide additional links in your ads.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="gradient" disabled={busy} onClick={onGenerate}>{busy ? "Generating…" : "✦ Generate with AI"}</Button>
          <Button variant="secondary" onClick={() => setAdding(true)}>+ Add Sitelink</Button>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

      {adding && (
        <Card className="mt-5 space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ad Group">
              <select className={inputClass} value={form.adGroupId} onChange={(e) => set("adGroupId", e.target.value)}>
                <option value="">Campaign Level (All Ad Groups)</option>
                {campaign.adGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Link Text" hint="Max 25 characters">
              <input className={inputClass} maxLength={25} value={form.linkText} onChange={(e) => set("linkText", e.target.value)} placeholder="e.g. Book a Consultation" />
            </Field>
            <Field label="Final URL">
              <input className={inputClass} value={form.finalUrl} onChange={(e) => set("finalUrl", e.target.value)} placeholder="https://example.com/page" />
            </Field>
            <div />
            <Field label="Description Line 1" hint="Max 35 characters">
              <input className={inputClass} maxLength={35} value={form.descriptionLine1} onChange={(e) => set("descriptionLine1", e.target.value)} />
            </Field>
            <Field label="Description Line 2" hint="Max 35 characters">
              <input className={inputClass} maxLength={35} value={form.descriptionLine2} onChange={(e) => set("descriptionLine2", e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={!form.linkText.trim()}>Add</Button>
            <Button variant="ghost" onClick={() => { setForm(empty); setAdding(false); }}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="mt-5 space-y-2">
        {sitelinks.length === 0 && !adding && (
          <Card className="flex flex-col items-center gap-3 border-dashed py-12 text-center">
            <span className="text-3xl text-muted-foreground">🔗</span>
            <div className="text-sm font-medium">No sitelinks yet</div>
            <p className="text-xs text-muted-foreground">Add sitelinks to display additional links below your ads.</p>
            <Button onClick={() => setAdding(true)}>+ Add Your First Sitelink</Button>
          </Card>
        )}
        {sitelinks.map((sl) => (
          <Card key={sl.id} className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm font-semibold">{sl.linkText}</div>
              <div className="text-xs text-muted-foreground">{sl.finalUrl || "no URL"} · {sl.adGroupId ? campaign.adGroups.find((g) => g.id === sl.adGroupId)?.name : "Campaign level"}</div>
            </div>
            <button type="button" onClick={() => removeSitelink(sl.id)} className="text-muted-foreground hover:text-destructive">🗑</button>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep(2)}>← Back</Button>
        <Button variant="gradient" onClick={() => setStep(4)}>Continue to Callouts →</Button>
      </div>
    </div>
  );
}

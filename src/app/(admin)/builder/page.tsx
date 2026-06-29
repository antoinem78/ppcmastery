"use client";
import { useState } from "react";
import { useStore, useSettings, useHydrated } from "@/lib/store";
import { Stepper, Button, Card, Field, inputClass, cx } from "@/components/ui";
import CampaignSetupChat from "@/components/build/CampaignSetupChat";
import KeywordsStep from "@/components/build/KeywordsStep";
import CreateAdsStep from "@/components/build/CreateAdsStep";
import SitelinksStep from "@/components/build/SitelinksStep";
import CalloutsStep from "@/components/build/CalloutsStep";
import ReviewStep from "@/components/build/ReviewStep";

const STEPS = [CampaignSetupChat, KeywordsStep, CreateAdsStep, SitelinksStep, CalloutsStep, ReviewStep];
const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Loader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

export default function BuilderPage() {
  const hydrated = useHydrated();
  const onboardingCompleted = useStore((s) => s.onboardingCompleted);
  const campaignType = useStore((s) => s.campaignType);

  let view: React.ReactNode;
  if (!hydrated) view = <Loader />;
  else if (!onboardingCompleted) view = <Onboarding />;
  else if (!campaignType) view = <TypeChooser />;
  else view = <Wizard />;
  return <div className="p-6 lg:p-8">{view}</div>;
}

function Onboarding() {
  const completeOnboarding = useStore((s) => s.completeOnboarding);
  const skipOnboarding = useStore((s) => s.skipOnboarding);
  const [budget, setBudget] = useState("");
  const [priority, setPriority] = useState("");
  const [avoid, setAvoid] = useState("");
  const [focus, setFocus] = useState("");
  const [actions, setActions] = useState("");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Campaign Onboarding</h1>
      <p className="mt-1 text-sm text-muted-foreground">Help us understand your advertising goals to create better campaigns.</p>
      <Card className="mt-6 space-y-5 p-6">
        <Field label="What is your monthly budget?"><input className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 2,000" /></Field>
        <Field label="Priority keywords" hint="Comma-separated. These seed the keyword list (prepended verbatim)."><input className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="e.g. dental implants, veneers" /></Field>
        <Field label="Keywords or areas to avoid" hint="Comma-separated. These become campaign negative keywords."><input className={inputClass} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="e.g. free, cheap, jobs" /></Field>
        <Field label="Business focus areas"><input className={inputClass} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. installation, product sales" /></Field>
        <Field label="Most valuable actions on your site"><input className={inputClass} value={actions} onChange={(e) => setActions(e.target.value)} placeholder="e.g. phone calls, form submissions" /></Field>
      </Card>
      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={skipOnboarding}>Skip Questionnaire</Button>
        <Button variant="gradient" className="px-6" onClick={() => completeOnboarding({ priorityKeywords: splitList(priority), avoidKeywords: splitList(avoid), answers: { budget, focus, actions } })}>
          Continue to Campaign Builder →
        </Button>
      </div>
    </div>
  );
}

const TYPES = [
  { id: "search" as const, title: "Search Campaign", blurb: "Build keyword-targeted search ads with STAG structure, USP-powered copy, and sitelinks.", features: ["Keyword expansion", "SKAG + STAG structure", "USP-driven ad copy", "Sitelinks & review"], available: true },
  { id: "local" as const, title: "Local Campaign", blurb: "Promote your local business with Google Business Profile, location targeting, and image ads.", features: ["Google Business Profile", "Auto-fetch business details", "Image ads", "Location targeting"], available: false },
];

function TypeChooser() {
  const setCampaignType = useStore((s) => s.setCampaignType);
  const [picked, setPicked] = useState<"search" | "local">("search");
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-center text-2xl font-bold tracking-tight">Choose Your Campaign Type</h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">Select the campaign type that best fits your advertising goals</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {TYPES.map((t) => (
          <button key={t.id} type="button" disabled={!t.available} onClick={() => t.available && setPicked(t.id)}
            className={cx("rounded-2xl border bg-card p-6 text-left transition-all", picked === t.id && t.available ? "border-primary ring-2 ring-ring/30" : "border-border", t.available ? "hover:border-primary/50" : "cursor-not-allowed opacity-60")}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{t.title}</h2>{!t.available && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Coming soon</span>}</div>
            <p className="mt-2 text-sm text-muted-foreground">{t.blurb}</p>
            <ul className="mt-4 space-y-1.5">{t.features.map((f) => <li key={f} className="flex items-center gap-2 text-sm text-foreground/80"><span className="text-accent">▸</span>{f}</li>)}</ul>
          </button>
        ))}
      </div>
      <div className="mt-8 flex justify-center"><Button variant="gradient" className="px-8 py-3" onClick={() => setCampaignType(picked)}>Continue →</Button></div>
    </div>
  );
}

function Wizard() {
  const currentStep = useStore((s) => s.currentStep);
  const setStep = useStore((s) => s.setStep);
  const restart = useStore((s) => s.restart);
  const saveAndRestart = useStore((s) => s.saveAndRestart);
  const historyCount = useStore((s) => s.campaignHistory.length);
  const loadFromHistory = useStore((s) => s.loadFromHistory);
  const conversation = useStore((s) => s.conversation);
  const selectedKeywords = useStore((s) => s.selectedKeywords);
  const campaign = useStore((s) => s.campaign);
  const { expertMode, toggleExpert, model, setModel } = useSettings();
  const Step = STEPS[currentStep] ?? CampaignSetupChat;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="border-b border-border">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-lg font-bold text-primary-foreground">⚡</span>
            <div className="leading-tight"><div className="text-sm font-bold">Campaign Builder</div><div className="text-[11px] text-muted-foreground">Google Ads</div></div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" className="px-3 py-1.5" disabled={!historyCount} onClick={() => loadFromHistory(0)}>History{historyCount ? ` (${historyCount})` : ""}</Button>
            <Button variant="ghost" className="px-3 py-1.5" onClick={saveAndRestart}>Save</Button>
            <Button variant="ghost" className="px-3 py-1.5" onClick={() => restart(true)}>Restart</Button>
            <div className="flex items-center overflow-hidden rounded-lg border border-border text-xs font-medium" title="Model used for AI copy generation">
              <button type="button" onClick={() => setModel("opus")} className={cx("px-2.5 py-1.5", model === "opus" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>Opus 4.8</button>
              <button type="button" onClick={() => setModel("sonnet")} className={cx("border-l border-border px-2.5 py-1.5", model === "sonnet" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>Sonnet 4.6</button>
            </div>
            <button type="button" onClick={toggleExpert} className={cx("rounded-lg border px-3 py-1.5 text-xs font-medium", expertMode ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>Expert {expertMode ? "on" : "off"}</button>
          </div>
        </div>
        <div className="border-t border-border/60 px-5 py-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {conversation.businessType && <span>Type: <b className="text-foreground">{conversation.businessType.replace(/-/g, " ")}</b></span>}
            {conversation.location && <span>Location: <b className="text-foreground">{conversation.location}</b></span>}
            {conversation.services.length > 0 && <span>Services: <b className="text-foreground">{conversation.services.slice(0, 3).join(", ")}{conversation.services.length > 3 ? ` +${conversation.services.length - 3}` : ""}</b></span>}
            {selectedKeywords.length > 0 && <span>Keywords: <b className="text-foreground">{selectedKeywords.length}</b></span>}
            {campaign && <span>Campaign: <b className="text-primary">{campaign.name}</b></span>}
          </div>
        </div>
        <div className="px-3"><Stepper current={currentStep} onStep={setStep} /></div>
      </header>
      <div className="px-5 pb-10">
        <Step />
      </div>
    </div>
  );
}

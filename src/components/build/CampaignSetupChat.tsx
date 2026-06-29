"use client";
import { useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { BUSINESS_TYPES } from "@/lib/adforge";
import { Button, Chip, inputClass, cx } from "@/components/ui";

function Bot({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">🤖</span>
      <div className="max-w-xl rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm">{children}</div>
    </div>
  );
}

export default function CampaignSetupChat() {
  const { conversation, setBusinessType, setIsOnline, setLocation, addService, removeService, generateKeywordList, setStep } =
    useStore();
  const [svc, setSvc] = useState("");

  const type = BUSINESS_TYPES.find((b) => b.id === conversation.businessType);
  const asksModel = !!type?.asksBusinessModel;
  // Local types reveal services after a location; online types reveal them immediately.
  const servicesGate = !!type && (conversation.isOnline || !asksModel || conversation.location.trim().length > 0);

  const submitService = () => {
    if (svc.trim()) {
      addService(svc);
      setSvc("");
    }
  };

  return (
    <div className="space-y-6 py-6">
      <Bot>
        Hi! I&apos;m your campaign builder assistant. 👋 Let&apos;s create a high-performance Google Ads campaign together.
        First, what type of business are you advertising?
      </Bot>

      <div className="grid gap-3 sm:grid-cols-3">
        {BUSINESS_TYPES.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBusinessType(b.id, b.asksBusinessModel)}
            className={cx(
              "rounded-xl border bg-card p-4 text-left transition-colors",
              conversation.businessType === b.id ? "border-primary ring-2 ring-ring/30" : "border-border hover:border-primary/50",
            )}
          >
            <div className="font-semibold">{b.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{b.blurb}</div>
          </button>
        ))}
      </div>

      {type && asksModel && (
        <>
          <Bot>Is this an online business or a local/physical business?</Bot>
          <div className="flex gap-3">
            <Chip selected={conversation.isOnline} onClick={() => setIsOnline(true)}>Online Business</Chip>
            <Chip selected={!conversation.isOnline} onClick={() => setIsOnline(false)}>Local / Physical Business</Chip>
          </div>
        </>
      )}

      {type && !conversation.isOnline && (
        <>
          <Bot>Where is your business located?</Bot>
          <input
            className={cx(inputClass, "max-w-md")}
            value={conversation.location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. London, Manchester…"
          />
        </>
      )}

      {servicesGate && (
        <>
          <Bot>
            {conversation.isOnline
              ? "Which products or services do you want to advertise?"
              : "What specific treatments or services do you want to promote? Add each one individually."}
          </Bot>
          {conversation.services.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {conversation.services.map((s) => (
                <Chip key={s} selected removable onClick={() => removeService(s)}>{s}</Chip>
              ))}
            </div>
          )}
          <div className="flex max-w-xl gap-2">
            <input
              className={inputClass}
              value={svc}
              onChange={(e) => setSvc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submitService())}
              placeholder={conversation.isOnline ? "e.g. Running shoes, Fitness equipment…" : "e.g. Botox, Lip Fillers…"}
            />
            <Button variant="secondary" onClick={submitService}>+</Button>
          </div>
        </>
      )}

      <div className="pt-2">
        <Button
          variant="gradient"
          className="px-6"
          disabled={conversation.services.length < 1}
          onClick={() => {
            generateKeywordList();
            setStep(1);
          }}
        >
          Generate Keywords →
        </Button>
      </div>
    </div>
  );
}

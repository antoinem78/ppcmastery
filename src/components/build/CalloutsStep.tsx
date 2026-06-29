"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { CALLOUT_SUGGESTIONS, CALLOUT_MAX } from "@/lib/adforge";
import { Button, Card, Chip, inputClass, cx } from "@/components/ui";

export default function CalloutsStep() {
  const { campaign, addCallout, removeCallout, setStep } = useStore();
  const [text, setText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  if (!campaign) return null;
  const callouts = campaign.callouts;
  const used = new Set(callouts.map((c) => c.text));

  return (
    <div className="py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Callout Extensions</h1>
          <p className="text-sm text-muted-foreground">Add short, non-clickable callouts to highlight key benefits.</p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{callouts.length} callouts</span>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        Max {CALLOUT_MAX} chars per callout · At least 2 recommended · Avoid excessive punctuation &amp; ALL CAPS · No duplicates
      </div>

      <div className="mt-4 flex max-w-xl gap-2">
        <input
          className={inputClass}
          value={text}
          maxLength={CALLOUT_MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (addCallout(text), setText("")))}
          placeholder="e.g. Free Consultation"
        />
        <Button onClick={() => (addCallout(text), setText(""))}>+ Add</Button>
        <Button variant="secondary" onClick={() => setShowSuggestions((v) => !v)}>💡 Suggestions</Button>
      </div>

      {showSuggestions && (
        <div className="mt-3 flex flex-wrap gap-2">
          {CALLOUT_SUGGESTIONS.map((c) => (
            <Chip key={c} selected={used.has(c)} onClick={() => !used.has(c) && addCallout(c)}>{c}</Chip>
          ))}
        </div>
      )}

      <div className="mt-5">
        {callouts.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed py-12 text-center">
            <span className="text-3xl text-muted-foreground">💬</span>
            <div className="text-sm font-medium">No callouts yet</div>
            <p className="text-xs text-muted-foreground">Add callout extensions to highlight key benefits in your ads.</p>
          </Card>
        ) : (
          <div className="flex flex-wrap gap-2">
            {callouts.map((c) => (
              <span key={c.id} className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", c.text.length > CALLOUT_MAX ? "border-destructive text-destructive" : "border-border")}>
                {c.text}
                <button type="button" onClick={() => removeCallout(c.id)} className="text-xs opacity-60 hover:opacity-100">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep(3)}>← Back</Button>
        <Button variant="gradient" onClick={() => setStep(5)}>Continue to Review →</Button>
      </div>
    </div>
  );
}

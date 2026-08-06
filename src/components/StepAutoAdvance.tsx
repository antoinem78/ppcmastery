"use client";
// Refreshes the onboarding wizard when the server-side step moves past the
// one on screen (e.g. the contract-signed webhook lands while the client is
// still looking at the signing iframe). Without this the client had to
// reload manually between signing and payment.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function StepAutoAdvance({
  clientId,
  shownStep,
  intervalMs = 4000,
}: {
  clientId: string;
  shownStep: string;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/onboarding/${clientId}/step`, { cache: "no-store" });
        if (!res.ok) return;
        const { step } = (await res.json()) as { step?: string };
        if (!stopped && step && step !== shownStep) router.refresh();
      } catch {
        /* transient network errors: just try again next tick */
      }
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [clientId, shownStep, intervalMs, router]);
  return null;
}

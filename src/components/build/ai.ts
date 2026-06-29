// Client helper for the AdForge AI copy generator. Reads the current campaign
// context straight off the Zustand stores (via getState, so it can live outside
// React) and POSTs to /api/builder/generate. The builder steps call these and
// drop the results into the store; on any failure the deterministic copy that
// is already on screen stays put.
import { useStore, useSettings } from "@/lib/store";
import type {
  AdGroupCtx,
  AdsResult,
  CalloutsResult,
  GenerateContext,
  GenerateRequest,
  SitelinksResult,
} from "@/lib/builder/contract";

function buildContext(): GenerateContext {
  const s = useStore.getState();
  const c = s.campaign;
  const uspCats = (c?.settings.selectedUSPs ?? s.selectedUSPs) ?? [];
  const usps = uspCats.flatMap((cat) => cat.options.map((o) => o.text));
  return {
    businessType: s.conversation.businessType || c?.businessType || "",
    location: s.conversation.location || "",
    isOnline: s.conversation.isOnline,
    services: s.conversation.services.length ? s.conversation.services : c?.specificServices ?? [],
    brandName: c?.settings.marketContext.brandName || "",
    usps,
    avoidTerms: s.onboardingData.avoidKeywords ?? [],
  };
}

async function post<T>(body: GenerateRequest): Promise<T> {
  const res = await fetch("/api/builder/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Generation failed.");
  return data as T;
}

export function currentModel() {
  return useSettings.getState().model;
}

export function generateAds(adGroup: AdGroupCtx): Promise<AdsResult> {
  return post<AdsResult>({ kind: "ads", model: currentModel(), context: buildContext(), adGroup });
}

export function generateSitelinks(): Promise<SitelinksResult> {
  return post<SitelinksResult>({ kind: "sitelinks", model: currentModel(), context: buildContext() });
}

export function generateCallouts(): Promise<CalloutsResult> {
  return post<CalloutsResult>({ kind: "callouts", model: currentModel(), context: buildContext() });
}

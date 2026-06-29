"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect, useState } from "react";
import {
  buildCampaign,
  generateKeywords as genKeywords,
  rid,
  USP_CATALOG,
} from "@/lib/adforge";
import type { Campaign, SelectedUspCategory, Sitelink, Callout } from "@/lib/adforge";

export type CampaignType = "local" | "search";

interface OnboardingData {
  priorityKeywords: string[];
  avoidKeywords: string[];
  answers: Record<string, unknown>;
}

interface Conversation {
  businessType: string;
  isOnline: boolean;
  location: string;
  services: string[];
}

interface HistoryEntry {
  name: string;
  savedAt: string;
  campaign: Campaign;
}

interface StoreState {
  campaignType: CampaignType | null;
  onboardingCompleted: boolean;
  onboardingData: OnboardingData;
  conversation: Conversation;
  keywordSource: "smart" | "planner";
  generatedKeywords: string[];
  selectedKeywords: string[];
  campaignName: string;
  maxCpc: number;
  selectedUSPs: SelectedUspCategory[];
  campaign: Campaign | null;
  currentStep: number; // 0..5
  campaignHistory: HistoryEntry[];

  // setup
  setCampaignType: (t: CampaignType) => void;
  completeOnboarding: (d: OnboardingData) => void;
  skipOnboarding: () => void;
  setBusinessType: (id: string, asksModel: boolean) => void;
  setIsOnline: (v: boolean) => void;
  setLocation: (v: string) => void;
  addService: (s: string) => void;
  removeService: (s: string) => void;

  // keywords
  generateKeywordList: () => void;
  setKeywordSource: (s: "smart" | "planner") => void;
  toggleKeyword: (k: string) => void;
  addCustomKeyword: (k: string) => void;
  setCampaignName: (n: string) => void;
  setMaxCpc: (n: number) => void;
  toggleUsp: (categoryId: string, text: string) => void;
  addCustomUsp: (categoryId: string, text: string) => void;

  // generate + steps
  canGenerate: () => boolean;
  generateCampaign: () => void;
  setStep: (n: number) => void;

  // ad editing
  updateHeadline: (adId: string, idx: number, text: string) => void;
  updateDescription: (adId: string, idx: number, text: string) => void;
  updateAdField: (adId: string, field: "finalUrl" | "path1" | "path2", value: string) => void;
  deleteAd: (adId: string) => void;

  // assets
  addSitelink: (s: Omit<Sitelink, "id">) => void;
  removeSitelink: (id: string) => void;
  addCallout: (text: string) => void;
  removeCallout: (id: string) => void;

  // lifecycle
  saveAndRestart: () => void;
  restart: (keepOnboarding: boolean) => void;
  loadFromHistory: (index: number) => void;
}

const freshConversation = (): Conversation => ({ businessType: "", isOnline: false, location: "", services: [] });

const initial = {
  campaignType: null as CampaignType | null,
  onboardingCompleted: false,
  onboardingData: { priorityKeywords: [], avoidKeywords: [], answers: {} } as OnboardingData,
  conversation: freshConversation(),
  keywordSource: "smart" as const,
  generatedKeywords: [] as string[],
  selectedKeywords: [] as string[],
  campaignName: "",
  maxCpc: 1,
  selectedUSPs: [] as SelectedUspCategory[],
  campaign: null as Campaign | null,
  currentStep: 0,
  campaignHistory: [] as HistoryEntry[],
};

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...initial,

      setCampaignType: (t) => set({ campaignType: t }),
      completeOnboarding: (d) => set({ onboardingData: d, onboardingCompleted: true }),
      skipOnboarding: () => set({ onboardingCompleted: true }),

      setBusinessType: (id, asksModel) =>
        set((s) => ({ conversation: { ...s.conversation, businessType: id, isOnline: asksModel ? s.conversation.isOnline : false } })),
      setIsOnline: (v) => set((s) => ({ conversation: { ...s.conversation, isOnline: v } })),
      setLocation: (v) => set((s) => ({ conversation: { ...s.conversation, location: v } })),
      addService: (svc) =>
        set((s) => {
          const t = svc.trim();
          if (!t || s.conversation.services.includes(t)) return {};
          return { conversation: { ...s.conversation, services: [...s.conversation.services, t] } };
        }),
      removeService: (svc) =>
        set((s) => ({ conversation: { ...s.conversation, services: s.conversation.services.filter((x) => x !== svc) } })),

      generateKeywordList: () => {
        const { conversation, onboardingData } = get();
        const list = genKeywords({
          services: conversation.services,
          location: conversation.location,
          isOnline: conversation.isOnline,
          priorityKeywords: onboardingData.priorityKeywords,
        });
        const suggested = conversation.services[0]
          ? `${conversation.services[0]} ${conversation.location || "Search"} - Search`
          : "";
        set((s) => ({ generatedKeywords: list, campaignName: s.campaignName || suggested }));
      },
      setKeywordSource: (s) => set({ keywordSource: s }),
      toggleKeyword: (k) =>
        set((s) => ({
          selectedKeywords: s.selectedKeywords.includes(k)
            ? s.selectedKeywords.filter((x) => x !== k)
            : [...s.selectedKeywords, k],
        })),
      addCustomKeyword: (k) =>
        set((s) => {
          const t = k.trim().toLowerCase();
          if (!t) return {};
          return {
            generatedKeywords: s.generatedKeywords.includes(t) ? s.generatedKeywords : [...s.generatedKeywords, t],
            selectedKeywords: s.selectedKeywords.includes(t) ? s.selectedKeywords : [...s.selectedKeywords, t],
          };
        }),
      setCampaignName: (n) => set({ campaignName: n }),
      setMaxCpc: (n) => set({ maxCpc: n }),
      toggleUsp: (categoryId, text) =>
        set((s) => {
          const cats = s.selectedUSPs.map((c) => ({ ...c, options: [...c.options] }));
          let cat = cats.find((c) => c.category === categoryId);
          if (!cat) {
            cat = { category: categoryId, options: [] };
            cats.push(cat);
          }
          const existing = cat.options.findIndex((o) => o.text === text);
          if (existing >= 0) cat.options.splice(existing, 1);
          else cat.options.push({ id: rid(), category: categoryId, text, isCustom: false });
          return { selectedUSPs: cats.filter((c) => c.options.length > 0) };
        }),
      addCustomUsp: (categoryId, text) =>
        set((s) => {
          const t = text.trim();
          if (!t) return {};
          const cats = s.selectedUSPs.map((c) => ({ ...c, options: [...c.options] }));
          let cat = cats.find((c) => c.category === categoryId);
          if (!cat) {
            cat = { category: categoryId, options: [] };
            cats.push(cat);
          }
          if (!cat.options.some((o) => o.text === t)) cat.options.push({ id: rid(), category: categoryId, text: t, isCustom: true });
          return { selectedUSPs: cats };
        }),

      canGenerate: () => {
        const s = get();
        const uspCount = s.selectedUSPs.reduce((n, c) => n + c.options.length, 0);
        return s.campaignName.trim().length > 0 && uspCount >= 1 && s.selectedKeywords.length >= 1;
      },
      generateCampaign: () => {
        const s = get();
        if (!s.canGenerate()) return;
        const campaign = buildCampaign({
          name: s.campaignName.trim(),
          businessType: s.conversation.businessType,
          isOnline: s.conversation.isOnline,
          location: s.conversation.location,
          services: s.conversation.services,
          selectedKeywords: s.selectedKeywords,
          selectedUSPs: s.selectedUSPs,
          avoidKeywords: s.onboardingData.avoidKeywords.join(", "),
          maxCpc: s.maxCpc,
        });
        set({ campaign, currentStep: 2 });
      },
      setStep: (n) => set({ currentStep: n }),

      updateHeadline: (adId, idx, text) =>
        set((s) => mutateCampaign(s, (c) => {
          const ad = c.ads.find((a) => a.id === adId);
          if (ad && ad.headlines[idx]) ad.headlines[idx] = { ...ad.headlines[idx], text };
        })),
      updateDescription: (adId, idx, text) =>
        set((s) => mutateCampaign(s, (c) => {
          const ad = c.ads.find((a) => a.id === adId);
          if (ad && ad.descriptions[idx]) ad.descriptions[idx] = { ...ad.descriptions[idx], text };
        })),
      updateAdField: (adId, field, value) =>
        set((s) => mutateCampaign(s, (c) => {
          const ad = c.ads.find((a) => a.id === adId);
          if (ad) ad[field] = value;
        })),
      deleteAd: (adId) =>
        set((s) => mutateCampaign(s, (c) => {
          c.ads = c.ads.filter((a) => a.id !== adId);
        })),

      addSitelink: (sl) =>
        set((s) => mutateCampaign(s, (c) => {
          c.sitelinks = [...c.sitelinks, { ...sl, id: rid() }];
        })),
      removeSitelink: (id) =>
        set((s) => mutateCampaign(s, (c) => {
          c.sitelinks = c.sitelinks.filter((x) => x.id !== id);
        })),
      addCallout: (text) =>
        set((s) => mutateCampaign(s, (c) => {
          const t = text.trim();
          if (t && !c.callouts.some((x) => x.text === t)) c.callouts = [...c.callouts, { id: rid(), text: t }];
        })),
      removeCallout: (id) =>
        set((s) => mutateCampaign(s, (c) => {
          c.callouts = c.callouts.filter((x) => x.id !== id);
        })),

      saveAndRestart: () =>
        set((s) => {
          const history = s.campaign
            ? [{ name: s.campaign.name, savedAt: new Date().toISOString(), campaign: s.campaign }, ...s.campaignHistory].slice(0, 5)
            : s.campaignHistory;
          return { ...initial, campaignHistory: history, onboardingData: s.onboardingData, onboardingCompleted: s.onboardingCompleted };
        }),
      restart: (keepOnboarding) =>
        set((s) =>
          keepOnboarding
            ? { ...initial, campaignHistory: s.campaignHistory, onboardingData: s.onboardingData, onboardingCompleted: s.onboardingCompleted }
            : { ...initial, campaignHistory: s.campaignHistory },
        ),
      loadFromHistory: (index) =>
        set((s) => {
          const entry = s.campaignHistory[index];
          if (!entry) return {};
          return { campaign: entry.campaign, campaignName: entry.campaign.name, campaignType: "search", currentStep: 5 };
        }),
    }),
    { name: "campaign-store", skipHydration: true },
  ),
);

// Helper: clone the campaign, mutate it, return the patch (keeps store immutable-ish).
function mutateCampaign(s: StoreState, fn: (c: Campaign) => void): Partial<StoreState> {
  if (!s.campaign) return {};
  const c: Campaign = structuredClone(s.campaign);
  fn(c);
  return { campaign: c };
}

const settingsKey = "settings-store";
interface SettingsState {
  expertMode: boolean;
  toggleExpert: () => void;
}
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({ expertMode: false, toggleExpert: () => set((s) => ({ expertMode: !s.expertMode })) }),
    { name: settingsKey, skipHydration: true },
  ),
);

// SSR-safe hydration: render a loader until persisted state is rehydrated.
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    useStore.persist.rehydrate();
    useSettings.persist.rehydrate();
    setHydrated(true);
  }, []);
  return hydrated;
}

export { USP_CATALOG };

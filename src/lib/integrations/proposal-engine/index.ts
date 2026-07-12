// Proposal-engine adapter (self-hosted PandaDoc replacement — the Cloudflare
// Worker in ./proposal-engine). Renders the shared agreement content
// (contracts/agreement-content.ts) as an engine proposal via the token-protected
// API, and maps engine statuses onto PandaDoc's vocabulary so the rest of the
// portal is unchanged.
//
// The "signing session" for this provider is simply the proposal URL: permanent
// and iframe-embeddable (unlike PandaDoc's ~1h session links).
import { entityConfig } from "@/lib/config";
import { buildAgreementContent } from "@/lib/integrations/contracts/agreement-content";
import type { ContractClient, ContractQuote } from "@/lib/integrations/contracts/agreement-content";

export type { ContractClient, ContractQuote };

function engineUrl(): string {
  const url = process.env.PROPOSAL_ENGINE_URL;
  if (!url) throw new Error("PROPOSAL_ENGINE_URL is not configured.");
  return url.replace(/\/$/, "");
}

function engineHeaders(): Record<string, string> {
  const token = process.env.PROPOSAL_ENGINE_API_TOKEN;
  if (!token) throw new Error("PROPOSAL_ENGINE_API_TOKEN is not configured.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function engine(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${engineUrl()}${path}`, { ...init, headers: engineHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Proposal engine ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

/** Create the agreement proposal on the engine. Returns the proposal id (stored
 *  in onboarding_state.pandadoc_document_id — that column holds whichever
 *  provider's document id the deployment uses). */
export async function createAgreementProposal(client: ContractClient, quote: ContractQuote): Promise<string> {
  const c = buildAgreementContent(client, quote);

  const data = {
    brand: { name: entityConfig.brandName || "PPC Mastery", accent: "#3C83F6" },
    proposal: { title: c.title, number: c.number, currency: entityConfig.currency },
    client: {
      name: client.contact_name ?? "",
      company: client.company_name,
      email: client.contact_email,
    },
    prepared_by: { name: c.providerName },
    intro: c.intro,
    pricing: {
      items: c.pricing.map((p) => ({ label: p.label, detail: p.detail, amount: p.amount, ...(p.period ? { period: p.period } : {}) })),
      notes: c.pricingNote,
    },
    terms: c.terms,
    accept: { enabled: true, button: "Accept agreement", note: c.acceptNote },
  };

  const res = await engine("/api/proposals", { method: "POST", body: JSON.stringify({ data }) });
  const { id } = (await res.json()) as { id: string };
  return id;
}

interface EngineProposal {
  id: string;
  url: string;
  status: string; // sent | viewed | accepted | declined | expired
}

export async function getProposal(idOrSlug: string): Promise<EngineProposal> {
  const res = await engine(`/api/proposals/${encodeURIComponent(idOrSlug)}`);
  return (await res.json()) as EngineProposal;
}

/** Map engine status onto PandaDoc vocabulary (the portal only branches on
 *  "document.completed" vs anything else, but keep the mapping faithful). */
export function toPandaDocStatus(engineStatus: string): string {
  switch (engineStatus) {
    case "accepted": return "document.completed";
    case "declined": return "document.declined";
    case "expired": return "document.expired";
    default: return "document.sent"; // sent | viewed — live and awaiting acceptance
  }
}

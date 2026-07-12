// Contract-provider facade — the ONLY module pages/actions import for the
// contract step. Switches between PandaDoc (default, unchanged) and the
// self-hosted proposal engine via CONTRACT_PROVIDER=proposal-engine.
//
// The provider's document id is stored in onboarding_state.pandadoc_document_id
// regardless of provider (the column holds whichever provider's id the
// deployment uses), so flipping CONTRACT_PROVIDER only affects NEW contracts.
// ⚠️ In-flight clients holding a PandaDoc id will break mid-flow if the flip
// happens under them — flip during a quiet window or regenerate their contracts.
import * as pandadoc from "@/lib/integrations/pandadoc";
import * as engine from "@/lib/integrations/proposal-engine";
import type { ContractClient, ContractQuote } from "@/lib/integrations/proposal-engine";

export type ContractProvider = "pandadoc" | "proposal-engine";

export function contractProvider(): ContractProvider {
  return process.env.CONTRACT_PROVIDER === "proposal-engine" ? "proposal-engine" : "pandadoc";
}

/** Create the contract document; returns the provider's document id. */
export async function createContractDocument(client: ContractClient, quote: ContractQuote): Promise<string> {
  if (contractProvider() === "proposal-engine") {
    return engine.createAgreementProposal(client, quote);
  }
  return pandadoc.createContractDocument(client, quote);
}

/** Retry path for a created-but-unsent document. Engine proposals are live the
 *  moment they exist, so this is a no-op there. */
export async function ensureDocumentSent(documentId: string): Promise<void> {
  if (contractProvider() === "proposal-engine") return;
  return pandadoc.ensureDocumentSent(documentId);
}

/** Provider-neutral status in PandaDoc vocabulary (the portal branches on
 *  "document.completed" / "document.draft"). */
export async function getDocumentStatus(documentId: string): Promise<string> {
  if (contractProvider() === "proposal-engine") {
    return engine.toPandaDocStatus((await engine.getProposal(documentId)).status);
  }
  return pandadoc.getDocumentStatus(documentId);
}

/** URL to embed in the contract step's iframe. PandaDoc: a ~1h signing session.
 *  Engine: the proposal URL itself (permanent, iframe-embeddable). */
export async function createSigningSession(documentId: string, recipientEmail: string): Promise<string> {
  if (contractProvider() === "proposal-engine") {
    return (await engine.getProposal(documentId)).url;
  }
  return pandadoc.createSigningSession(documentId, recipientEmail);
}

// Provider-independent (pure Supabase): flips the client to signed + payment
// step. Used by both providers' webhooks and the status-check fallback.
export { markContractSigned } from "@/lib/integrations/pandadoc";

// Contract-provider facade — the ONLY module pages/actions import for the
// contract step. CONTRACT_PROVIDER switches between:
//   (unset)           PandaDoc — the original provider, unchanged
//   proposal-engine   self-hosted click-wrap engine (Cloudflare Worker + D1)
//   documenso         self-hosted Documenso — sealed PDF signatures for
//                     higher-stakes contracts
//
// The provider's document id is stored in onboarding_state.pandadoc_document_id
// regardless of provider (the column holds whichever provider's id the
// deployment uses), so flipping CONTRACT_PROVIDER only affects NEW contracts.
// ⚠️ In-flight clients holding another provider's document id will break
// mid-flow if the flip happens under them — flip during a quiet window or
// regenerate their contracts.
import * as pandadoc from "@/lib/integrations/pandadoc";
import * as engine from "@/lib/integrations/proposal-engine";
import * as documenso from "@/lib/integrations/documenso";
import type { ContractClient, ContractQuote } from "@/lib/integrations/contracts/agreement-content";

export type ContractProvider = "pandadoc" | "proposal-engine" | "documenso";

export function contractProvider(): ContractProvider {
  const v = process.env.CONTRACT_PROVIDER;
  return v === "proposal-engine" || v === "documenso" ? v : "pandadoc";
}

/** Create the contract document; returns the provider's document id. */
export async function createContractDocument(client: ContractClient, quote: ContractQuote): Promise<string> {
  switch (contractProvider()) {
    case "proposal-engine": return engine.createAgreementProposal(client, quote);
    case "documenso": return documenso.createAgreementDocument(client, quote);
    default: return pandadoc.createContractDocument(client, quote);
  }
}

/** Retry path for a created-but-unsent document. The self-hosted providers'
 *  documents are live/sent the moment creation succeeds, so no-op there. */
export async function ensureDocumentSent(documentId: string): Promise<void> {
  if (contractProvider() !== "pandadoc") return;
  return pandadoc.ensureDocumentSent(documentId);
}

/** Provider-neutral status in PandaDoc vocabulary (the portal branches on
 *  "document.completed" / "document.draft"). */
export async function getDocumentStatus(documentId: string): Promise<string> {
  switch (contractProvider()) {
    case "proposal-engine": return engine.toPandaDocStatus((await engine.getProposal(documentId)).status);
    case "documenso": return documenso.toPandaDocStatus((await documenso.getDocument(documentId)).status);
    default: return pandadoc.getDocumentStatus(documentId);
  }
}

/** URL to embed in the contract step's iframe. PandaDoc: a ~1h signing session.
 *  Engine: the permanent proposal URL. Documenso: the recipient's permanent
 *  signing link (its page serves frame-ancestors *). */
export async function createSigningSession(documentId: string, recipientEmail: string): Promise<string> {
  switch (contractProvider()) {
    case "proposal-engine": return (await engine.getProposal(documentId)).url;
    case "documenso": return documenso.getSigningUrl(documentId, recipientEmail);
    default: return pandadoc.createSigningSession(documentId, recipientEmail);
  }
}

// Provider-independent (pure Supabase): flips the client to signed + payment
// step. Used by all providers' webhooks and the status-check fallback.
export { markContractSigned } from "@/lib/integrations/pandadoc";

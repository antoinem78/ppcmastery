// Signed-copy delivery, provider-aware. Called from EXACTLY ONE place:
// markContractSigned, the idempotent chokepoint that transitions
// contract_status to "signed" exactly once. Four paths can trigger that
// transition (both provider webhooks plus two contract-return status polls in
// the wizard) and which one wins is a race — wiring delivery into any single
// path means the client's copy depends on the race. Wiring it here means one
// copy, always. (Lesson from the app-wmi sibling's first real funnel walk,
// where a poll beat the webhook and the client got nothing.)
//
// What each provider delivers:
//   proposal-engine  a PERMANENT unguessable URL both parties can open forever
//                    (the accepted proposal shows its acceptance record inline)
//   documenso        the sealed PDF itself, attached (the cryptographically
//                    signed artifact IS the record)
//   pandadoc         the executed PDF, attached (PandaDoc has no link both
//                    parties can open; signing sessions are single-use)
//
// Best-effort by design: email failure must never roll back the signature.
import { contractProvider } from "@/lib/integrations/contracts";
import * as engine from "@/lib/integrations/proposal-engine";
import * as documenso from "@/lib/integrations/documenso";
import * as pandadoc from "@/lib/integrations/pandadoc";
import { sendContractCopyFor, sendSignedPdfCopyFor } from "@/lib/email";

export async function deliverSignedCopy(clientId: string, documentId: string): Promise<void> {
  try {
    switch (contractProvider()) {
      case "proposal-engine": {
        const url = await engine.internalDocumentUrl(documentId);
        await sendContractCopyFor(clientId, url);
        return;
      }
      case "documenso": {
        // The webhook fires on DOCUMENT_COMPLETED, so the sealed PDF should be
        // ready; a status-poll win can land moments earlier, so give sealing a
        // few seconds before giving up.
        let pdf: Buffer | null = null;
        for (let i = 0; i < 3; i++) {
          try {
            pdf = await documenso.downloadSealedPdf(documentId);
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (!pdf) {
          console.error("Documenso sealed PDF not ready after retries; no copy sent for", clientId);
          return;
        }
        await sendSignedPdfCopyFor(clientId, pdf);
        return;
      }
      default: {
        const pdf = await pandadoc.downloadDocumentPdf(documentId);
        await sendSignedPdfCopyFor(clientId, pdf);
        return;
      }
    }
  } catch (e) {
    console.error("Signed-copy delivery failed (signature unaffected):", e);
  }
}

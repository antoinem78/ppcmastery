// Documenso adapter — the third CONTRACT_PROVIDER (self-hosted, cryptographically
// sealed PDF signatures; a step up from the engine's click-wrap for higher-stakes
// contracts). Built against the instance's own OpenAPI (v1): create document ->
// PUT the rendered PDF to uploadUrl -> place the SIGNATURE field -> send.
//
// The "signing session" is the recipient's permanent signing link
// ({DOCUMENSO_URL}/sign/{token}); the signing page serves frame-ancestors *,
// so it embeds in the portal's existing contract iframe.
import { buildAgreementContent } from "@/lib/integrations/contracts/agreement-content";
import type { ContractClient, ContractQuote } from "@/lib/integrations/contracts/agreement-content";
import { renderAgreementPdf } from "./agreement-pdf";

function baseUrl(): string {
  const url = process.env.DOCUMENSO_URL;
  if (!url) throw new Error("DOCUMENSO_URL is not configured.");
  return url.replace(/\/$/, "");
}

function headers(): Record<string, string> {
  const token = process.env.DOCUMENSO_API_TOKEN;
  if (!token) throw new Error("DOCUMENSO_API_TOKEN is not configured.");
  // Documenso v1 API expects the raw token in Authorization (no Bearer prefix).
  return { Authorization: token, "Content-Type": "application/json" };
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${baseUrl()}/api/v1${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Documenso ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

interface CreateResponse {
  uploadUrl: string;
  documentId: number;
  recipients: Array<{ recipientId: number; email: string }>;
}

/** Create the agreement as a Documenso document: render PDF, upload, place the
 *  signature field, send (emails the signer via the instance's SMTP). Returns
 *  the document id as a string (stored in onboarding_state.pandadoc_document_id). */
export async function createAgreementDocument(client: ContractClient, quote: ContractQuote): Promise<string> {
  const content = buildAgreementContent(client, quote);
  const { pdfBytes, signature } = await renderAgreementPdf(content, client.company_name);

  const createRes = await api("/documents", {
    method: "POST",
    body: JSON.stringify({
      title: `${content.title} — ${client.company_name}`,
      externalId: client.id, // lets the webhook resolve the client directly
      recipients: [
        {
          name: client.contact_name ?? client.company_name,
          email: client.contact_email,
          role: "SIGNER",
        },
      ],
      meta: {
        subject: `Your ${content.providerName} agreement`,
        message: "Please review and sign your services agreement.",
      },
    }),
  });
  const created = (await createRes.json()) as CreateResponse;

  // Upload the rendered PDF to the returned URL (pre-authorized; plain PUT).
  const put = await fetch(created.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: Buffer.from(pdfBytes),
  });
  if (!put.ok) throw new Error(`Documenso PDF upload -> ${put.status}: ${(await put.text()).slice(0, 200)}`);

  // Place the signature field where the PDF drew its signature box.
  await api(`/documents/${created.documentId}/fields`, {
    method: "POST",
    body: JSON.stringify({
      recipientId: created.recipients[0].recipientId,
      type: "SIGNATURE",
      pageNumber: signature.pageNumber,
      pageX: signature.pageX,
      pageY: signature.pageY,
      pageWidth: signature.pageWidth,
      pageHeight: signature.pageHeight,
    }),
  });

  // Send: emails the signer AND activates the signing links.
  await api(`/documents/${created.documentId}/send`, {
    method: "POST",
    body: JSON.stringify({ sendEmail: true }),
  });

  return String(created.documentId);
}

interface DocumensoDocument {
  id: number;
  status: string; // DRAFT | PENDING | COMPLETED | REJECTED
  recipients: Array<{ id: number; email: string; token?: string; signingUrl?: string }>;
}

export async function getDocument(documentId: string): Promise<DocumensoDocument> {
  const res = await api(`/documents/${encodeURIComponent(documentId)}`);
  return (await res.json()) as DocumensoDocument;
}

/** Map Documenso status onto PandaDoc vocabulary. */
export function toPandaDocStatus(status: string): string {
  switch (status) {
    case "COMPLETED": return "document.completed";
    case "REJECTED": return "document.declined";
    default: return "document.sent"; // DRAFT | PENDING — awaiting signature
  }
}

/** The signer's permanent signing link (embeds in the contract iframe). */
export async function getSigningUrl(documentId: string, recipientEmail: string): Promise<string> {
  const doc = await getDocument(documentId);
  const recipient =
    doc.recipients.find((r) => r.email.toLowerCase() === recipientEmail.toLowerCase()) ?? doc.recipients[0];
  if (!recipient) throw new Error("Documenso document has no recipients.");
  if (recipient.signingUrl) return recipient.signingUrl;
  if (recipient.token) return `${baseUrl()}/sign/${recipient.token}`;
  throw new Error("Documenso recipient has no signing token.");
}

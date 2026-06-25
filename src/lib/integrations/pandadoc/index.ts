// PandaDoc integration seam — Phase 2 (contracts).
// The contract step generates a document from the template (filling tokens from
// the client record), embeds it for signing, and marks the contract signed via
// webhook or status-check fallback — same dual-path pattern as Stripe.
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { entityConfig, formatMoney } from "@/lib/config";

const API = "https://api.pandadoc.com/public/v1";

function headers(): Record<string, string> {
  const key = process.env.PANDADOC_API_KEY;
  if (!key || key.startsWith("PASTE_")) {
    throw new Error("PandaDoc is not configured (PANDADOC_API_KEY missing).");
  }
  return { Authorization: `API-Key ${key}`, "Content-Type": "application/json" };
}

function templateId(): string {
  const id = process.env.PANDADOC_TEMPLATE_ID;
  if (!id) throw new Error("PANDADOC_TEMPLATE_ID is not configured.");
  return id;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PandaDoc ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

export async function getDocumentStatus(documentId: string): Promise<string> {
  const res = await api(`/documents/${documentId}`);
  const doc = (await res.json()) as { status: string };
  return doc.status; // e.g. document.draft / document.sent / document.completed
}

/**
 * Upsert the PandaDoc contact so built-in recipient variables like
 * [Client.Company] resolve — they fill from the contact record, not from
 * document tokens. Non-fatal: a failure only leaves that variable blank.
 */
async function upsertContact(params: {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
}): Promise<void> {
  try {
    const create = await fetch(`${API}/contacts`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        company: params.company,
      }),
    });
    if (create.ok) return;
    // Likely already exists → find and update.
    const list = await api(`/contacts?email=${encodeURIComponent(params.email)}`);
    const { results } = (await list.json()) as { results: Array<{ id: string }> };
    if (results[0]) {
      await api(`/contacts/${results[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({ company: params.company }),
      });
    }
  } catch (e) {
    console.error("PandaDoc contact upsert failed (non-fatal):", e);
  }
}

/**
 * Create the contract document from the template, filled from the client
 * record, then send it (silently — no PandaDoc email; we embed instead).
 * Returns the document id.
 */
export async function createContractDocument(
  client: {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_email: string;
  },
  // What the client agreed to: band tier name or "Paid Search — custom plan",
  // plus the platforms wording (e.g. "Google Ads & Microsoft Ads").
  quote: { name: string; price: number; channels: string },
): Promise<string> {
  const [firstName, ...rest] = (client.contact_name ?? "Client").trim().split(/\s+/);
  const today = new Date().toISOString().slice(0, 10);

  // Built-in [Client.Company] resolves from the contact record — set it first.
  await upsertContact({
    email: client.contact_email,
    firstName,
    lastName: rest.join(" ") || "-",
    company: client.company_name,
  });

  const createRes = await api(`/documents`, {
    method: "POST",
    body: JSON.stringify({
      name: `Service Agreement — ${client.company_name}`,
      template_uuid: templateId(),
      recipients: [
        {
          email: client.contact_email,
          first_name: firstName,
          last_name: rest.join(" ") || "-",
          role: "Client",
        },
      ],
      tokens: [
        { name: "client.company_name", value: client.company_name },
        { name: "client.contact_name", value: client.contact_name ?? "" },
        { name: "client.contact_email", value: client.contact_email },
        { name: "quote.tier_name", value: quote.name },
        { name: "quote.monthly_price", value: formatMoney(quote.price) },
        // Fills [quote.channels] if/when added to the template; ignored otherwise.
        { name: "quote.channels", value: quote.channels },
        { name: "entity.legal_name", value: entityConfig.legalName },
        { name: "agreement.date", value: today },
      ],
      metadata: { client_id: client.id },
    }),
  });
  const { id: documentId } = (await createRes.json()) as { id: string };

  // The document starts as document.uploaded and becomes document.draft once
  // PandaDoc finishes processing — usually 2–5 seconds.
  let status = "";
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    status = await getDocumentStatus(documentId);
    if (status === "document.draft") break;
  }
  if (status !== "document.draft") {
    throw new Error(`PandaDoc document not ready after 15s (status: ${status}).`);
  }

  await api(`/documents/${documentId}/send`, {
    method: "POST",
    body: JSON.stringify({ silent: true, subject: "Your PPC Mastery agreement" }),
  });

  return documentId;
}

/** Ensure a created-but-unsent document gets sent (retry path). */
export async function ensureDocumentSent(documentId: string): Promise<void> {
  const status = await getDocumentStatus(documentId);
  if (status === "document.draft") {
    await api(`/documents/${documentId}/send`, {
      method: "POST",
      body: JSON.stringify({ silent: true, subject: "Your PPC Mastery agreement" }),
    });
  }
}

/** Create an embedded-signing session URL for the recipient (expires ~1h). */
export async function createSigningSession(
  documentId: string,
  recipientEmail: string,
): Promise<string> {
  const res = await api(`/documents/${documentId}/session`, {
    method: "POST",
    body: JSON.stringify({ recipient: recipientEmail, lifetime: 3600 }),
  });
  const { id } = (await res.json()) as { id: string };
  return `https://app.pandadoc.com/s/${id}`;
}

/**
 * Mark the client's contract signed and advance to payment. Idempotent —
 * called by both the webhook and the page's status-check fallback.
 */
export async function markContractSigned(
  clientId: string,
  source: string, // "pandadoc-webhook" | "contract-return"
): Promise<{ alreadyDone: boolean }> {
  const supabase = createSupabaseAdminClient();
  const { data: state } = await supabase
    .from("onboarding_state")
    .select("contract_status")
    .eq("client_id", clientId)
    .single();
  // Shared PandaDoc account across two portals: this endpoint receives the other
  // deployment's document events too. Unknown client = not ours → no-op (don't
  // throw, or PandaDoc retries the foreign event).
  if (!state) return { alreadyDone: true };
  if (state.contract_status === "signed") return { alreadyDone: true };

  const { error } = await supabase
    .from("onboarding_state")
    .update({ contract_status: "signed", current_step: "payment" })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  await logActivity({
    clientId,
    eventType: "contract_signed",
    actor: `system:${source}`,
  });
  return { alreadyDone: false };
}

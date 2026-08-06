// Chat attachments — turns an uploaded file into something a Claude message can
// carry. Three routes, chosen by extension:
//   .pdf            -> base64, sent as a document block. Claude reads the real
//                      PDF (layout, tables, images), which beats any text we
//                      could extract ourselves.
//   .docx           -> text extracted here from the OOXML, sent as a plain-text
//                      document block. Word is a zip; jszip is already a dep.
//   .md .txt .csv   -> decoded as text.
//
// Legacy .doc is refused rather than half-parsed: it is a binary OLE format,
// nothing in the tree reads it, and a silent empty extraction would look like
// Bernard ignoring the file.
import JSZip from "jszip";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "@/lib/attachment-limits";

export { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, ACCEPT_ATTR } from "@/lib/attachment-limits";

export type Attachment =
  | { name: string; kind: "text"; text: string }
  | { name: string; kind: "pdf"; base64: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/** Pull readable text out of a .docx. Paragraph and row boundaries become
 *  newlines and tabs become tabs, so tables in an audit stay legible rather
 *  than collapsing into one run-on line. */
export async function extractDocxText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("not a Word document (no word/document.xml)");
  const xml = await doc.async("string");

  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/gi, (m) =>
      XML_ENTITIES[m.toLowerCase()] ??
      (m.startsWith("&#") ? String.fromCodePoint(Number(m.slice(2, -1))) : m),
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

export class AttachmentError extends Error {}

/** Convert one uploaded file. Throws AttachmentError with a message written for
 *  the founder, not for a log. */
export async function toAttachment(file: File): Promise<Attachment> {
  const name = file.name || "attachment";
  const ext = extensionOf(name);

  if (file.size > MAX_FILE_BYTES) {
    throw new AttachmentError(
      `${name} is ${(file.size / 1_000_000).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1_000_000}MB per file.`,
    );
  }
  if (file.size === 0) throw new AttachmentError(`${name} is empty.`);

  const buf = await file.arrayBuffer();

  if (ext === ".pdf") {
    return { name, kind: "pdf", base64: toBase64(buf) };
  }

  if (ext === ".docx") {
    let text: string;
    try {
      text = await extractDocxText(buf);
    } catch {
      throw new AttachmentError(`${name} could not be read as a Word document.`);
    }
    if (!text) throw new AttachmentError(`${name} appears to contain no text.`);
    return { name, kind: "text", text };
  }

  if (ext === ".md" || ext === ".markdown" || ext === ".txt" || ext === ".csv") {
    const text = new TextDecoder("utf-8").decode(buf).trim();
    if (!text) throw new AttachmentError(`${name} appears to be empty.`);
    return { name, kind: "text", text };
  }

  if (ext === ".doc") {
    throw new AttachmentError(
      `${name} is the legacy .doc format, which cannot be read. Save it as .docx or PDF and try again.`,
    );
  }

  throw new AttachmentError(
    `${name} is not a supported type. Attach PDF, Word (.docx), Markdown, text or CSV.`,
  );
}

/** Read every file field out of a multipart form, enforcing the count and the
 *  combined-size ceiling. */
export async function attachmentsFromFormData(form: FormData): Promise<Attachment[]> {
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (!files.length) return [];
  if (files.length > MAX_FILES) {
    throw new AttachmentError(`Too many files at once. The limit is ${MAX_FILES}.`);
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new AttachmentError(
      `Those files total ${(total / 1_000_000).toFixed(1)}MB. The combined limit is ${MAX_TOTAL_BYTES / 1_000_000}MB.`,
    );
  }
  return Promise.all(files.map(toAttachment));
}

/** What goes into the stored transcript in place of the file itself, so a
 *  reloaded conversation shows what was attached. Extracted text is kept inline
 *  so Bernard still has it on later turns; a PDF cannot be, because we only ever
 *  held the bytes (see the note in bernard-agent). */
export function transcriptNote(a: Attachment): string {
  return a.kind === "pdf"
    ? `[attached PDF: ${a.name}]`
    : `[attached ${a.name}]\n\n${a.text}`;
}

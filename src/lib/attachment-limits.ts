// Attachment limits and the accept list. Split out from attachments.ts so the
// chat component can import them without dragging jszip and Buffer (both
// server-only concerns) into the client bundle.

/** Per-file ceiling. Vercel caps a serverless request body around 4.5MB, and the
 *  whole multipart payload (files + history) has to fit inside that. */
export const MAX_FILE_BYTES = 3_500_000;
/** Total across all files in one turn, leaving room for the message history. */
export const MAX_TOTAL_BYTES = 4_000_000;
export const MAX_FILES = 5;

export const ACCEPT_ATTR = ".pdf,.docx,.md,.markdown,.txt,.csv";

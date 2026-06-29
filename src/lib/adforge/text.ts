import { rid } from "./id";
import { HEADLINE_MAX } from "./constants";
import type { Headline, Description } from "./types";

// Z0(e,t=30): truncate to t chars at a word boundary if the last space is past
// the halfway mark, else hard cut. Applied to EVERY generated headline.
// NOTE: this intentionally can break a long DKI tag (closing brace lost) — keep it.
export function truncate(text: string, max = HEADLINE_MAX): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
}

export const HL = (s: string): Headline => ({ id: rid(), text: truncate(s.trim()) }); // Ha()
export const EMPTY_HL = (): Headline => ({ id: rid(), text: "" }); // cP()

// Nu(): an RSA is created with 4 EMPTY descriptions (never auto-filled).
export const emptyDescriptions = (): Description[] =>
  Array.from({ length: 4 }, () => ({ id: rid(), text: "" }));

export const titleCase = (s: string): string =>
  s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

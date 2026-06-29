// AD GROUP + CROSS-NEGATIVE GENERATION (verbatim port of generateAdGroupsFromKeywords).
// Per selected keyword: exact SKAG `[kw]` + phrase SKAG `"kw"`; plus one STAG.
// Negatives: exact SKAG = avoid; phrase SKAG = its own exact (origin "skag") + avoid; STAG = avoid.
import { rid } from "./id";
import type { AdGroup, Keyword, NegativeKeyword } from "./types";

export function generateAdGroups(
  selectedKeywords: string[],
  maxCpc: number,
  avoidKeywordsRaw = "",
): AdGroup[] {
  const avoid: NegativeKeyword[] = (avoidKeywordsRaw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ id: rid(), text: t, matchType: "exact", origin: "onboarding" }));

  const groups: AdGroup[] = [];
  selectedKeywords.forEach((kw) => {
    groups.push({
      id: rid(),
      name: `[${kw}]`,
      type: "skag-exact",
      keywords: [{ id: rid(), text: kw, matchType: "exact" }],
      negativeKeywords: avoid.map((a) => ({ ...a, id: rid() })),
      maxCpc,
    });
    groups.push({
      id: rid(),
      name: `"${kw}"`,
      type: "skag-phrase",
      keywords: [{ id: rid(), text: kw, matchType: "phrase" }],
      negativeKeywords: [
        { id: rid(), text: kw, matchType: "exact", origin: "skag" },
        ...avoid.map((a) => ({ ...a, id: rid() })),
      ],
      maxCpc,
    });
  });

  const stagKeywords: Keyword[] = [];
  selectedKeywords.forEach((kw) => {
    stagKeywords.push({ id: rid(), text: kw, matchType: "exact" });
    stagKeywords.push({ id: rid(), text: kw, matchType: "phrase" });
  });
  groups.push({
    id: rid(),
    name: "STAG - All Keywords",
    type: "stag",
    keywords: stagKeywords,
    negativeKeywords: avoid.map((a) => ({ ...a, id: rid() })),
    maxCpc,
  });

  return groups;
}

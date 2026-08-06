import { describe, it, expect } from "vitest";
import { makeEmDashScrubber } from "@/lib/emdash";

// Feed text through the scrubber in the given chunking and join the output —
// the whole point of the stateful design is that chunk boundaries must not
// change the result.
function run(chunks: string[]): string {
  const scrub = makeEmDashScrubber();
  return chunks.map(scrub).join("");
}

describe("makeEmDashScrubber", () => {
  it("replaces a spaced em dash with a comma", () => {
    expect(run(["CPA fell — the negatives landed"])).toBe("CPA fell, the negatives landed");
  });

  it("replaces a tight em dash with a comma", () => {
    expect(run(["CPA fell—the negatives landed"])).toBe("CPA fell, the negatives landed");
  });

  it("turns a line-leading em dash into a list marker", () => {
    expect(run(["Results:\n— CPA down\n— CTR up"])).toBe("Results:\n- CPA down\n- CTR up");
  });

  it("collapses a dash whose surrounding spaces arrive in different chunks", () => {
    expect(run(["CPA fell ", "— ", "the negatives landed"])).toBe("CPA fell, the negatives landed");
    expect(run(["CPA fell ", "—", " the negatives landed"])).toBe("CPA fell, the negatives landed");
    expect(run(["CPA fell", " ", "—", " ", "the negatives landed"])).toBe("CPA fell, the negatives landed");
  });

  it("handles a chunk that ends exactly on the dash", () => {
    expect(run(["CPA fell —", "  the negatives landed"])).toBe("CPA fell, the negatives landed");
  });

  it("leaves en dashes in numeric ranges alone", () => {
    expect(run(["ages 45–54 performed best"])).toBe("ages 45–54 performed best");
  });

  it("passes clean text through unchanged, including held trailing spaces", () => {
    expect(run(["no dashes ", "here at all"])).toBe("no dashes here at all");
  });

  it("handles multiple dashes in one chunk", () => {
    expect(run(["a — b — c"])).toBe("a, b, c");
  });
});

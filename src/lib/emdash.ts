// Deterministic enforcement of the founder's no-em-dash ruling on agent chat
// output. The persona prompts carry the rule; this makes it a guarantee. The
// scrubber is stateful because the text arrives as stream chunks and an
// em dash's surrounding spaces can land in a different chunk than the dash.
//
// Rules applied:
// - An em dash at the start of a line reads as a list or dialogue marker and
//   becomes "- ".
// - An em dash anywhere else (spaced or tight) becomes ", ", with the spaces
//   around it collapsed.
// - En dashes are left alone: they are allowed inside numeric ranges and
//   rewriting them would corrupt "45-54" style spans.
export function makeEmDashScrubber(): (chunk: string) => string {
  let held = ""; // trailing spaces held back so " — " split across chunks still collapses
  let atLineStart = true;
  let swallowLeading = false; // a chunk ended on a dash; eat the next chunk's leading spaces

  return (chunk: string): string => {
    let t = held + chunk;
    held = "";
    if (swallowLeading) {
      const stripped = t.replace(/^[ \t]+/, "");
      if (stripped !== t) t = stripped;
      if (t.length > 0) swallowLeading = false;
      if (!t) return "";
    }
    const trailing = t.match(/[ \t]+$/);
    if (trailing) {
      if (trailing[0] === t) {
        held = t; // chunk is all spaces; decide once we see what follows
        return "";
      }
      held = trailing[0];
      t = t.slice(0, -trailing[0].length);
    }

    let out = "";
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === "—") {
        while (i + 1 < t.length && (t[i + 1] === " " || t[i + 1] === "\t")) i++;
        if (atLineStart) {
          out += "- ";
        } else {
          out = out.replace(/[ \t]+$/, "");
          out += ", ";
        }
        atLineStart = false;
        if (i === t.length - 1) swallowLeading = true;
      } else {
        out += ch;
        atLineStart = ch === "\n";
      }
    }
    return out;
  };
}

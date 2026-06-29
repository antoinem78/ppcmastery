// USP STRENGTH (verbatim port of Ua).
import type { SelectedUspCategory, UspStrength } from "./types";

export function uspStrength(selectedUSPs: SelectedUspCategory[]): UspStrength {
  const total = selectedUSPs.reduce((s, c) => s + (c.options ? c.options.length : 0), 0);
  const cats = selectedUSPs.filter((c) => c.options && c.options.length > 0).length;
  if (total >= 4 && cats >= 2) return "strong";
  if (total >= 2 && cats >= 1) return "average";
  return "weak";
}

// KEYWORD GENERATION (verbatim port of $R / zR / generateKeywords / UR).
// Final list = [ ...priorityKeywords , ...expansion ], de-duped, order kept.

// $R(services, location) — 8 patterns per service (local / has-location).
export function expandService(services: string[], location?: string): string[] {
  const loc = (location || "").toLowerCase();
  const out: string[] = [];
  services.forEach((svc) => {
    const o = svc.toLowerCase();
    out.push(
      o,
      `${o} near me`,
      `${o} ${loc}`,
      `best ${o}`,
      `${o} cost`,
      `${o} prices`,
      `affordable ${o}`,
      `${o} clinic ${loc}`,
    );
  });
  return [...new Set(out)];
}

// zR(products) — 10 patterns per product (online / shops).
export function expandRetail(products: string[]): string[] {
  const out: string[] = [];
  products.forEach((p) => {
    const r = p.toLowerCase();
    out.push(
      r,
      `buy ${r}`,
      `${r} online`,
      `best ${r}`,
      `${r} shop`,
      `${r} store`,
      `cheap ${r}`,
      `${r} price`,
      `${r} deals`,
      `order ${r}`,
    );
  });
  return [...new Set(out)];
}

export function generateKeywords(input: {
  services: string[];
  location?: string;
  isOnline?: boolean;
  priorityKeywords?: string[];
}): string[] {
  const { services, location, isOnline, priorityKeywords = [] } = input;
  const expansion = isOnline ? expandRetail(services) : expandService(services, location);
  return [...new Set([...priorityKeywords, ...expansion])];
}

// UR(services, location||"Search") — campaign-name suggestions (max 3).
export function campaignNameSuggestions(services: string[], location?: string): string[] {
  const n = services[0] || "Service";
  const r = location || "Search";
  return [`${n} ${r} - Search`, `${r} ${n} Campaign`, `${services.join(" & ")} - ${r}`].slice(0, 3);
}

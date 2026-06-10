// Brand wordmark, driven by entityConfig so each deployment shows its own brand.
// Renders BRAND_LOGO_URL when set; otherwise a two-tone text wordmark (first
// word bold, rest light — matches the original "PPC mastery" treatment).
// Server component — safe to read server-only config.
import { entityConfig } from "@/lib/config";

export function Wordmark({ variant = "dark" }: { variant?: "dark" | "light" }) {
  if (entityConfig.brandLogoUrl) {
    // Plain <img>: external logo hosts would otherwise need next/image domain config.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={entityConfig.brandLogoUrl}
        alt={entityConfig.brandName}
        className="h-7 w-auto"
      />
    );
  }

  const [first, ...rest] = entityConfig.brandName.split(" ");
  const firstClass =
    variant === "light" ? "font-semibold" : "font-semibold text-[#0B1F3A]";
  const restClass =
    variant === "light" ? "font-light text-white/80" : "font-light text-zinc-500";

  return (
    <span className="tracking-tight">
      <span className={firstClass}>{first}</span>
      {rest.length > 0 && <span className={restClass}> {rest.join(" ")}</span>}
    </span>
  );
}

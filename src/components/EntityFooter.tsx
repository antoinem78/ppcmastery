// Entity/legal footer: the operator line ("PPC Mastery AI — operated by …")
// plus Privacy/Terms links. Rendered on every authenticated screen, /share and
// the logged-out landing — only when the deployment configures the env vars
// (ENTITY_FOOTER_LINE, LEGAL_PRIVACY_URL, LEGAL_TERMS_URL), so older
// deployments are unaffected until configured.
import { entityConfig } from "@/lib/config";

export function EntityFooter({ variant = "light" }: { variant?: "light" | "dark" }) {
  const { entityFooterLine, privacyUrl, termsUrl } = entityConfig;
  if (!entityFooterLine && !privacyUrl && !termsUrl) return null;
  const text = variant === "light" ? "text-white/40" : "text-zinc-400";
  const link = variant === "light" ? "text-white/60 hover:text-white" : "text-zinc-500 hover:text-zinc-800";
  return (
    <div className={`space-y-1 text-[11px] leading-snug ${text} print:hidden`}>
      {entityFooterLine && <p>{entityFooterLine}</p>}
      {(privacyUrl || termsUrl) && (
        <p className="space-x-3">
          {privacyUrl && (
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className={`underline-offset-2 hover:underline ${link}`}>
              Privacy
            </a>
          )}
          {termsUrl && (
            <a href={termsUrl} target="_blank" rel="noopener noreferrer" className={`underline-offset-2 hover:underline ${link}`}>
              Terms
            </a>
          )}
        </p>
      )}
    </div>
  );
}

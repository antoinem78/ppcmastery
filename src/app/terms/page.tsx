// Public terms of service. Companion to /privacy (linked from the entity/legal
// footer and the login landing). Entity details come from config so each
// deployment shows its own legal name. ⚠️ Placeholder wording — have it
// reviewed by a lawyer before relying on it; it describes accurately how the
// portal and the managed service operate today, and it defers to each client's
// signed service agreement as the governing document.
import { entityConfig } from "@/lib/config";
import { Wordmark } from "@/components/Wordmark";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const entity = entityConfig.legalName || entityConfig.brandName;
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-4 text-lg">
          <Wordmark variant="dark" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-zinc-900">Terms of Service</h1>

        <div className="mt-6 space-y-6 text-sm leading-6 text-zinc-600">
          <section>
            <h2 className="font-semibold text-zinc-900">Who we are</h2>
            <p>
              This portal is operated by {entity} (&ldquo;we&rdquo;). It supports
              the onboarding, reporting, and management of clients of our managed
              advertising service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Your agreement governs</h2>
            <p>
              The managed advertising service itself is provided under the written
              service agreement each client signs with us. If anything on this
              page conflicts with your signed agreement, the signed agreement
              prevails. These terms cover use of the portal itself.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Acceptable use</h2>
            <p>
              Access to the portal is provided to our clients and team. You agree
              to use it only for its intended purpose, to keep your access
              credentials and any links we share with you confidential, and not to
              attempt to access data belonging to another client or to probe,
              disrupt, or reverse-engineer the service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Advertising accounts &amp; data</h2>
            <p>
              Where we manage advertising accounts on your behalf, access is
              granted under your signed service agreement through the advertising
              platform&rsquo;s own account-linking process, and changes to your
              accounts are made in line with that agreement. Reporting figures
              shown in the portal are drawn from the advertising platforms&rsquo;
              reporting interfaces; while we work to present them accurately, the
              platform&rsquo;s own interface remains the system of record.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Availability &amp; changes</h2>
            <p>
              The portal is provided on an &ldquo;as available&rdquo; basis: we may
              update, change, or temporarily suspend it (for example, for
              maintenance) without notice. We may update these terms from time to
              time; continued use of the portal after an update constitutes
              acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Liability</h2>
            <p>
              To the maximum extent permitted by law, and except as set out in
              your signed service agreement, we accept no liability for indirect
              or consequential loss arising from use of the portal itself. Nothing
              in these terms limits liability that cannot lawfully be limited.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Privacy &amp; contact</h2>
            <p>
              Personal data is handled as described in our{" "}
              <a href="/privacy" className="text-[#3C83F6] underline-offset-2 hover:underline">
                Privacy Policy
              </a>
              . Questions about these terms can be sent to your account
              representative or emailed to us.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

// Public privacy policy. Required by the Google OAuth consent screen (and good
// practice anyway). Entity details come from config so each deployment shows its
// own legal name. ⚠️ Placeholder wording — have it reviewed before relying on it
// legally; it describes accurately what the portal does today.
import { entityConfig } from "@/lib/config";
import { Wordmark } from "@/components/Wordmark";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const entity = entityConfig.legalName || entityConfig.brandName;
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-4 text-lg">
          <Wordmark variant="dark" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-zinc-900">Privacy Policy</h1>

        <div className="mt-6 space-y-6 text-sm leading-6 text-zinc-600">
          <section>
            <h2 className="font-semibold text-zinc-900">Who we are</h2>
            <p>
              This portal is operated by {entity} (&ldquo;we&rdquo;). It is used to
              onboard and manage clients of our managed advertising service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">What we collect</h2>
            <p>
              Business contact details (name, company, email), the answers you
              provide in our onboarding questionnaire, contract and payment status,
              and — where you connect an advertising account — the account
              identifiers needed to manage advertising on your behalf.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">How we use it</h2>
            <p>
              Solely to deliver the service: preparing your agreement, collecting
              your subscription, setting up communication channels, and managing
              your advertising accounts. We do not sell personal data.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Advertising account access</h2>
            <p>
              Where we manage advertising accounts on your behalf, access is
              granted under your signed service agreement through the advertising
              platform&rsquo;s own account-linking process (for example, a Google
              Ads manager-account link that you approve inside Google Ads). You do
              not sign in to Google through this portal, and we never receive your
              Google password or account credentials. Advertising data is used
              solely to deliver the service and is never shared with third
              parties.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Storage &amp; processors</h2>
            <p>
              Data is stored in the European Union (Supabase, EU region). We use
              trusted processors for authentication (Auth0), payments (Stripe),
              contracts (PandaDoc), and communication (Slack), each only receiving
              the data needed for its function.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-zinc-900">Your rights &amp; contact</h2>
            <p>
              You may request access to, correction of, or deletion of your
              personal data at any time by contacting your account representative
              or emailing us. We retain client records only as long as needed for
              the service and our legal obligations.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

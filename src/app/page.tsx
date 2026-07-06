// Root route. Signed-in users go straight to the dashboard; everyone else sees
// a minimal login-only landing (sign in + the entity/legal footer). There is no
// signup — access is provisioned by the operator in Auth0.
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth/auth0";
import { entityConfig } from "@/lib/config";
import { Wordmark } from "@/components/Wordmark";
import { EntityFooter } from "@/components/EntityFooter";

export default async function Home() {
  const session = await auth0.getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg">
          <Wordmark variant="dark" />
        </div>
        {entityConfig.workspaceName && (
          <p className="mt-2 text-xs font-medium text-zinc-500">{entityConfig.workspaceName}</p>
        )}
        <p className="mt-4 text-sm text-zinc-500">
          Sign in to access the {entityConfig.brandName || "PPC Mastery"} portal.
        </p>
        {/* Must be <a>, not <Link>: the Auth0 login flow needs a full-page navigation. */}
        <a
          href="/auth/login"
          className="mt-6 inline-block rounded-md bg-[#0B1F3A] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
        >
          Sign in
        </a>
        <div className="mt-6 flex justify-center border-t border-zinc-100 pt-4 text-center">
          <EntityFooter variant="dark" />
        </div>
      </div>
    </div>
  );
}

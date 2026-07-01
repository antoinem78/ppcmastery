// Shell + security gate for the agency_admin area.
//
// Two checks run here, server-side, before anything renders:
//   1. Not logged in        -> redirect to the Auth0 login.
//   2. Logged in, no role    -> show a "no access" screen (with logout).
// Only a logged-in agency_admin sees the navy sidebar + the actual pages.
//
// The "(admin)" folder is a Next.js route group — it shares this layout WITHOUT
// adding "/admin" to the URL.
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth0 } from "@/lib/auth/auth0";
import { isAgencyAdmin } from "@/lib/auth/roles";
import { pendingProposalCount } from "@/lib/proposals";
import { Wordmark } from "@/components/Wordmark";
import { CommandChat } from "@/components/CommandChat";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/proposals", label: "Proposals" },
  { href: "/builder", label: "Campaign Builder" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();

  // 1. No session at all → send them to log in.
  if (!session) {
    redirect("/auth/login");
  }

  const user = session.user as Record<string, unknown>;
  const email = typeof user.email === "string" ? user.email : "";

  // 2. Logged in but not an agency admin → no access.
  if (!isAgencyAdmin(user)) {
    return <NoAccess email={email} />;
  }

  // Pending-proposal badge (0 when the table doesn't exist yet).
  const pendingProposals = await pendingProposalCount();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col bg-[#0B1F3A] text-white print:hidden">
        <div className="px-6 py-6 text-xl">
          <Wordmark variant="light" />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span>{item.label}</span>
              {item.href === "/proposals" && pendingProposals > 0 && (
                <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white">{pendingProposals}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-6 py-4">
          {email && (
            <div className="mb-2 truncate text-xs text-white/50" title={email}>
              {email}
            </div>
          )}
          {/* Must be <a>, not <Link>: logout needs a full-page navigation. */}
          <a
            href="/auth/logout"
            className="text-sm text-white/70 transition-colors hover:text-white"
          >
            Log out
          </a>
        </div>
      </aside>
      <main className="flex-1 bg-zinc-50">{children}</main>
      <CommandChat />
    </div>
  );
}

function NoAccess({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8">
      <div className="max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg">
          <Wordmark variant="dark" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">No access</h1>
        <p className="mt-2 text-sm text-zinc-500">
          You&rsquo;re signed in{email ? ` as ${email}` : ""}, but this account
          doesn&rsquo;t have agency admin access.
        </p>
        <a
          href="/auth/logout"
          className="mt-6 inline-block rounded-md bg-[#0B1F3A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0B1F3A]/90"
        >
          Log out
        </a>
      </div>
    </div>
  );
}

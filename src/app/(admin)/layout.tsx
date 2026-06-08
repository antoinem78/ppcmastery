// Shell for the agency_admin area: a clean navy sidebar with the PPC Mastery
// wordmark. Login protection gets added in the next chunk (Auth0); for now this
// is the visual frame only.
//
// The "(admin)" folder is a Next.js route group — it groups these pages under a
// shared layout WITHOUT adding "/admin" to the URL.

import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col bg-[#0B1F3A] text-white">
        <div className="px-6 py-6 text-xl tracking-tight">
          <span className="font-semibold">PPC</span>{" "}
          <span className="font-light text-white/80">mastery</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-6 py-4 text-xs text-white/40">Internal ops portal</div>
      </aside>
      <main className="flex-1 bg-zinc-50">{children}</main>
    </div>
  );
}

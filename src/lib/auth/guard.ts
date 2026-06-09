// Auth guards for server-side use (pages, layouts, Server Actions).
//
// IMPORTANT: Server Actions are reachable via direct POST, not just through the
// UI — so any admin action must call requireAgencyAdmin() itself rather than
// trusting that the layout already gated the page.
import { redirect } from "next/navigation";
import { auth0 } from "./auth0";
import { isAgencyAdmin } from "./roles";

export async function requireAgencyAdmin(): Promise<{
  user: Record<string, unknown>;
  email: string;
}> {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const user = session.user as Record<string, unknown>;
  if (!isAgencyAdmin(user)) {
    throw new Error("Forbidden: agency_admin role required.");
  }
  return { user, email: typeof user.email === "string" ? user.email : "" };
}

// Root route. For now, send people to the admin dashboard. Once Auth0 is wired,
// this is where we'll route by role (agency_admin → dashboard, client → their
// onboarding flow).

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}

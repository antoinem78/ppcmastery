// Server-side gate for the Campaign Builder (the page itself is a client
// component). Reviewer/demo deployments hide the Builder entirely — nav link
// removed in the admin layout, and the route 404s here so a typed URL gets
// nothing.
import { notFound } from "next/navigation";
import { entityConfig } from "@/lib/config";

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  if (entityConfig.reviewMode) notFound();
  return <>{children}</>;
}

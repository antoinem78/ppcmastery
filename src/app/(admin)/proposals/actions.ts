"use server";
import { revalidatePath } from "next/cache";
import { requireAgencyAdmin } from "@/lib/auth/guard";
import { decideProposal } from "@/lib/proposals";

// Server actions self-guard (reachable via direct POST, not just the UI).
export async function approveProposal(id: string) {
  const { email } = await requireAgencyAdmin();
  await decideProposal(id, "approved", `admin:${email}`);
  revalidatePath("/proposals");
}

export async function dismissProposal(id: string) {
  const { email } = await requireAgencyAdmin();
  await decideProposal(id, "dismissed", `admin:${email}`);
  revalidatePath("/proposals");
}

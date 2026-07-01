"use server";
import { revalidatePath } from "next/cache";
import { requireAgencyAdmin } from "@/lib/auth/guard";
import { decideProposal, deleteProposal, markProposalApplied } from "@/lib/proposals";
import { dryRunProposal, applyProposal, rollbackProposal, type ExecResult } from "@/lib/proposals-execute";

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

// Permanently delete a proposal (clears out old queries). Admin-only.
export async function deleteProposalAction(id: string) {
  const { email } = await requireAgencyAdmin();
  await deleteProposal(id, `admin:${email}`);
  revalidatePath("/proposals");
}

// Manually mark an approved (advisory) proposal as applied. Admin-only.
export async function markAppliedAction(id: string) {
  const { email } = await requireAgencyAdmin();
  await markProposalApplied(id, `admin:${email}`);
  revalidatePath("/proposals");
}

// P5-Lite execution (inert until the env guardrails are set). Each re-checks
// admin AND the worker re-checks the approval record + guardrails.
export async function dryRunProposalAction(id: string): Promise<ExecResult> {
  await requireAgencyAdmin();
  return dryRunProposal(id);
}

export async function applyProposalAction(id: string): Promise<ExecResult> {
  const { email } = await requireAgencyAdmin();
  const res = await applyProposal(id, `admin:${email}`);
  revalidatePath("/proposals");
  return res;
}

export async function rollbackProposalAction(id: string): Promise<ExecResult> {
  const { email } = await requireAgencyAdmin();
  const res = await rollbackProposal(id, `admin:${email}`);
  revalidatePath("/proposals");
  return res;
}

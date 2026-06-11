// Slack integration seam — Phase 3 (client channel + guest invite).
//
// Degrades gracefully: when SLACK_BOT_TOKEN is unset (or a call fails), the
// wizard still records the client's preferred email and moves on — the
// activity log tells the ops team to provision manually. Automation level
// depends on the workspace plan: channel creation + inviting EXISTING members
// works everywhere; inviting a brand-new external guest is restricted by
// Slack's API on most plans, so that case becomes an ops task.

const API = "https://slack.com/api";

export function isSlackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN;
}

async function slack<T extends { ok: boolean; error?: string }>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Slack is not configured (SLACK_BOT_TOKEN missing).");
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

/** company name → #client-acme-inc style channel name (Slack rules: ≤80, a-z0-9-_) */
export function channelNameFor(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return `client-${slug || "unnamed"}`;
}

/** Create the client channel (or reuse it if it already exists). Returns channel id. */
export async function createClientChannel(companyName: string): Promise<string> {
  const name = channelNameFor(companyName);
  try {
    const created = await slack<{ ok: boolean; channel: { id: string } }>(
      "conversations.create",
      { name },
    );
    return created.channel.id;
  } catch (e) {
    if (e instanceof Error && e.message.includes("name_taken")) {
      // Already exists — find it.
      const token = process.env.SLACK_BOT_TOKEN;
      const res = await fetch(
        `${API}/conversations.list?limit=1000&types=public_channel,private_channel`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = (await res.json()) as {
        ok: boolean;
        channels?: Array<{ id: string; name: string }>;
      };
      const found = data.channels?.find((c) => c.name === name);
      if (found) return found.id;
    }
    throw e;
  }
}

/**
 * Try to invite the email's user to the channel. Only works when that email
 * already belongs to a workspace member/guest; otherwise returns
 * "manual-invite-needed" so the ops team finishes it (guest invites for brand
 * new external users aren't available via API on most plans).
 */
export async function tryInviteByEmail(
  channelId: string,
  email: string,
): Promise<"invited" | "manual-invite-needed"> {
  try {
    // users.lookupByEmail only accepts the email as a query parameter.
    const token = process.env.SLACK_BOT_TOKEN;
    const res = await fetch(
      `${API}/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as {
      ok: boolean;
      user?: { id: string };
      error?: string;
    };
    if (!data.ok || !data.user) return "manual-invite-needed";

    await slack("conversations.invite", {
      channel: channelId,
      users: data.user.id,
    });
    return "invited";
  } catch {
    return "manual-invite-needed";
  }
}

/** Drop a note in the channel (e.g. flag a manual guest invite for the team). */
export async function postMessage(channelId: string, text: string): Promise<void> {
  await slack("chat.postMessage", { channel: channelId, text });
}

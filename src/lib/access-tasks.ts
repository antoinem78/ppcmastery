// Guided platform-access tasks (GA4 / GTM / Search Console) for the client
// home. v1 is instructions + a self-attest checkbox (Model A) — the client
// grants access to our team's emails inside each platform and ticks it done.
// Programmatic grants (GA4 Admin API / GTM API) are a parked Model-B idea;
// Search Console has no user-management API and stays manual forever.

export type AccessTaskKey = "ga4" | "gtm" | "gsc";

export interface AccessTaskDef {
  key: AccessTaskKey;
  label: string;
  short: string;
  steps: string[];
}

export const ACCESS_TASKS: Record<AccessTaskKey, AccessTaskDef> = {
  ga4: {
    key: "ga4",
    label: "Grant Google Analytics (GA4) access",
    short: "GA4",
    steps: [
      "In Google Analytics, click Admin (bottom-left).",
      'Under the Property column, open "Property Access Management".',
      "Click the + (top-right) → Add users.",
      'Add the email(s) below with the "Editor" role, then Add.',
    ],
  },
  gtm: {
    key: "gtm",
    label: "Grant Google Tag Manager access",
    short: "GTM",
    steps: [
      "In Google Tag Manager, open Admin.",
      'Under the Container column, click "User Management".',
      "Click the + (top-right) → Add users.",
      'Add the email(s) below with "Publish" permissions, then Invite.',
    ],
  },
  gsc: {
    key: "gsc",
    label: "Grant Google Search Console access",
    short: "Search Console",
    steps: [
      "In Search Console, open Settings (left sidebar).",
      'Click "Users and permissions".',
      'Click "Add user".',
      'Add the email(s) below as "Owner", then Add.',
    ],
  },
};

export const ACCESS_TASK_LIST = Object.values(ACCESS_TASKS);

export function isAccessTaskKey(k: string): k is AccessTaskKey {
  return k === "ga4" || k === "gtm" || k === "gsc";
}

/** Emails the client grants access to. Defaults to the Slack team emails. */
export function getGrantEmails(): string[] {
  const raw =
    process.env.ACCESS_GRANT_EMAILS || process.env.SLACK_TEAM_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

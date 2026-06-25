// Guided platform-access tasks for the client home. v1 is instructions + a
// self-attest checkbox (Model A) — the client grants access to our team (an
// email, or our Meta Business Manager ID) and ticks it done. Microsoft Ads is
// different: the client gives us THEIR account number and we link it manually
// (handled as its own input task, not here).

import { entityConfig } from "@/lib/config";

export type AccessTaskKey = "ga4" | "gtm" | "gsc" | "gmc" | "meta";

export interface AccessTaskDef {
  key: AccessTaskKey;
  label: string;
  short: string;
  steps: string[];
  /** What the client grants access to: our team emails, or our Meta BM ID. */
  grant: "emails" | "meta_business_id";
}

export const ACCESS_TASKS: Record<AccessTaskKey, AccessTaskDef> = {
  ga4: {
    key: "ga4",
    label: "Grant Google Analytics (GA4) access",
    short: "GA4",
    grant: "emails",
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
    grant: "emails",
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
    grant: "emails",
    steps: [
      "In Search Console, open Settings (left sidebar).",
      'Click "Users and permissions".',
      'Click "Add user".',
      'Add the email(s) below as "Owner", then Add.',
    ],
  },
  gmc: {
    key: "gmc",
    label: "Grant Google Merchant Center access",
    short: "Merchant Center",
    grant: "emails",
    steps: [
      "In Google Merchant Center, open Settings (gear) → People and access.",
      "Click Add person (+).",
      'Add the email(s) below with the "Admin" role, then save.',
    ],
  },
  meta: {
    key: "meta",
    label: "Grant Meta (Facebook) Business access",
    short: "Meta",
    grant: "meta_business_id",
    steps: [
      "In Meta Business Settings, go to Users → Partners.",
      'Click "Add" → "Give a partner access to your assets".',
      "Enter our Business Manager ID shown below.",
      "Assign your Ad Account (plus Page/Pixel if relevant) with full management access, then confirm.",
    ],
  },
};

export const ACCESS_TASK_LIST = Object.values(ACCESS_TASKS);

export function isAccessTaskKey(k: string): k is AccessTaskKey {
  return k === "ga4" || k === "gtm" || k === "gsc" || k === "gmc" || k === "meta";
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

/** Our Meta Business Manager ID, which the client adds as a Partner. */
export function getMetaBusinessId(): string {
  return (process.env.META_BUSINESS_ID || "").trim();
}

/**
 * What the client should be shown to grant a given task — the box label plus
 * the value(s) to enter. Emails for the Google grants; our Business Manager ID
 * for Meta.
 */
export function accessGrantTargets(key: AccessTaskKey): {
  label: string;
  values: string[];
  emptyHint: string;
} {
  if (ACCESS_TASKS[key].grant === "meta_business_id") {
    const id = getMetaBusinessId();
    return {
      label: "Add our Business Manager ID as a Partner:",
      values: id ? [id] : [],
      emptyHint: `(ask your ${entityConfig.brandName} contact for our Business Manager ID)`,
    };
  }
  return {
    label: "Grant access to:",
    values: getGrantEmails(),
    emptyHint: `(ask your ${entityConfig.brandName} contact for the email)`,
  };
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { customerIdInSet } from "../index";
import { accountAllowed, allowAllMccAccounts, guardAction } from "../write";
import type { ProposalAction } from "@/lib/proposals";

// These cover the two scopes independently: MCC membership (customerIdInSet, the
// pure decision behind isCustomerUnderMcc) and the synchronous guard (kill
// switch + account/campaign allowlist + budget caps). The async MCC boundary and
// the allowlist are deliberately SEPARATE gates — the tests assert the allowlist
// still rejects a non-listed account even when MCC membership would pass.

const ENV_KEYS = [
  "GOOGLE_ADS_WRITE_ENABLED",
  "GOOGLE_ADS_WRITE_CUSTOMERS",
  "GOOGLE_ADS_WRITE_CAMPAIGNS",
  "ALLOW_ALL_MCC_ACCOUNTS",
  "GOOGLE_ADS_BUDGET_MAX_DAILY",
  "GOOGLE_ADS_BUDGET_MAX_INCREASE_PCT",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const NEG: ProposalAction = { kind: "add_negative_keyword", campaign: "Brand", text: "free", matchType: "BROAD" };
const PAUSE: ProposalAction = { kind: "pause_campaign", campaign: "Brand" };
const BUDGET: ProposalAction = { kind: "set_campaign_budget", campaign: "Brand", dailyBudget: 20 };

describe("MCC membership (customerIdInSet)", () => {
  const set = new Set(["1112223333", "4445556666"]);

  it("rejects an account id not in the hierarchy", () => {
    expect(customerIdInSet(set, "9998887777")).toBe(false);
  });
  it("accepts an account in the hierarchy", () => {
    expect(customerIdInSet(set, "1112223333")).toBe(true);
  });
  it("normalizes formatting (dashes) before comparing", () => {
    expect(customerIdInSet(set, "111-222-3333")).toBe(true);
  });
  it("rejects empty / junk", () => {
    expect(customerIdInSet(set, "")).toBe(false);
    expect(customerIdInSet(set, "abc")).toBe(false);
  });
});

describe("account allowlist (rollout control)", () => {
  it("rejects a non-listed account", () => {
    process.env.GOOGLE_ADS_WRITE_CUSTOMERS = "1112223333";
    expect(accountAllowed("9998887777")).toBe(false);
  });
  it("accepts a listed account", () => {
    process.env.GOOGLE_ADS_WRITE_CUSTOMERS = "1112223333, 4445556666";
    expect(accountAllowed("4445556666")).toBe(true);
  });
  it("ALLOW_ALL_MCC_ACCOUNTS lifts the allowlist", () => {
    process.env.ALLOW_ALL_MCC_ACCOUNTS = "true";
    expect(allowAllMccAccounts()).toBe(true);
    expect(accountAllowed("9998887777")).toBe(true); // any account, allowlist empty
  });
});

describe("guardAction", () => {
  it("blocks when the kill switch is off", () => {
    process.env.GOOGLE_ADS_WRITE_CUSTOMERS = "1112223333";
    expect(guardAction(NEG, { customerId: "1112223333" })).toMatch(/disabled/i);
  });

  it("rejects a non-listed account even though MCC membership passes", () => {
    // Simulate: the async MCC boundary already passed for this account, but it is
    // NOT on the operational allowlist — the write must still be blocked.
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.GOOGLE_ADS_WRITE_CUSTOMERS = "1112223333";
    expect(guardAction(NEG, { customerId: "9998887777" })).toMatch(/allowlist/i);
  });

  it("allows a listed account for a negative keyword", () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.GOOGLE_ADS_WRITE_CUSTOMERS = "1112223333";
    expect(guardAction(NEG, { customerId: "1112223333" })).toBeNull();
  });

  it("skipAllowlist (validate) allows a non-listed account but still needs the kill switch", () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    expect(guardAction(NEG, { customerId: "9998887777" }, { skipAllowlist: true })).toBeNull();
  });

  it("enforces the campaign allowlist only when set", () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.GOOGLE_ADS_WRITE_CUSTOMERS = "1112223333";
    // no campaign allowlist set -> pause allowed on an allowed account
    expect(guardAction(PAUSE, { customerId: "1112223333", campaignId: "555" })).toBeNull();
    // campaign allowlist set and not matching -> blocked
    process.env.GOOGLE_ADS_WRITE_CAMPAIGNS = "999";
    expect(guardAction(PAUSE, { customerId: "1112223333", campaignId: "555" })).toMatch(/campaign/i);
  });

  it("blocks budget writes unless a max-daily cap is set, and enforces the cap", () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.GOOGLE_ADS_WRITE_CUSTOMERS = "1112223333";
    // no cap -> budget writes disabled
    expect(guardAction(BUDGET, { customerId: "1112223333", campaignId: "555" })).toMatch(/budget/i);
    // cap below requested -> blocked
    process.env.GOOGLE_ADS_BUDGET_MAX_DAILY = "10";
    expect(guardAction(BUDGET, { customerId: "1112223333", campaignId: "555" })).toMatch(/exceeds/i);
    // cap above requested -> allowed
    process.env.GOOGLE_ADS_BUDGET_MAX_DAILY = "50";
    expect(guardAction(BUDGET, { customerId: "1112223333", campaignId: "555" })).toBeNull();
  });
});

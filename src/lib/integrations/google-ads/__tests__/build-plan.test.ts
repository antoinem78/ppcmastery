import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { planBuild, type GoogleBuildSpec } from "@/lib/integrations/google-ads/build";

// planBuild is pure: it validates a spec and constructs the mutate operations.
// These tests pin the two things that must never regress — the campaign is
// created PAUSED, and a spec that would exceed the budget cap is refused before
// any network call.

function spec(over: Partial<GoogleBuildSpec["campaign"]> = {}): GoogleBuildSpec {
  return {
    account: "123-456-7890",
    build_ref: "test-build-1",
    campaign: {
      name: "Test Brand",
      daily_budget: 20,
      bidding: "maximize_conversions",
      geo: ["GB"],
      ad_groups: [
        {
          name: "Brand",
          keywords: [{ text: "acme widgets", match: "EXACT" }],
          ads: [
            {
              headlines: ["Acme Widgets", "Buy Acme Widgets", "Widgets In Stock"],
              descriptions: ["Quality widgets, shipped fast.", "Free returns within 30 days."],
              final_url: "https://example.com/widgets",
            },
          ],
        },
      ],
      ...over,
    },
  };
}

const ORIGINAL = process.env.GOOGLE_ADS_BUDGET_MAX_DAILY;
beforeEach(() => { process.env.GOOGLE_ADS_BUDGET_MAX_DAILY = "100"; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GOOGLE_ADS_BUDGET_MAX_DAILY;
  else process.env.GOOGLE_ADS_BUDGET_MAX_DAILY = ORIGINAL;
});

describe("planBuild", () => {
  it("always creates the campaign PAUSED, whatever the spec says", () => {
    const { ops, error } = planBuild(spec());
    expect(error).toBeUndefined();
    const campaignOp = ops?.find((o) => (o as Record<string, unknown>).campaignOperation) as
      | { campaignOperation: { create: { status: string; advertisingChannelType: string } } }
      | undefined;
    expect(campaignOp?.campaignOperation.create.status).toBe("PAUSED");
    expect(campaignOp?.campaignOperation.create.advertisingChannelType).toBe("SEARCH");
  });

  it("refuses a budget above the env hard cap", () => {
    const { error, ops } = planBuild(spec({ daily_budget: 250 }));
    expect(ops).toBeUndefined();
    expect(error).toMatch(/exceeds the hard cap/i);
  });

  it("refuses every build when budget writes are disabled", () => {
    process.env.GOOGLE_ADS_BUDGET_MAX_DAILY = "0";
    const { error } = planBuild(spec());
    expect(error).toMatch(/Budget writes are disabled/i);
  });

  it("rejects RSA text over Google's limits before any network call", () => {
    const long = planBuild(spec({
      ad_groups: [{
        name: "Brand",
        keywords: [{ text: "acme", match: "EXACT" }],
        ads: [{
          headlines: ["A".repeat(31), "Two", "Three"],
          descriptions: ["One description here.", "Another description here."],
          final_url: "https://example.com",
        }],
      }],
    }));
    expect(long.error).toMatch(/headline over 30 chars/i);
  });

  it("requires at least three headlines and two descriptions", () => {
    const thin = planBuild(spec({
      ad_groups: [{
        name: "Brand",
        keywords: [{ text: "acme", match: "EXACT" }],
        ads: [{ headlines: ["One", "Two"], descriptions: ["Only one."], final_url: "https://example.com" }],
      }],
    }));
    expect(thin.error).toMatch(/3 to 15 headlines/i);
  });

  it("requires a build_ref (idempotency + audit trail)", () => {
    const s = spec();
    s.build_ref = "";
    expect(planBuild(s).error).toMatch(/build_ref is required/i);
  });

  it("builds groups, keywords and ads ENABLED under the paused campaign", () => {
    const { ops } = planBuild(spec());
    const group = ops?.find((o) => (o as Record<string, unknown>).adGroupOperation) as
      | { adGroupOperation: { create: { status: string } } } | undefined;
    const keyword = ops?.find((o) => (o as Record<string, unknown>).adGroupCriterionOperation) as
      | { adGroupCriterionOperation: { create: { status: string } } } | undefined;
    expect(group?.adGroupOperation.create.status).toBe("ENABLED");
    expect(keyword?.adGroupCriterionOperation.create.status).toBe("ENABLED");
  });

  it("resolves GB geo shorthand to the geo target constant", () => {
    const { ops } = planBuild(spec());
    const geo = ops?.find((o) => {
      const c = (o as { campaignCriterionOperation?: { create?: Record<string, unknown> } }).campaignCriterionOperation;
      return c?.create?.location !== undefined;
    }) as { campaignCriterionOperation: { create: { location: { geoTargetConstant: string } } } } | undefined;
    expect(geo?.campaignCriterionOperation.create.location.geoTargetConstant).toBe("geoTargetConstants/2826");
  });
});

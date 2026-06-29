// Publish an AdForge campaign to Google Ads as one atomic googleAds:mutate.
//
// Builds the full resource graph with temp resource names (negative IDs) so
// budget -> campaign -> ad groups -> keywords/negatives -> RSAs -> sitelink &
// callout assets -> asset links all create in a single request. The campaign is
// always created PAUSED so nothing spends until a human reviews it inside Google
// Ads. Language/location targeting is intentionally left to be set in Google Ads
// after publish (resolving geo-target constants from free-text place names needs
// a separate lookup; out of scope for the first internal release).
import { truncate } from "@/lib/adforge";
import type { Campaign, MatchType } from "@/lib/adforge";
import { googleAdsMutate } from "./index";

const HEADLINE_MAX = 30;
const DESC_MAX = 90;

const MATCH_TYPE: Record<MatchType, string> = { exact: "EXACT", phrase: "PHRASE", broad: "BROAD" };

// Google stores keyword text WITHOUT match-type punctuation — strip the [ ] / " "
// the engine wraps around exact/phrase keywords.
const cleanKeyword = (text: string): string => text.replace(/^[[\]"\s]+|[[\]"\s]+$/g, "").trim();

const onlyDigits = (s: string): string => s.replace(/\D/g, "");

// Drop empties + case-insensitive duplicates, preserving order.
function dedupeText(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export class PublishValidationError extends Error {}

/** Build the array of MutateOperation objects for one campaign. Throws PublishValidationError on un-publishable copy. */
export function buildMutateOperations(
  customerId: string,
  campaign: Campaign,
  dailyBudget: number,
): Record<string, unknown>[] {
  const cid = onlyDigits(customerId);
  if (cid.length < 8) throw new PublishValidationError("Enter a valid Google Ads customer ID (10 digits).");

  const ref = (kind: string, id: number) => `customers/${cid}/${kind}/${id}`;
  const budgetRN = ref("campaignBudgets", -1);
  const campaignRN = ref("campaigns", -2);

  const ops: Record<string, unknown>[] = [];

  // 1. Budget (micros = currency * 1,000,000).
  ops.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budgetRN,
        name: `${campaign.name} Budget ${Math.abs(Math.round(dailyBudget * 100))}`,
        amountMicros: String(Math.round(dailyBudget * 1_000_000)),
        deliveryMethod: "STANDARD",
        explicitlyShared: false,
      },
    },
  });

  // 2. Campaign — Search, manual CPC, PAUSED.
  ops.push({
    campaignOperation: {
      create: {
        resourceName: campaignRN,
        name: campaign.name,
        status: "PAUSED",
        advertisingChannelType: "SEARCH",
        campaignBudget: budgetRN,
        // Required on campaign create in Google Ads v24 (EU political-ads
        // transparency). These are commercial ads, not political.
        containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        manualCpc: {},
        networkSettings: {
          targetGoogleSearch: campaign.settings.networks.googleSearch,
          targetSearchNetwork: campaign.settings.networks.searchPartners,
          targetContentNetwork: false,
          targetPartnerSearchNetwork: false,
        },
      },
    },
  });

  // 3. Ad groups + keywords + negatives + ads.
  campaign.adGroups.forEach((g, i) => {
    const agRN = ref("adGroups", -(100 + i));
    ops.push({
      adGroupOperation: {
        create: {
          resourceName: agRN,
          name: g.name,
          campaign: campaignRN,
          status: "ENABLED",
          type: "SEARCH_STANDARD",
          cpcBidMicros: String(Math.round((g.maxCpc || 1) * 1_000_000)),
        },
      },
    });

    for (const kw of g.keywords) {
      const text = cleanKeyword(kw.text);
      if (!text) continue;
      ops.push({
        adGroupCriterionOperation: {
          create: { adGroup: agRN, status: "ENABLED", keyword: { text, matchType: MATCH_TYPE[kw.matchType] } },
        },
      });
    }
    for (const neg of g.negativeKeywords) {
      const text = cleanKeyword(neg.text);
      if (!text) continue;
      ops.push({
        adGroupCriterionOperation: {
          create: { adGroup: agRN, negative: true, keyword: { text, matchType: MATCH_TYPE[neg.matchType] } },
        },
      });
    }

    for (const ad of campaign.ads.filter((a) => a.adGroupId === g.id)) {
      // Google rejects an RSA with duplicate headlines/descriptions — dedupe
      // case-insensitively after truncation.
      const headlines = dedupeText(ad.headlines.map((h) => truncate(h.text.trim(), HEADLINE_MAX))).slice(0, 15).map((text) => ({ text }));
      const descriptions = dedupeText(ad.descriptions.map((d) => truncate(d.text.trim(), DESC_MAX))).slice(0, 4).map((text) => ({ text }));
      const finalUrl = ad.finalUrl.trim();

      if (headlines.length < 3)
        throw new PublishValidationError(`Ad group "${g.name}" has an ad with fewer than 3 headlines. Generate or add copy first.`);
      if (descriptions.length < 2)
        throw new PublishValidationError(`Ad group "${g.name}" has an ad with fewer than 2 descriptions. Use "Generate with AI" to fill descriptions.`);
      if (!finalUrl)
        throw new PublishValidationError(`Ad group "${g.name}" has an ad with no Final URL. Add one before publishing.`);

      const rsa: Record<string, unknown> = { headlines, descriptions };
      if (ad.path1.trim()) rsa.path1 = ad.path1.trim().slice(0, 15);
      if (ad.path2.trim()) rsa.path2 = ad.path2.trim().slice(0, 15);

      ops.push({
        adGroupAdOperation: {
          create: { adGroup: agRN, status: "ENABLED", ad: { finalUrls: [finalUrl], responsiveSearchAd: rsa } },
        },
      });
    }
  });

  // 4. Campaign-level negative keywords.
  for (const neg of campaign.campaignNegativeKeywords) {
    const text = cleanKeyword(neg.text);
    if (!text) continue;
    ops.push({
      campaignCriterionOperation: {
        create: { campaign: campaignRN, negative: true, keyword: { text, matchType: MATCH_TYPE[neg.matchType] } },
      },
    });
  }

  // 5. Sitelink + callout assets, then link them to the campaign.
  let assetSeq = 0;
  for (const sl of campaign.sitelinks) {
    const linkText = sl.linkText.trim();
    const finalUrl = sl.finalUrl.trim();
    if (!linkText || !finalUrl) continue; // sitelink assets require text + a URL
    const assetRN = ref("assets", -(1000 + assetSeq++));
    const sitelinkAsset: Record<string, unknown> = { linkText: truncate(linkText, 25) };
    if (sl.descriptionLine1.trim()) sitelinkAsset.description1 = truncate(sl.descriptionLine1.trim(), 35);
    if (sl.descriptionLine2.trim()) sitelinkAsset.description2 = truncate(sl.descriptionLine2.trim(), 35);
    ops.push({ assetOperation: { create: { resourceName: assetRN, finalUrls: [finalUrl], sitelinkAsset } } });
    ops.push({ campaignAssetOperation: { create: { campaign: campaignRN, asset: assetRN, fieldType: "SITELINK" } } });
  }
  for (const c of campaign.callouts) {
    const text = c.text.trim();
    if (!text) continue;
    const assetRN = ref("assets", -(1000 + assetSeq++));
    ops.push({ assetOperation: { create: { resourceName: assetRN, calloutAsset: { calloutText: truncate(text, 25) } } } });
    ops.push({ campaignAssetOperation: { create: { campaign: campaignRN, asset: assetRN, fieldType: "CALLOUT" } } });
  }

  return ops;
}

export interface PublishResult {
  validateOnly: boolean;
  operationCount: number;
  campaignResourceName: string | null;
}

/**
 * Publish (or validate) a campaign to a Google Ads account. With validateOnly
 * the request is checked but nothing is written. The campaign is created PAUSED.
 */
export async function publishCampaign(
  customerId: string,
  campaign: Campaign,
  dailyBudget: number,
  validateOnly: boolean,
): Promise<PublishResult> {
  const ops = buildMutateOperations(customerId, campaign, dailyBudget);
  const { results } = await googleAdsMutate(onlyDigits(customerId), ops, validateOnly);
  const campaignResult = results?.find((r) => typeof (r as { campaignResult?: { resourceName?: string } }).campaignResult?.resourceName === "string");
  const campaignResourceName =
    (campaignResult as { campaignResult?: { resourceName?: string } } | undefined)?.campaignResult?.resourceName ?? null;
  return { validateOnly, operationCount: ops.length, campaignResourceName };
}

// Deterministic finding detectors for the Meta audit.
//
// Why this exists: handing an account's raw data to a model and asking it to
// "find the problems" produces plausible generic prose and misses the specific,
// quantified things that actually cost money. Every finding below is computed
// in code from the account's own numbers, carries its own evidence, and is only
// raised when it clears a threshold. The model writes around these; it never
// discovers them and never supplies a figure of its own.
//
// Two rules the detectors follow:
//   1. A section that failed to read is skipped, never reported as an absence.
//      A permission error on one edge is not evidence the thing is missing.
//   2. Every finding states the money at stake where it can be computed, so the
//      audit can be ordered by what it is worth rather than by what is easy to say.
import type { DeepAudit, Segment, AdSetRow } from "@/lib/integrations/meta/audit-deep";
import { isErr } from "@/lib/integrations/meta/audit-deep";

export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** One line stating the problem in the account's own numbers. */
  headline: string;
  /** Short factual lines the narrative may quote verbatim. */
  evidence: string[];
  /** What it costs per 30 days, account currency, when computable. */
  moneyAtStake: number | null;
  recommendation: string;
}

/** Meta needs roughly this many optimisation events per ad set per week. */
const LEARNING_EVENTS_PER_WEEK = 50;

const FUNNEL_BENCHMARKS = {
  linkClickToLpv: { floor: 0.7, label: "80% or better" },
  viewContentToCart: { floor: 0.05, label: "8 to 10%" },
  cartToCheckout: { floor: 0.3, label: "40 to 50%" },
  checkoutToPurchase: { floor: 0.25, label: "35 to 50%" },
} as const;

const n0 = (v: number) => Math.round(v).toLocaleString("en-GB");
const n2 = (v: number) => v.toFixed(2);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const per30 = (v: number, days: number) => (days > 0 ? (v / days) * 30 : 0);

const SALES_OBJECTIVES = new Set(["OUTCOME_SALES", "OUTCOME_LEADS", "CONVERSIONS"]);
const CONVERSION_GOALS = new Set(["VALUE", "OFFSITE_CONVERSIONS", "OFFSITE_CONVERSION"]);

export function detectFindings(d: DeepAudit): Finding[] {
  const out: Finding[] = [];
  const cur = d.current;
  const cx = d.currency || "";
  const money = (v: number) => `${n0(v)} ${cx}`.trim();
  // Breakdowns run on a 90 day window; scale to a comparable 30 day figure.
  const LONG_DAYS = 90;

  /* ---- 1. learning phase starvation ---- */
  if (cur && !isErr(d.adSets) && cur.purchases > 0 && d.window.days > 0) {
    const convSets = d.adSets.filter((s) => CONVERSION_GOALS.has(s.optimizationGoal));
    if (convSets.length > 1) {
      const perWeek = (cur.purchases / d.window.days) * 7;
      const each = perWeek / convSets.length;
      if (each < LEARNING_EVENTS_PER_WEEK * 0.5) {
        const needDaily = (LEARNING_EVENTS_PER_WEEK * cur.cpa) / 7;
        const failed = d.adSets.filter((s) => s.learning === "FAIL").length;
        const done = d.adSets.filter((s) => s.learning === "SUCCESS").length;
        out.push({
          id: "learning_starvation",
          severity: each < 5 ? "critical" : "high",
          title: "Budget is spread too thin for Meta to optimise",
          headline: `${convSets.length} ad sets optimise to a conversion, and each receives ${each.toFixed(2)} events per week against the ${LEARNING_EVENTS_PER_WEEK} Meta needs.`,
          evidence: [
            `${money(cur.spend / d.window.days)} spent per day across the account.`,
            `${perWeek.toFixed(1)} purchases per week account wide, at ${money(cur.cpa)} each.`,
            `One ad set would need ${money(needDaily)} a day to reach ${LEARNING_EVENTS_PER_WEEK} events a week. All ${convSets.length} would need ${money(needDaily * convSets.length)}.`,
            ...(failed || done ? [`${failed} live ad sets are marked learning limited and ${done} have completed learning.`] : []),
          ],
          moneyAtStake: null,
          recommendation: `Consolidate the ${convSets.length} conversion ad sets into four or five under campaign budget optimisation, and move the rest to a signal the account can actually supply at this volume.`,
        });
      }
    }
  }

  /* ---- 2. placements that lose money ---- */
  if (!isErr(d.byPlacement) && d.byPlacement.length) {
    const total = d.byPlacement.reduce((s, p) => s + p.spend, 0);
    const floor = Math.max(total * 0.01, 500);
    const bad = d.byPlacement.filter((p) => p.spend >= floor && p.roas < 1);
    if (bad.length && total > 0) {
      const badSpend = bad.reduce((s, p) => s + p.spend, 0);
      const badRev = bad.reduce((s, p) => s + p.revenue, 0);
      if (badSpend / total > 0.05) {
        out.push({
          id: "placement_waste",
          severity: badSpend / total > 0.15 ? "critical" : "high",
          title: "A meaningful share of spend sits in placements that lose money",
          headline: `${bad.length} placements took ${money(badSpend)} over ${LONG_DAYS} days, ${pct(badSpend / total)} of spend, and returned ${money(badRev)}.`,
          evidence: bad.slice(0, 6).map((p) =>
            `${p.key}: ${money(p.spend)} at ${n2(p.roas)} return, ${p.purchases} purchases, ${pct(p.impressions ? p.linkClicks / p.impressions : 0)} link click rate.`),
          moneyAtStake: per30(badSpend - badRev, LONG_DAYS),
          recommendation: `Exclude ${bad.slice(0, 3).map((p) => p.key).join(", ")} from the conversion campaigns and hold the budget in the placements already returning above 1.0.`,
        });
      }
    }
    const stars = d.byPlacement.filter((p) => p.roas >= 3 && p.purchases >= 3 && p.spend < total * 0.05);
    if (stars.length) {
      out.push({
        id: "placement_starved",
        severity: "medium",
        title: "The best returning placements are being starved",
        headline: `${stars.length} placements return 3.0 or better on under 5% of spend each.`,
        evidence: stars.slice(0, 4).map((p) => `${p.key}: ${n2(p.roas)} return on ${money(p.spend)}, ${p.purchases} purchases.`),
        moneyAtStake: null,
        recommendation: "Give the proven placements a dedicated ad set rather than leaving them as a rounding error inside a broad placement selection.",
      });
    }
  }

  /* ---- 3. exclusion coverage ---- */
  if (!isErr(d.adSets) && d.adSets.length) {
    const sales = d.adSets.filter((s) => SALES_OBJECTIVES.has(s.campaignObjective));
    const noExcl = sales.filter((s) => s.excludedAudiences.length === 0);
    if (sales.length >= 3 && noExcl.length / sales.length > 0.3) {
      const byCamp = new Map<string, number>();
      for (const s of noExcl) byCamp.set(s.campaignName, (byCamp.get(s.campaignName) ?? 0) + 1);
      out.push({
        id: "missing_exclusions",
        severity: "high",
        title: "Sales ad sets exclude nobody, including existing customers",
        headline: `${noExcl.length} of ${sales.length} live sales ad sets carry no exclusion audience at all.`,
        evidence: [...byCamp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([c, n]) => `${c}: ${n} ad ${n === 1 ? "set" : "sets"} with no exclusions.`),
        moneyAtStake: null,
        recommendation: "Apply one standard exclusion set to every prospecting ad set (purchasers 180 days plus the customer list), and exclude purchasers from every retargeting ad set so converted customers drop out automatically.",
      });
    }
  }

  /* ---- 4. frequency burn ---- */
  if (!isErr(d.campaignFrequency)) {
    const hot = d.campaignFrequency.filter((c) => c.frequency >= 8 && c.spend >= 300);
    if (hot.length) {
      const wasted = hot.filter((c) => c.purchases === 0).reduce((s, c) => s + c.spend, 0);
      out.push({
        id: "frequency_burn",
        severity: hot.some((c) => c.frequency >= 20) ? "high" : "medium",
        title: "Warm audiences are being shown the same ads far too often",
        headline: `${hot.length} campaigns ran above a frequency of 8 in ${d.window.days} days${cur ? `, against an account average of ${n2(cur.frequency)}` : ""}.`,
        evidence: hot.slice(0, 6).map((c) => `${c.key}: frequency ${n2(c.frequency)} on ${money(c.spend)}, ${c.purchases} purchases.`),
        moneyAtStake: wasted > 0 ? wasted : null,
        recommendation: "Cap frequency on the warm campaigns, widen the pools they draw from, and retire any campaign whose audience is exhausted rather than leaving it to re-serve.",
      });
    }
  }

  /* ---- 5. audience library hygiene ---- */
  if (!isErr(d.audiences) && d.audiences.length > 20 && !isErr(d.adSets)) {
    const used = new Set<string>();
    for (const s of d.adSets) { s.includedAudiences.forEach((a) => used.add(a)); s.excludedAudiences.forEach((a) => used.add(a)); }
    const dormant = d.audiences.filter((a) => !used.has(a.name));
    const notReady = d.audiences.filter((a) => !a.ready);
    const byName = new Map<string, number>();
    for (const a of d.audiences) {
      const k = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      byName.set(k, (byName.get(k) ?? 0) + 1);
    }
    const dupes = [...byName.values()].filter((v) => v > 1).length;
    if (dormant.length > d.audiences.length * 0.4 || dupes > 0) {
      const dupeNames = d.audiences.filter((a) => (byName.get(a.name.toLowerCase().replace(/[^a-z0-9]/g, "")) ?? 0) > 1);
      const seen = new Set<string>();
      const dupeList: string[] = [];
      for (const a of dupeNames) {
        const k = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (seen.has(k)) continue;
        seen.add(k);
        dupeList.push(`${byName.get(k)} audiences share the name "${a.name}".`);
      }
      out.push({
        id: "audience_sprawl",
        severity: dupes > 0 ? "medium" : "low",
        title: "The audience library is carrying more than it uses",
        headline: `${d.audiences.length} custom audiences exist, ${d.audiences.length - dormant.length} are referenced by a live ad set and ${dormant.length} by nothing.`,
        evidence: [
          ...(notReady.length ? [`${notReady.length} are flagged unusable by Meta, generally for being below 1,000 people.`] : []),
          ...dupeList.slice(0, 5),
        ],
        moneyAtStake: null,
        recommendation: "Adopt one naming convention, archive the dormant audiences, and resolve the duplicate names after confirming which copy each live ad set points at. Two audiences with the same name make every later handover guesswork.",
      });
    }
  }

  /* ---- 6. age bands that do not pay ---- */
  if (!isErr(d.byAge) && d.byAge.length > 2) {
    const known = d.byAge.filter((a) => a.key !== "Unknown" && a.spend > 0);
    const totalSpend = known.reduce((s, a) => s + a.spend, 0);
    const totalRev = known.reduce((s, a) => s + a.revenue, 0);
    const blended = totalSpend ? totalRev / totalSpend : 0;
    const weak = known.filter((a) => a.spend >= totalSpend * 0.04 && a.roas < Math.max(blended * 0.65, 1));
    if (weak.length && blended > 0) {
      const weakSpend = weak.reduce((s, a) => s + a.spend, 0);
      const weakRev = weak.reduce((s, a) => s + a.revenue, 0);
      if (weakSpend / totalSpend > 0.08) {
        const breadth = !isErr(d.adSets)
          ? d.adSets.filter((s) => (s.ageMin ?? 18) <= 25 && (s.ageMax ?? 65) >= 55).length : 0;
        out.push({
          id: "age_waste",
          severity: "medium",
          title: "Spend is going to age bands that do not pay for themselves",
          headline: `${weak.map((w) => w.key).join(", ")} took ${money(weakSpend)} over ${LONG_DAYS} days, ${pct(weakSpend / totalSpend)} of spend, at a blended ${n2(weakSpend ? weakRev / weakSpend : 0)} return against ${n2(blended)} account wide.`,
          evidence: [
            ...known.map((a) => `${a.key}: ${money(a.spend)}, ${a.purchases} purchases, ${n2(a.roas)} return.`),
            ...(breadth ? [`${breadth} live ad sets are set wide enough to include every one of these bands.`] : []),
          ],
          moneyAtStake: per30(weakSpend - weakRev, LONG_DAYS),
          recommendation: "Narrow the conversion campaigns to the bands that carry the purchases and keep one small holdout on the weaker bands so the decision stays evidence based.",
        });
      }
    }
  }

  /* ---- 7. geography leakage ---- */
  if (!isErr(d.byCountry) && d.byCountry.length > 1) {
    const total = d.byCountry.reduce((s, c) => s + c.spend, 0);
    const home = d.byCountry[0];
    const away = d.byCountry.slice(1);
    const awaySpend = away.reduce((s, c) => s + c.spend, 0);
    const awayPur = away.reduce((s, c) => s + c.purchases, 0);
    const awayRev = away.reduce((s, c) => s + c.revenue, 0);
    if (total > 0 && awaySpend / total > 0.03 && awaySpend > 1000 && (awaySpend ? awayRev / awaySpend : 0) < 0.5) {
      out.push({
        id: "geo_leak",
        severity: "medium",
        title: "Spend is leaking outside the market the offer is written for",
        headline: `${money(awaySpend)} over ${LONG_DAYS} days, ${pct(awaySpend / total)} of spend, went to ${away.length} countries outside ${home.key} and produced ${awayPur} ${awayPur === 1 ? "purchase" : "purchases"}.`,
        evidence: [
          `${home.key}: ${money(home.spend)}, ${home.purchases} purchases, ${n2(home.roas)} return.`,
          ...away.slice(0, 6).map((c) => `${c.key}: ${money(c.spend)}, ${c.purchases} purchases.`),
        ],
        moneyAtStake: per30(awaySpend - awayRev, LONG_DAYS),
        recommendation: "Lock the campaigns that are leaking to the home market. If a second market is wanted it needs its own campaign, its own language and its own budget line, not spillover.",
      });
    }
  }

  /* ---- 8. campaigns spending with nothing to show ---- */
  if (!isErr(d.byCampaign) && d.byCampaign.length) {
    const total = d.byCampaign.reduce((s, c) => s + c.spend, 0);
    const zero = d.byCampaign.filter((c) => c.purchases === 0 && c.spend >= Math.max(total * 0.005, 100));
    const zeroSpend = zero.reduce((s, c) => s + c.spend, 0);
    if (total > 0 && zeroSpend / total > 0.15) {
      out.push({
        id: "zero_return_campaigns",
        severity: zeroSpend / total > 0.3 ? "high" : "medium",
        title: "A large share of the month produced no tracked revenue",
        headline: `${zero.length} campaigns spent ${money(zeroSpend)} in ${d.window.days} days, ${pct(zeroSpend / total)} of the period, without a single attributed purchase.`,
        evidence: zero.slice(0, 8).map((c) => `${c.key}: ${money(c.spend)}.`),
        moneyAtStake: null,
        recommendation: "Separate deliberate brand and engagement activity from campaigns that are simply not working. Give the first an explicit allowance as a share of monthly budget and hold it there. Stop the second.",
      });
    }
  }

  /* ---- 9. no cost control ---- */
  if (!isErr(d.adSets) && d.adSets.length >= 5) {
    const capped = d.adSets.filter((s) => /COST_CAP|BID_CAP|ROAS/.test(s.bidStrategy));
    if (capped.length === 0) {
      out.push({
        id: "no_cost_control",
        severity: "low",
        title: "There is no cost control anywhere in the account",
        headline: `All ${d.adSets.length} live ad sets run without a cost cap, bid cap or minimum return setting.`,
        evidence: [
          "Lowest cost tells Meta to spend the budget whatever the result costs.",
          ...(cur && cur.cpa ? [`Cost per purchase currently averages ${money(cur.cpa)}.`] : []),
        ],
        moneyAtStake: null,
        recommendation: "Once the account is consolidated and ad sets hold a stable cost per result, introduce a cost cap campaign carrying only proven winners, set near the blended cost per purchase and scaled in 10 to 20% steps. Applying a cap while ad sets are still in learning would simply stop delivery.",
      });
    }
  }

  /* ---- 10. the funnel ---- */
  if (cur && cur.linkClicks > 200) {
    const steps: { label: string; rate: number; floor: number; bench: string; from: number }[] = [];
    if (cur.landingPageViews) steps.push({ label: "link click to landing page view", rate: cur.landingPageViews / cur.linkClicks, floor: FUNNEL_BENCHMARKS.linkClickToLpv.floor, bench: FUNNEL_BENCHMARKS.linkClickToLpv.label, from: cur.linkClicks });
    if (cur.viewContent > 100) steps.push({ label: "product view to add to cart", rate: cur.addToCart / cur.viewContent, floor: FUNNEL_BENCHMARKS.viewContentToCart.floor, bench: FUNNEL_BENCHMARKS.viewContentToCart.label, from: cur.viewContent });
    if (cur.addToCart > 20) steps.push({ label: "add to cart to checkout", rate: cur.checkouts / cur.addToCart, floor: FUNNEL_BENCHMARKS.cartToCheckout.floor, bench: FUNNEL_BENCHMARKS.cartToCheckout.label, from: cur.addToCart });
    if (cur.checkouts > 10) steps.push({ label: "checkout to purchase", rate: cur.purchases / cur.checkouts, floor: FUNNEL_BENCHMARKS.checkoutToPurchase.floor, bench: FUNNEL_BENCHMARKS.checkoutToPurchase.label, from: cur.checkouts });
    const broken = steps.filter((s) => s.rate < s.floor);
    if (broken.length) {
      const worst = broken.reduce((a, b) => (a.rate / a.floor < b.rate / b.floor ? a : b));
      out.push({
        id: "funnel_break",
        severity: "critical",
        title: `The funnel breaks at ${worst.label}`,
        headline: `${worst.label} runs at ${pct(worst.rate)} against a typical ${worst.bench}.`,
        evidence: [
          ...steps.map((s) => `${s.label}: ${pct(s.rate)}${s.rate < s.floor ? ` (typical ${s.bench})` : " (as expected)"}.`),
          `Over ${d.window.days} days: ${n0(cur.linkClicks)} link clicks, ${n0(cur.landingPageViews)} landing page views, ${n0(cur.viewContent)} product views, ${n0(cur.addToCart)} add to carts, ${n0(cur.checkouts)} checkouts, ${n0(cur.purchases)} purchases.`,
        ],
        moneyAtStake: null,
        recommendation: `This sits on the site rather than in the ad account, and it caps the return on every zloty spent above it. Review the page behind the ads and confirm the ${worst.label.split(" to ")[1]} event fires on every route before drawing a final conclusion.`,
      });
    }
  }

  /* ---- 11. creative variation ---- */
  if (!isErr(d.creative) && d.creative.activeAds >= 10) {
    const c = d.creative;
    if (c.noVariation / c.activeAds > 0.2 || c.unevenLength > c.activeAds * 0.2) {
      out.push({
        id: "creative_variation",
        severity: "medium",
        title: "Ad copy variation is uneven, and some ads carry none at all",
        headline: `${c.noVariation} of ${c.activeAds} live ads carry a single fixed creative with nothing for Meta to test.`,
        evidence: [
          ...(c.unevenLength ? [`${c.unevenLength} ads mix text variations of very different lengths, the widest spread being ${n0(c.maxSpread)} characters.`] : []),
          ...(c.ctaMissing ? [`${c.ctaMissing} live ads carry no call to action.`] : []),
          `Primary text variations per ad: ${Object.entries(c.bodyCounts).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${v} ads with ${k}`).join(", ")}.`,
        ],
        moneyAtStake: null,
        recommendation: "Standardise every conversion ad on five primary texts within a narrow length band and five headlines, each carrying a benefit and a call to action. Variations of wildly different lengths test length, not message, and the result cannot be reused.",
      });
    }
  }

  /* ---- 12. video retention ---- */
  if (cur && cur.videoPlays > 10_000) {
    const hook = cur.impressions ? cur.videoPlays / cur.impressions : 0;
    const hold = cur.videoPlays ? cur.videoComplete / cur.videoPlays : 0;
    if (hold < 0.05 && hook > 0.15) {
      out.push({
        id: "video_retention",
        severity: "medium",
        title: "Video gets attention and then loses it",
        headline: `${pct(hook)} of impressions start the video, and ${pct(hold)} of those reach the end.`,
        evidence: [
          `${n0(cur.videoPlays)} plays from ${n0(cur.impressions)} impressions in ${d.window.days} days.`,
          `${n0(cur.videoComplete)} completions, ${n0(cur.thruplay)} thruplays.`,
        ],
        moneyAtStake: null,
        recommendation: "The opening frames are working and the middle is not. Cut the winning videos short, move the demonstration to the front, and test several openings against one body.",
      });
    }
  }

  /* ---- 13. advanced matching, only when explicitly off ---- */
  if (!isErr(d.pixels)) {
    // `null` means the field could not be read. Only an explicit false counts.
    const off = d.pixels.filter((p) => p.advancedMatching === false);
    if (off.length) {
      out.push({
        id: "advanced_matching_off",
        severity: "high",
        title: "Automatic advanced matching is switched off",
        headline: `${off.length} of ${d.pixels.length} datasets have advanced matching disabled.`,
        evidence: off.map((p) => `${p.name || p.id}: advanced matching off${p.lastFired ? `, last fired ${p.lastFired.slice(0, 10)}` : ""}.`),
        moneyAtStake: null,
        recommendation: "Turn it on. It raises match rates, which improves attribution, retargeting pool quality and lookalike accuracy at no media cost.",
      });
    }
  }

  /* ---- 14. spend concentrated in ads that never convert ---- */
  if (!isErr(d.ads) && d.ads.length) {
    const meaningful = d.ads.filter((a) => a.spend >= 500);
    if (meaningful.length >= 10) {
      const total = meaningful.reduce((s, a) => s + a.spend, 0);
      const zero = meaningful.filter((a) => a.purchases === 0);
      const zeroSpend = zero.reduce((s, a) => s + a.spend, 0);
      const winners = meaningful.filter((a) => a.roas >= 3);
      if (zeroSpend / total > 0.25) {
        out.push({
          id: "ad_level_waste",
          severity: "high",
          title: "A third of ad spend sits on ads that have never converted",
          headline: `${zero.length} of ${meaningful.length} ads with meaningful spend produced no purchases over ${LONG_DAYS} days, on ${money(zeroSpend)}, ${pct(zeroSpend / total)} of tracked ad spend.`,
          evidence: [
            ...zero.slice(0, 5).map((a) => `${a.name}: ${money(a.spend)}, ${n2(a.frequency)} frequency, ${n2(a.linkCtr)}% link click rate, no purchases.`),
            ...(winners.length ? [`For contrast, ${winners.length} ads returned 3.0 or better on ${money(winners.reduce((s, a) => s + a.spend, 0))}.`] : []),
          ],
          moneyAtStake: per30(zeroSpend, LONG_DAYS) * 0.5,
          recommendation: "Introduce a rule that switches an ad off once it passes a spend threshold without a conversion, and route new creative through a dedicated testing campaign so it proves itself before it reaches the scaling budget.",
        });
      }
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) =>
    order[a.severity] - order[b.severity] || (b.moneyAtStake ?? 0) - (a.moneyAtStake ?? 0));
}

/** Total measured monthly waste across findings that could price themselves. */
export function totalAtStake(findings: Finding[]): number {
  return findings.reduce((s, f) => s + (f.moneyAtStake ?? 0), 0);
}

/** Things that were checked and found sound. Stops the audit reading as a hit list. */
export function detectStrengths(d: DeepAudit): string[] {
  const ok: string[] = [];
  const cur = d.current;
  if (!isErr(d.pixels) && d.pixels.some((p) => p.advancedMatching === true)) {
    const p = d.pixels.find((x) => x.advancedMatching === true)!;
    ok.push(`Automatic advanced matching is on${p.fields.length ? ` with ${p.fields.length} fields including ${p.fields.slice(0, 4).join(", ")}` : ""}. This is often the largest measurement gap on an account and it is not one here.`);
  }
  if (!isErr(d.pixels) && d.pixels.some((p) => p.lastFired)) {
    ok.push("The pixel is firing and has been through the review window.");
  }
  if (!isErr(d.audiences) && d.audiences.length > 20) {
    const lal = d.audiences.filter((a) => a.subtype === "LOOKALIKE").length;
    const web = d.audiences.filter((a) => a.subtype === "WEBSITE").length;
    ok.push(`The audience library is comprehensive: ${d.audiences.length} audiences including ${web} website and ${lal} lookalike. The problem here is breadth, not absence.`);
  }
  if (cur && cur.checkouts > 10 && cur.purchases / cur.checkouts >= 0.35) {
    ok.push(`Checkout to purchase runs at ${pct(cur.purchases / cur.checkouts)}. Once someone reaches the checkout the site closes them, so there is no payment or trust problem at the end of the funnel.`);
  }
  if (!isErr(d.byPlacement) && d.byPlacement.length) {
    const best = d.byPlacement.find((p) => p.roas >= 1.5 && p.spend > 0);
    if (best) ok.push(`${best.key} carries ${n2(best.roas)} return on ${n0(best.spend)} ${d.currency}. The core placement works.`);
  }
  return ok;
}

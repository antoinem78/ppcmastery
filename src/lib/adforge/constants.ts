// Fixed constants ported verbatim from adforge_reference.js, plus the UI
// catalogs documented in AdForge_Replication_Report.md (sections 1, 5, 10).

export const HEADLINE_MAX = 30; // lP / CM
export const DESC_MAX = 90; // kM
export const CALLOUT_MAX = 25; // Dn

export const DEFAULT_MAX_CPC_DISPLAY = "1.00"; // input field default (report section 6)
export const DEFAULT_MAX_CPC = 1; // stored/exported as a number
export const CURRENCY_SYMBOL = "£"; // hard-coded, no selector (report section 6)

// ug[] — keyword headline patterns (identical for ALL business types).
// Index 0 is replaced by the DKI tag for the DKI ad.
export const KW_PATTERNS: ((k: string) => string)[] = [
  (k) => k,
  (k) => `${k} Services`,
  (k) => `Professional ${k}`,
  (k) => `${k} Near You`,
  (k) => `Top ${k} Solutions`,
];

// dg[] — fallback USP headlines used to pad slots 6-10 up to 5.
export const USP_FALLBACKS = [
  "Trusted By Thousands",
  "Quality You Can Count On",
  "Results That Speak",
  "Your Satisfaction Matters",
  "Reliable & Transparent",
];

// fP[] — the 5 fixed CTA headlines.
export const CTA_HEADLINES = [
  "Get a Free Quote Today",
  "Book Now",
  "Order Online Today",
  "Contact Us Now",
  "Start Today",
];

// AM — generic terms penalised in keyword-specificity scoring.
export const GENERIC_TERMS = [
  "stuff", "things", "services", "products", "best", "good", "nice", "buy", "online", "shop", "website",
];
// PM (approx) — CTA terms for ad CTA scoring. The 5 CTA headlines always satisfy these.
export const CTA_TERMS = ["quote", "book", "order", "contact", "call", "start", "get", "today", "now"];

// ---- UI catalogs (report) -------------------------------------------------

export interface BusinessType {
  id: string;
  label: string;
  blurb: string;
  // shop-like / "other" types get asked the online-vs-local question; the rest are local.
  asksBusinessModel: boolean;
}
export const BUSINESS_TYPES: BusinessType[] = [
  { id: "treatments", label: "Treatments", blurb: "Botox, fillers, laser treatments", asksBusinessModel: false },
  { id: "aesthetic-services", label: "Aesthetic Services", blurb: "Beauty clinics, spas, cosmetic procedures", asksBusinessModel: false },
  { id: "medical-services", label: "Medical Services", blurb: "Clinics, doctors, healthcare", asksBusinessModel: false },
  { id: "physical-shops", label: "Physical Shops", blurb: "Retail stores, showrooms", asksBusinessModel: true },
  { id: "home-services", label: "Home Services", blurb: "Plumbing, cleaning, repairs", asksBusinessModel: false },
  { id: "other", label: "Other", blurb: "Any other business type", asksBusinessModel: true },
];

export interface UspCategoryDef {
  id: string;
  label: string;
  description: string;
  options: string[];
}
export const USP_CATALOG: UspCategoryDef[] = [
  {
    id: "delivery-logistics",
    label: "Delivery & Logistics",
    description: "Shipping, delivery speed, tracking",
    options: [
      "Free 24h delivery", "Same-day dispatch", "Free shipping",
      "Express delivery available", "Track your order", "Worldwide shipping",
    ],
  },
  {
    id: "pricing-conditions",
    label: "Pricing & Conditions",
    description: "Returns, guarantees, payment",
    options: [
      "30-day free returns", "Price match guarantee", "No hidden fees",
      "Flexible payment options", "Money-back guarantee", "First order discount",
    ],
  },
  {
    id: "quality-trust",
    label: "Quality & Trust",
    description: "Certifications, ratings, origin",
    options: [
      "Made in Europe", "100% certified", "Award-winning",
      "Industry-leading quality", "Trusted by 10,000+ customers", "5-star rated",
    ],
  },
  {
    id: "support-service",
    label: "Support & Service",
    description: "Customer service, expertise",
    options: [
      "24/7 customer support", "Live chat available", "Expert advice included",
      "Dedicated account manager", "Free consultation", "After-sales support",
    ],
  },
];

export const CALLOUT_SUGGESTIONS = [
  "Free Delivery", "24/7 Support", "No Contract", "Free Returns", "Price Match",
  "Same Day Shipping", "Certified Experts", "Family Owned", "Eco-Friendly",
  "Satisfaction Guarantee", "Licensed & Insured", "Easy Cancellation",
  "Award Winning", "Trusted Since 2010", "Fast Turnaround", "Custom Solutions",
];

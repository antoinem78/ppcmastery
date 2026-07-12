// The "Managed Paid Search Services Agreement" content — clauses 1-11 mirroring
// the live PandaDoc template (docs/pandadoc-contract-template.md), built from
// client + quote + entity env config. Shared by BOTH non-PandaDoc providers so
// the engine (HTML) and Documenso (PDF) render the exact same contract text.
// ⚠️ Wording pending legal review (same caveat as the PandaDoc template).
import { entityConfig, formatMoney } from "@/lib/config";

export interface ContractClient {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string;
}
export interface ContractQuote {
  name: string;
  price: number;
  channels: string;
}

// Entity specifics; defaults mirror the live PPC Mastery template. Clone
// deployments override via env.
const registrationInfo = () =>
  process.env.ENTITY_REGISTRATION_INFO ?? "ul. Tyniecka 137T, 30-376 Krakow, Poland";
const governingLaw = () =>
  process.env.AGREEMENT_GOVERNING_LAW ??
  "the laws of Poland. Any disputes are subject to the exclusive jurisdiction of the courts of Krakow, Poland";
const privacyUrl = () =>
  process.env.PRIVACY_URL ?? `${process.env.APP_BASE_URL ?? ""}/privacy`;

export interface PricingLine {
  label: string;
  detail: string;
  amount: number | string;
  period?: "monthly" | "once";
}

export interface AgreementContent {
  providerName: string;
  title: string;
  number: string;
  date: string; // YYYY-MM-DD
  intro: string; // blank lines = paragraphs
  pricing: PricingLine[];
  pricingNote: string;
  terms: string[]; // clauses, auto-numbered by the renderer
  acceptNote: string;
}

export function buildAgreementContent(client: ContractClient, quote: ContractQuote): AgreementContent {
  const provider = entityConfig.legalName || entityConfig.brandName;
  const today = new Date().toISOString().slice(0, 10);
  return {
    providerName: provider,
    title: "Managed Paid Search Services Agreement",
    number: `AGR-${today.slice(0, 4)}-${client.id.slice(0, 8)}`,
    date: today,
    intro: `This Services Agreement ("Agreement") is entered into on ${today} between:\n\n${provider}, ${registrationInfo()} ("Provider"), and\n\n${client.company_name}, represented by ${client.contact_name ?? client.contact_email} (${client.contact_email}) ("Client").`,
    pricing: [
      {
        label: quote.name,
        detail: "Billed monthly in advance from the date of signup; cancel with 31 days' written notice",
        amount: quote.price,
        period: "monthly",
      },
      {
        label: "Advertising spend",
        detail: "Paid by you directly to the advertising platforms; not included in the fee",
        amount: "Billed by the platforms",
      },
    ],
    pricingNote: "Fee is exclusive of applicable taxes.",
    terms: [
      `Services. The Provider will deliver managed paid search advertising services covering ${quote.channels || "Google Ads and Microsoft Advertising"} only, comprising: campaign strategy, setup, and structure; ongoing optimisation; budget monitoring; and weekly written performance reports. Services are delivered using the Provider's internal platform and workflows. Services for other advertising platforms or channels are not included and require a separate agreement.`,
      `Service plan and fees. Plan: ${quote.name}. Fee: ${formatMoney(quote.price)} per month, exclusive of applicable taxes. The plan is priced on the Client's monthly advertising spend remaining under the threshold stated in the plan name. If the Client's average monthly ad spend exceeds the plan threshold for two consecutive months, the parties will move the Client to the corresponding higher plan from the next billing cycle. Advertising spend itself is paid by the Client directly to the advertising platforms and is not included in the fee.`,
      "Billing. The fee is billed monthly in advance, starting on the date of signup and recurring on the same date of each subsequent month, collected automatically via the payment method provided by the Client. Failed payments may result in suspension of the services until payment is restored.",
      "Term and cancellation. This Agreement runs on a one-month rolling basis with no long-term commitment. Either party may cancel with 31 days' written notice (email or Slack message is sufficient). Any renewal payment falling due within the notice period remains payable; in practice this means one final monthly payment is collected after notice is given, and services continue until the end of the notice period.",
      "Communication. The fee reflects an asynchronous, Slack-only service. All communication, reporting, and support take place in writing via the Client's dedicated Slack channel. Phone or video calls are not included. If the Client requires calls or meetings, the parties will agree a separate premium package with a tailored quote before any calls take place.",
      "Account access and authorisation. The Client authorises the Provider to access and manage the Client's advertising accounts for the purpose of delivering the services. Access is granted through the advertising platforms' own account-linking mechanisms (for example, a Google Ads manager-account link approved by the Client inside Google Ads). The Client confirms they are authorised to grant such access. The Client retains ownership of their advertising accounts and data at all times. No changes are made to the Client's campaigns without review and approval by a qualified Provider specialist.",
      "Client responsibilities. The Client will: (a) maintain a valid payment method; (b) keep sufficient budget with the advertising platforms; (c) provide timely access, materials, and approvals reasonably needed to deliver the services; (d) ensure their website, products, and landing pages comply with the advertising platforms' policies.",
      `Data protection. The Provider processes Client data in accordance with its Privacy Policy (${privacyUrl()}) and applicable data protection law (including GDPR). Advertising account data is used solely to deliver the services and is never sold or shared with third parties for advertising, profiling, or resale purposes. Data is retained for the duration of the engagement plus 12 months.`,
      "No guarantee of results. The Provider will perform the services with reasonable skill and care. Advertising performance depends on factors outside the Provider's control; the Provider does not guarantee specific results, rankings, traffic, or return on ad spend.",
      "Limitation of liability. To the maximum extent permitted by law, the Provider's total liability under this Agreement is limited to the fees paid by the Client in the three (3) months preceding the event giving rise to the claim. Neither party is liable for indirect, incidental, or consequential damages, including loss of advertising revenue or data.",
      `Governing law. This Agreement is governed by ${governingLaw()}.`,
    ],
    acceptNote: `Accepting confirms the plan, fee, and terms above and forms a binding agreement between ${client.company_name} and ${provider}.`,
  };
}

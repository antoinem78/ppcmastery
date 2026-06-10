# PandaDoc contract template — draft

⚠️ **Draft for legal review** — this is a working draft matching the agreed
business model (zero-calls paid search, monthly rolling, 31-day notice) and the
public ToS on ppcmastery.ai. Have it reviewed by a lawyer before first real use.

## How to set it up in PandaDoc (5 minutes)

1. PandaDoc → **Templates → Create → Blank**. Name it: **`PPC Mastery AI — Service Agreement`**.
2. Paste the agreement text below into the body.
3. The `{{double-brace}}` placeholders are **tokens** — PandaDoc detects them
   automatically when pasted. Don't rename them; the portal fills them by
   exactly these names.
4. Add a **Role** called `Client` (Manage roles → add).
5. At the signature block, drag a **Signature field** and a **Date field** from
   the right panel, assigned to the `Client` role.
6. Save. Tell Claude it's done — the portal finds it by template name.

Tokens the portal fills automatically:

| Token | Filled with |
|---|---|
| `{{client.company_name}}` | client company |
| `{{client.contact_name}}` | signer name |
| `{{client.contact_email}}` | signer email |
| `{{quote.tier_name}}` | e.g. "Paid Search — ad spend under $5,000/mo" |
| `{{quote.monthly_price}}` | e.g. "$199" |
| `{{entity.legal_name}}` | Baptiste Jenard PPC trading as PPC Mastery AI |
| `{{agreement.date}}` | date the contract is generated |

---

## Agreement text (paste from here down)

# Managed Paid Search Services Agreement

This Services Agreement ("Agreement") is entered into on {{agreement.date}} between:

**{{entity.legal_name}}**, ul. Tyniecka 137T, 30-376 Kraków, Poland ("Provider"), and

**{{client.company_name}}**, represented by {{client.contact_name}} ({{client.contact_email}}) ("Client").

## 1. Services

The Provider will deliver managed paid search advertising services covering
**Google Ads and Microsoft Advertising only**, comprising: campaign strategy,
setup, and structure; ongoing optimisation; budget monitoring; and weekly
written performance reports. Services are delivered using the Provider's
internal platform and workflows. Services for other advertising platforms or
channels are not included and require a separate agreement.

## 2. Service plan and fees

- **Plan:** {{quote.tier_name}}
- **Fee:** {{quote.monthly_price}} per month, exclusive of applicable taxes.

The plan is priced on the Client's monthly advertising spend remaining under
the threshold stated in the plan name. If the Client's average monthly ad spend
exceeds the plan threshold for two consecutive months, the parties will move
the Client to the corresponding higher plan from the next billing cycle.

Advertising spend itself is paid by the Client directly to the advertising
platforms (Google, Microsoft) and is not included in the fee.

## 3. Billing

The fee is billed monthly **in advance**, starting on the date of signup and
recurring on the same date of each subsequent month, collected automatically
via the payment method provided by the Client. Failed payments may result in
suspension of the services until payment is restored.

## 4. Term and cancellation

This Agreement runs on a **one-month rolling basis** with no long-term
commitment. Either party may cancel with **31 days' written notice** (email or
Slack message is sufficient). Any renewal payment falling due within the
notice period remains payable — in practice this means one final monthly
payment is collected after notice is given, and services continue until the
end of the notice period.

## 5. Communication — zero-calls service

The fee reflects an **asynchronous, Slack-only service**. All communication,
reporting, and support take place in writing via the Client's dedicated Slack
channel. **Phone or video calls are not included.** If the Client requires
calls or meetings, the parties will agree a separate premium package with a
tailored quote before any calls take place.

## 6. Account access and authorisation

The Client authorises the Provider to access and manage the Client's
advertising accounts for the purpose of delivering the services. Access is
granted through the advertising platforms' own account-linking mechanisms
(e.g. a Google Ads manager-account link approved by the Client inside Google
Ads). The Client confirms they are authorised to grant such access. The Client
retains ownership of their advertising accounts and data at all times. No
changes are made to the Client's campaigns without review and approval by a
qualified Provider specialist.

## 7. Client responsibilities

The Client will: (a) maintain a valid payment method; (b) keep sufficient
budget with the advertising platforms; (c) provide timely access, materials,
and approvals reasonably needed to deliver the services; (d) ensure their
website, products, and landing pages comply with the advertising platforms'
policies.

## 8. Data protection

The Provider processes Client data in accordance with its Privacy Policy
(https://ppcmastery.ai/privacy-policy) and applicable data protection law
(including GDPR). Advertising account data is used solely to deliver the
services and is never sold or shared with third parties for advertising,
profiling, or resale purposes. Data is retained for the duration of the
engagement plus 12 months.

## 9. No guarantee of results

The Provider will perform the services with reasonable skill and care.
Advertising performance depends on factors outside the Provider's control;
the Provider does not guarantee specific results, rankings, traffic, or
return on ad spend.

## 10. Limitation of liability

To the maximum extent permitted by law, the Provider's total liability under
this Agreement is limited to the fees paid by the Client in the three (3)
months preceding the event giving rise to the claim. Neither party is liable
for indirect, incidental, or consequential damages, including loss of
advertising revenue or data.

## 11. Governing law

This Agreement is governed by the laws of Poland. Any disputes are subject to
the exclusive jurisdiction of the courts of Kraków, Poland.

## 12. Signatures

**For the Client:**

Name: {{client.contact_name}}
Company: {{client.company_name}}

_[Signature field — assign to role "Client"]_
_[Date field — assign to role "Client"]_

**For the Provider:**

{{entity.legal_name}}

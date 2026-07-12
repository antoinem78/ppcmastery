# n8n integration

## Creating a proposal (HTTP Request node)

- Method: POST
- URL: `https://app.wmiltd.com/api/proposals`
- Authentication: Generic Credential Type, Header Auth
  - Name: `Authorization`
  - Value: `Bearer YOUR_API_TOKEN`
- Body Content Type: JSON
- Body: map your GHL or CRM fields into the data contract, for example:

```json
{
  "expires_at": "={{ $now.plus({ days: 14 }).toISODate() }}",
  "data": {
    "brand": { "name": "SingularWeb", "accent": "#2733C9", "website": "singularweb.ai" },
    "proposal": {
      "title": "={{ $json.service_name }} for {{ $json.company }}",
      "number": "SW-{{ $now.toFormat('yyyy') }}-{{ $json.deal_id }}",
      "valid_until": "={{ $now.plus({ days: 14 }).toISODate() }}",
      "currency": "USD"
    },
    "client": {
      "name": "={{ $json.contact_name }}",
      "company": "={{ $json.company }}",
      "email": "={{ $json.email }}"
    },
    "prepared_by": { "name": "Antoine Martin", "email": "antoine@singularweb.ai" }
  }
}
```

The response contains `url`. Store it on the GHL opportunity and send it in your email or WhatsApp step.

## Receiving events (Webhook trigger node)

1. Add a Webhook node (POST), copy its production URL.
2. Set it as the worker secret: `npx wrangler secret put WEBHOOK_URL`
3. Add a Switch node on `{{ $json.body.event }}`:
   - `proposal.viewed`: notify yourself, start a follow-up timer
   - `proposal.pricing_viewed`: high-intent signal, good trigger for a same-day follow-up
   - `proposal.accepted`: update the GHL pipeline stage, create the invoice, send onboarding

Client identity for routing is in `body.proposal.client_email` and `body.proposal.client_company`.

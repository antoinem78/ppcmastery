# Proposal Engine

Self-hosted alternative to PandaDoc for proposal generation, delivery, engagement tracking, and acceptance. Runs on Cloudflare Workers with D1 (SQLite), so it fits in Cloudflare's free tier with nothing else to maintain.

What it does:

- Creates proposals from JSON merge data via a token-protected API (callable from n8n, GHL, or curl)
- Serves each proposal at an unguessable URL with a polished, print-ready document design
- Tracks opens, per-section reading time, scroll depth, and pricing views
- Records acceptance (typed name, checkbox, timestamp, IP) and flips the proposal status
- Fires webhooks to n8n on first view, first pricing view, and acceptance
- Ships a minimal admin dashboard at `/admin` with engagement stats per proposal

What it deliberately does not do: qualified electronic signatures. The acceptance flow here is a click-wrap record (name, timestamp, IP, user agent), which is fine for service proposals and statements of work. For contracts where you want a court-grade signature trail (ESIGN, eIDAS), send the accepted client to a dedicated signing step. Documenso is open source and self-hostable if you want to stay off SaaS entirely.

## Deploy (about 10 minutes)

Prerequisites: a Cloudflare account and Node 18+.

```bash
npm install

# 1. Create the database, then copy the printed database_id
#    into wrangler.jsonc (replacing REPLACE_AFTER_D1_CREATE)
npx wrangler d1 create proposal-engine

# 2. Apply the schema to the remote database
npm run db:schema

# 3. Set your secrets
npx wrangler secret put API_TOKEN      # any long random string, this protects /api/*
npx wrangler secret put WEBHOOK_URL    # optional, your n8n webhook URL

# 4. Deploy
npm run deploy
```

After the first deploy, set `APP_URL` in `wrangler.jsonc` to your workers.dev URL (or a custom domain like `docs.singularweb.ai` added via the Cloudflare dashboard) and deploy again. `APP_URL` is only used to build the links returned by the API.

Local development:

```bash
npm run db:schema:local
echo 'API_TOKEN=dev-secret-token' > .dev.vars
npm run dev        # http://localhost:8787
npm test           # runs the full end-to-end suite in Node, no server needed
```

## Creating a proposal

`POST /api/proposals` with `Authorization: Bearer <API_TOKEN>`:

```json
{
  "expires_at": "2026-07-31",
  "data": {
    "brand":       { "name": "SingularWeb", "accent": "#2733C9", "website": "singularweb.ai" },
    "proposal":    { "title": "Google Ads Growth Engine", "number": "SW-2026-014", "valid_until": "2026-07-31", "currency": "USD" },
    "client":      { "name": "Sarah Chen", "company": "Meridian Dental Group", "email": "sarah@example.com" },
    "prepared_by": { "name": "Antoine Martin", "title": "Performance Marketing Lead", "email": "antoine@singularweb.ai" },
    "intro":       "Plain text. Blank lines become paragraphs.",
    "goals":       ["First objective", "Second objective"],
    "scope": [
      { "title": "Work stream", "description": "What it covers.", "deliverables": ["Item one", "Item two"] }
    ],
    "timeline": [
      { "phase": "Week 1", "title": "Phase name", "description": "What happens." }
    ],
    "pricing": {
      "items": [
        { "label": "Setup", "detail": "One-time", "amount": 2400, "period": "once" },
        { "label": "Management", "detail": "Cancel with 30 days notice", "amount": 1200, "period": "monthly" },
        { "label": "Ad spend", "detail": "Paid directly to Google", "amount": "Billed by Google" }
      ],
      "notes": "Optional small print under the table."
    },
    "terms": ["Term one.", "Term two."],
    "accept": { "enabled": true, "button": "Accept proposal", "note": "Optional lede above the form." }
  }
}
```

Response: `{ "id": "...", "slug": "...", "url": "https://your-domain/p/<slug>" }`. Send that URL to the client.

Notes on the data contract:

- Every section is optional. Sections with no data simply do not render, and the side navigation adjusts.
- `brand.accent` sets the accent color per proposal, so you can match a client's brand or run different colors for SingularWeb, DentalMastery, and so on.
- Numeric pricing amounts with `period` of `once` or `monthly` are summed into totals automatically. String amounts (like a percentage of ad spend) display as-is and are excluded from totals.
- `currency` accepts any ISO code (USD, EUR, AED, GBP).
- All merge values are HTML-escaped, so client-supplied text cannot inject markup.
- `expires_at` (or `proposal.valid_until` as fallback) shows a validity date, then an expired banner past that date, and blocks acceptance with HTTP 410.

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/proposals` | Bearer | Create a proposal, returns the shareable URL |
| GET | `/api/proposals?limit=50` | Bearer | List proposals with status, views, last activity |
| GET | `/api/proposals/:id` | Bearer | Full detail: event timeline plus per-section reading time (accepts id or slug) |
| POST | `/api/proposals/:id/status` | Bearer | Manually set status (`declined`, `expired`, and so on) to void a link |
| GET | `/admin` | Token entered in browser | Read-only dashboard |
| GET | `/p/:slug` | Public (unguessable) | The proposal page |
| POST | `/p/:slug/e` | Public | Tracking beacon (used by the page itself) |
| POST | `/p/:slug/accept` | Public | Acceptance endpoint (used by the page itself) |

## Webhooks to n8n

If `WEBHOOK_URL` is set, the worker POSTs JSON on three events:

- `proposal.viewed` (first open only)
- `proposal.pricing_viewed` (first time the investment section is seen)
- `proposal.accepted`

Payload shape:

```json
{
  "event": "proposal.accepted",
  "at": "2026-07-08T09:30:00.000Z",
  "proposal": {
    "id": "...", "slug": "...", "url": "...", "status": "accepted",
    "title": "...", "number": "SW-2026-014",
    "client_name": "Sarah Chen", "client_company": "Meridian Dental Group", "client_email": "sarah@example.com"
  },
  "meta": { "name": "Sarah Chen", "ip": "..." }
}
```

Typical n8n flow: Webhook trigger, then a Switch on `event`, then GHL contact update, Slack or WhatsApp notification, and invoice creation on `proposal.accepted`. See `examples/` for a create-proposal HTTP node config.

## Tracking details

The proposal page embeds a small script (no cookies, no third-party requests) that reports:

- `section_view`: first time each section is at least 35 percent visible
- `section_time`: accumulated seconds per section, flushed when the tab hides or closes
- `pricing_viewed`: first sight of the investment section
- `scroll_depth`: 25, 50, 75, 100 percent milestones
- `pdf_download`: clicks on the Download as PDF button (which uses the print stylesheet)

The `/api/proposals/:id` endpoint aggregates reading time per section across all visits, which is the closest thing to knowing what a prospect actually cared about.

## Extending

- New templates: add a file in `src/templates/`, register it in the `TEMPLATES` map in `src/index.js`, and pass `"template": "yourname"` on create.
- True PDF generation server-side would need Cloudflare Browser Rendering (paid) or an external renderer; the print stylesheet covers the common case.
- Rate limiting is not implemented in v1. The public endpoints validate slugs and event types, and slugs are 14 characters of high-entropy alphabet, but if a proposal link leaks you can void it via the status endpoint.

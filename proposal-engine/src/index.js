import { Hono } from 'hono';
import { newSlug, clientIp, isExpired, sha256Hex } from './util.js';
import { sendWebhook } from './webhook.js';
import { renderProposal } from './templates/proposal.js';
import { renderAdmin } from './admin.js';

const TEMPLATES = { proposal: renderProposal };
const EVENT_TYPES = new Set(['section_view', 'section_time', 'pricing_viewed', 'scroll_depth', 'pdf_download']);

const app = new Hono();

// ---------- Auth middleware for the private API ----------

const requireToken = async (c, next) => {
  const token = c.env.API_TOKEN;
  if (!token) return c.json({ error: 'API_TOKEN is not configured on the server' }, 500);
  const header = c.req.header('authorization') || '';
  if (header !== `Bearer ${token}`) return c.json({ error: 'Unauthorized' }, 401);
  await next();
};

// ---------- Private API (called from n8n, GHL, curl) ----------

// Create a proposal. Body: { template?, data, expires_at? }
app.post('/api/proposals', requireToken, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Body must be JSON' }, 400);
  }
  const template = body.template || 'proposal';
  if (!TEMPLATES[template]) return c.json({ error: `Unknown template "${template}"` }, 400);
  if (!body.data || typeof body.data !== 'object') return c.json({ error: 'Missing "data" object' }, 400);
  if (!body.data.proposal?.title) return c.json({ error: 'data.proposal.title is required' }, 400);
  if (!body.data.client?.company && !body.data.client?.name) {
    return c.json({ error: 'data.client.company or data.client.name is required' }, 400);
  }

  const id = crypto.randomUUID();
  const slug = newSlug();
  const expiresAt = body.expires_at || body.data.proposal?.valid_until || null;

  await c.env.DB.prepare(
    `INSERT INTO proposals (id, slug, template, data, status, expires_at) VALUES (?, ?, ?, ?, 'sent', ?)`
  ).bind(id, slug, template, JSON.stringify(body.data), expiresAt).run();

  return c.json({ id, slug, url: `${c.env.APP_URL}/p/${slug}` }, 201);
});

// List proposals with engagement stats.
app.get('/api/proposals', requireToken, async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.template, p.status, p.created_at, p.first_viewed_at, p.accepted_at,
            p.accepted_name, p.expires_at, p.data,
            (SELECT COUNT(*) FROM events e WHERE e.proposal_id = p.id AND e.type = 'view') AS views,
            (SELECT MAX(created_at) FROM events e WHERE e.proposal_id = p.id) AS last_activity
     FROM proposals p ORDER BY p.created_at DESC LIMIT ?`
  ).bind(limit).all();

  const items = results.map((r) => {
    let d = {};
    try { d = JSON.parse(r.data); } catch {}
    return {
      id: r.id,
      slug: r.slug,
      url: `${c.env.APP_URL}/p/${r.slug}`,
      status: isExpired(r) ? 'expired' : r.status,
      title: d?.proposal?.title || '',
      number: d?.proposal?.number || '',
      client_company: d?.client?.company || '',
      client_name: d?.client?.name || '',
      created_at: r.created_at,
      first_viewed_at: r.first_viewed_at,
      accepted_at: r.accepted_at,
      accepted_name: r.accepted_name,
      expires_at: r.expires_at,
      views: r.views,
      last_activity: r.last_activity,
    };
  });
  return c.json({ proposals: items });
});

// Full detail: proposal + event timeline + per-section reading time.
app.get('/api/proposals/:id', requireToken, async (c) => {
  const id = c.req.param('id');
  const p = await c.env.DB.prepare(`SELECT * FROM proposals WHERE id = ? OR slug = ?`).bind(id, id).first();
  if (!p) return c.json({ error: 'Not found' }, 404);

  const { results: events } = await c.env.DB.prepare(
    `SELECT type, meta, ip, ua, created_at FROM events WHERE proposal_id = ? ORDER BY created_at ASC, id ASC LIMIT 500`
  ).bind(p.id).all();

  // Aggregate reading time per section across all visits.
  const readingTime = {};
  for (const e of events) {
    if (e.type !== 'section_time') continue;
    try {
      const seconds = JSON.parse(e.meta || '{}').seconds || {};
      for (const [section, s] of Object.entries(seconds)) {
        readingTime[section] = (readingTime[section] || 0) + Number(s || 0);
      }
    } catch {}
  }

  let data = {};
  try { data = JSON.parse(p.data); } catch {}

  return c.json({
    id: p.id,
    slug: p.slug,
    url: `${c.env.APP_URL}/p/${p.slug}`,
    template: p.template,
    status: isExpired(p) ? 'expired' : p.status,
    created_at: p.created_at,
    first_viewed_at: p.first_viewed_at,
    accepted_at: p.accepted_at,
    accepted_name: p.accepted_name,
    accepted_ip: p.accepted_ip,
    expires_at: p.expires_at,
    data,
    reading_time_seconds: readingTime,
    events: events.map((e) => ({ ...e, meta: safeParse(e.meta) })),
  });
});

// Manually change status (e.g. mark declined, or void a link).
app.post('/api/proposals/:id/status', requireToken, async (c) => {
  const allowed = new Set(['sent', 'viewed', 'accepted', 'declined', 'expired']);
  const id = c.req.param('id');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Body must be JSON' }, 400); }
  if (!allowed.has(body.status)) return c.json({ error: 'Invalid status' }, 400);
  const res = await c.env.DB.prepare(`UPDATE proposals SET status = ? WHERE id = ? OR slug = ?`)
    .bind(body.status, id, id).run();
  if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true, status: body.status });
});

// ---------- Admin dashboard (token entered in browser, stored locally) ----------

app.get('/admin', (c) => c.html(renderAdmin()));

// ---------- Public proposal routes ----------

app.get('/p/:slug', async (c) => {
  const slug = c.req.param('slug');
  const p = await c.env.DB.prepare(`SELECT * FROM proposals WHERE slug = ?`).bind(slug).first();
  if (!p) return c.text('Not found', 404);

  const expired = isExpired(p);
  let data = {};
  try { data = JSON.parse(p.data); } catch {}

  const render = TEMPLATES[p.template] || renderProposal;
  const html = render({ proposal: p, data, expired });

  // Record the view and fire the first-view webhook without blocking the response.
  const ip = clientIp(c);
  const ua = c.req.header('user-agent') || '';
  c.executionCtx.waitUntil((async () => {
    await c.env.DB.prepare(`INSERT INTO events (proposal_id, type, meta, ip, ua) VALUES (?, 'view', '{}', ?, ?)`)
      .bind(p.id, ip, ua).run();
    if (!p.first_viewed_at) {
      await c.env.DB.prepare(
        `UPDATE proposals SET first_viewed_at = datetime('now'),
         status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE id = ?`
      ).bind(p.id).run();
      await sendWebhook(c.env, 'proposal.viewed', p, { ip, ua });
    }
  })());

  return c.html(html);
});

// Tracking beacon.
app.post('/p/:slug/e', async (c) => {
  const slug = c.req.param('slug');
  const p = await c.env.DB.prepare(`SELECT id, slug, data, status FROM proposals WHERE slug = ?`).bind(slug).first();
  if (!p) return c.json({ error: 'Not found' }, 404);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Body must be JSON' }, 400); }
  if (!EVENT_TYPES.has(body.type)) return c.json({ error: 'Unknown event type' }, 400);

  const meta = JSON.stringify(body.meta || {}).slice(0, 4000);
  const ip = clientIp(c);
  const ua = (c.req.header('user-agent') || '').slice(0, 500);

  await c.env.DB.prepare(`INSERT INTO events (proposal_id, type, meta, ip, ua) VALUES (?, ?, ?, ?, ?)`)
    .bind(p.id, body.type, meta, ip, ua).run();

  // First time pricing is viewed → notify n8n.
  if (body.type === 'pricing_viewed') {
    const prior = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE proposal_id = ? AND type = 'pricing_viewed'`
    ).bind(p.id).first();
    if (Number(prior.n) === 1) {
      c.executionCtx.waitUntil(sendWebhook(c.env, 'proposal.pricing_viewed', p, { ip }));
    }
  }
  return c.json({ ok: true });
});

// Acceptance.
app.post('/p/:slug/accept', async (c) => {
  const slug = c.req.param('slug');
  const p = await c.env.DB.prepare(`SELECT * FROM proposals WHERE slug = ?`).bind(slug).first();
  if (!p) return c.json({ error: 'Not found' }, 404);
  if (p.status === 'accepted') return c.json({ error: 'This proposal has already been accepted.' }, 409);
  if (p.status === 'declined') return c.json({ error: 'This proposal is no longer open for acceptance.' }, 409);
  if (isExpired(p)) return c.json({ error: 'This proposal has expired.' }, 410);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Body must be JSON' }, 400); }
  const name = String(body.name || '').trim().slice(0, 200);
  if (name.length < 2 || body.agree !== true) {
    return c.json({ error: 'A full name and confirmation are required.' }, 400);
  }

  const ip = clientIp(c);
  const ua = (c.req.header('user-agent') || '').slice(0, 500);
  // Seal the exact agreed content into the acceptance record (tamper evidence).
  const docSha256 = await sha256Hex(p.data || '');

  await c.env.DB.prepare(
    `UPDATE proposals SET status = 'accepted', accepted_at = datetime('now'), accepted_name = ?, accepted_ip = ? WHERE id = ?`
  ).bind(name, ip, p.id).run();
  await c.env.DB.prepare(
    `INSERT INTO events (proposal_id, type, meta, ip, ua) VALUES (?, 'accepted', ?, ?, ?)`
  ).bind(p.id, JSON.stringify({ name, doc_sha256: docSha256 }), ip, ua).run();

  c.executionCtx.waitUntil(sendWebhook(c.env, 'proposal.accepted', { ...p, status: 'accepted' }, { name, ip, doc_sha256: docSha256 }));
  return c.json({ ok: true });
});

app.get('/', (c) => c.redirect('/admin'));

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

export default app;

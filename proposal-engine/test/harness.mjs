// End-to-end tests for the proposal engine, run directly against the Hono app
// with a real SQLite database standing in for D1. Run: node test/harness.mjs

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import app from '../src/index.js';

// ---- D1 shim over node:sqlite ----
function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...params) {
          const p = params.map((x) => (x === undefined ? null : x));
          return {
            async run() {
              const r = db.prepare(sql).run(...p);
              return { meta: { changes: r.changes } };
            },
            async first() {
              return db.prepare(sql).get(...p) ?? null;
            },
            async all() {
              return { results: db.prepare(sql).all(...p) };
            },
          };
        },
      };
    },
  };
}

// ---- Webhook capture ----
const webhooks = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('n8n.example')) {
    webhooks.push(JSON.parse(init.body));
    return new Response('ok');
  }
  return realFetch(url, init);
};

const env = {
  DB: makeD1(),
  API_TOKEN: 'test-token',
  WEBHOOK_URL: 'https://n8n.example/webhook/proposals',
  APP_URL: 'https://docs.example.com',
};

// executionCtx that lets us await background work deterministically.
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} };
const flush = async () => { await Promise.all(pending.splice(0)); };

const req = (path, init = {}) => app.request(path, init, env, ctx);
const authed = (path, init = {}) =>
  req(path, { ...init, headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', ...(init.headers || {}) } });

const proposalData = JSON.parse(readFileSync(new URL('../examples/sample-proposal.json', import.meta.url), 'utf8'));

let pass = 0;
const ok = (name) => { pass++; console.log('  ✓', name); };

// ---- 1. Auth ----
{
  const r = await req('/api/proposals', { method: 'POST', body: '{}' });
  assert.equal(r.status, 401); ok('rejects missing token (401)');
  const r2 = await authed('/api/proposals', { method: 'POST', body: JSON.stringify({ data: {} }) });
  assert.equal(r2.status, 400); ok('rejects incomplete data (400)');
}

// ---- 2. Create ----
let slug, id;
{
  const r = await authed('/api/proposals', { method: 'POST', body: JSON.stringify(proposalData) });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.match(j.url, /^https:\/\/docs\.example\.com\/p\/[2-9a-zA-Z]{14}$/);
  ({ slug, id } = j);
  ok('creates proposal, returns unguessable URL');
}

// ---- 3. Public page render + first-view webhook ----
{
  const r = await req(`/p/${slug}`, { headers: { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'TestBrowser/1.0' } });
  assert.equal(r.status, 200);
  const html = await r.text();
  writeFileSync('/tmp/rendered.html', html);
  for (const needle of [
    'Meridian Dental Group', 'Google Ads Growth Engine', 'WMI-2026-014',
    'Tracking foundation', 'One-time total', '$2,400', 'Monthly total', '$1,200',
    'Billed by Google', 'Accept proposal', 'Space Grotesk',
  ]) assert.ok(html.includes(needle), `page missing: ${needle}`);
  assert.ok(!html.includes('<div class="expired-banner">'), 'no expired banner on live proposal');
  await flush();
  assert.equal(webhooks.length, 1);
  assert.equal(webhooks[0].event, 'proposal.viewed');
  assert.equal(webhooks[0].proposal.client_company, 'Meridian Dental Group');
  ok('renders page with correct merge fields and pricing totals');
  ok('fires proposal.viewed webhook with client context');

  // Second view: no duplicate webhook.
  await req(`/p/${slug}`); await flush();
  assert.equal(webhooks.length, 1); ok('second view does not re-fire webhook');
}

// ---- 4. Tracking events ----
{
  const send = (body) => req(`/p/${slug}/e`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send({ type: 'hack_attempt' })).status, 400); ok('rejects unknown event type');
  assert.equal((await send({ type: 'section_view', meta: { section: 'scope' } })).status, 200);
  assert.equal((await send({ type: 'pricing_viewed' })).status, 200);
  await flush();
  assert.equal(webhooks.length, 2);
  assert.equal(webhooks[1].event, 'proposal.pricing_viewed'); ok('first pricing view fires webhook');
  await send({ type: 'pricing_viewed' }); await flush();
  assert.equal(webhooks.length, 2); ok('repeat pricing view does not re-fire webhook');
  await send({ type: 'section_time', meta: { seconds: { overview: 12, investment: 45 } } });
  await send({ type: 'section_time', meta: { seconds: { investment: 30 } } });
}

// ---- 5. Detail endpoint aggregates ----
{
  const j = await (await authed(`/api/proposals/${id}`)).json();
  assert.equal(j.status, 'viewed');
  assert.equal(j.reading_time_seconds.investment, 75);
  assert.equal(j.reading_time_seconds.overview, 12);
  assert.ok(j.first_viewed_at); ok('detail endpoint aggregates reading time per section');
}

// ---- 6. Acceptance ----
{
  const accept = (body) => req(`/p/${slug}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await accept({ name: 'S', agree: true })).status, 400); ok('rejects too-short name');
  assert.equal((await accept({ name: 'Sarah Chen', agree: false })).status, 400); ok('rejects missing agreement');
  const r = await accept({ name: 'Sarah Chen', agree: true });
  assert.equal(r.status, 200); await flush();
  assert.equal(webhooks[2].event, 'proposal.accepted');
  assert.equal(webhooks[2].meta.name, 'Sarah Chen'); ok('acceptance recorded, webhook fired');
  assert.equal((await accept({ name: 'Sarah Chen', agree: true })).status, 409); ok('double acceptance blocked (409)');

  const html = await (await req(`/p/${slug}`)).text();
  assert.ok(html.includes('accepted-stamp') && html.includes('Sarah Chen'), 'accepted page shows stamp');
  assert.ok(!html.includes('id="accept-btn"'), 'accept button gone after acceptance');
  writeFileSync('/tmp/rendered-accepted.html', html);
  ok('re-rendered page shows acceptance stamp instead of form');

  const list = await (await authed('/api/proposals')).json();
  assert.equal(list.proposals[0].status, 'accepted');
  assert.equal(list.proposals[0].views, 3); ok('list endpoint reflects status and view count');
}

// ---- 7. Expiry ----
{
  const expired = structuredClone(proposalData);
  expired.expires_at = '2026-01-01';
  expired.data.proposal.valid_until = '2026-01-01';
  const j = await (await authed('/api/proposals', { method: 'POST', body: JSON.stringify(expired) })).json();
  const html = await (await req(`/p/${j.slug}`)).text();
  assert.ok(html.includes('<div class="expired-banner">'), 'expired banner shown');
  assert.ok(!html.includes('id="accept-btn"'), 'no accept button on expired proposal');
  const r = await req(`/p/${j.slug}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sarah Chen', agree: true }) });
  assert.equal(r.status, 410); ok('expired proposal refuses acceptance (410)');
}

// ---- 8. XSS safety ----
{
  const evil = structuredClone(proposalData);
  evil.data.client.company = '<script>alert(1)</script>';
  evil.data.proposal.title = 'Test "quotes" & <tags>';
  const j = await (await authed('/api/proposals', { method: 'POST', body: JSON.stringify(evil) })).json();
  const html = await (await req(`/p/${j.slug}`)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script tag escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  ok('merge fields are HTML-escaped (XSS safe)');
}

// ---- 9. 404s ----
{
  assert.equal((await req('/p/doesnotexist123')).status, 404);
  assert.equal((await authed('/api/proposals/nope')).status, 404);
  ok('unknown slugs and ids return 404');
}

console.log(`\nAll ${pass} checks passed.`);

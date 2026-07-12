// Default proposal template.
// Renders merge data into a complete tracked proposal page.
// Data contract is documented in README.md (all sections optional except client + proposal.title).

import { esc, paragraphs, money, fmtDate } from '../util.js';

export function renderProposal({ proposal, data, expired }) {
  const brand = data.brand || {};
  const meta = data.proposal || {};
  const client = data.client || {};
  const by = data.prepared_by || {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(brand.accent || '') ? brand.accent : '#2733C9';
  const currency = meta.currency || 'USD';
  const accepted = proposal.status === 'accepted';
  const canAccept = !accepted && !expired && (data.accept?.enabled ?? true);

  // ---- Section builders (each returns '' when its data is absent) ----

  const sections = [];
  const nav = [];
  const addSection = (id, label, html) => {
    if (!html) return;
    nav.push({ id, label });
    sections.push(`<section class="doc-section" id="${id}" data-section="${id}">${html}</section>`);
  };

  if (data.intro) {
    addSection('overview', 'Overview', `
      <p class="eyebrow">Overview</p>
      <div class="prose">${paragraphs(data.intro)}</div>`);
  }

  if (Array.isArray(data.goals) && data.goals.length) {
    addSection('objectives', 'Objectives', `
      <p class="eyebrow">Objectives</p>
      <ul class="goals">
        ${data.goals.map((g) => `<li>${esc(g)}</li>`).join('\n')}
      </ul>`);
  }

  if (Array.isArray(data.scope) && data.scope.length) {
    addSection('scope', 'Scope of work', `
      <p class="eyebrow">Scope of work</p>
      <div class="scope-list">
        ${data.scope.map((s) => `
        <article class="scope-item">
          <h3>${esc(s.title)}</h3>
          ${s.description ? `<div class="prose small">${paragraphs(s.description)}</div>` : ''}
          ${Array.isArray(s.deliverables) && s.deliverables.length ? `
          <ul class="deliverables">
            ${s.deliverables.map((d) => `<li>${esc(d)}</li>`).join('\n')}
          </ul>` : ''}
        </article>`).join('\n')}
      </div>`);
  }

  if (Array.isArray(data.timeline) && data.timeline.length) {
    addSection('timeline', 'Timeline', `
      <p class="eyebrow">Timeline</p>
      <ol class="timeline">
        ${data.timeline.map((t, i) => `
        <li class="phase">
          <span class="phase-index">${String(i + 1).padStart(2, '0')}</span>
          <div class="phase-body">
            <p class="phase-when">${esc(t.phase || '')}</p>
            <h3>${esc(t.title || '')}</h3>
            ${t.description ? `<div class="prose small">${paragraphs(t.description)}</div>` : ''}
          </div>
        </li>`).join('\n')}
      </ol>`);
  }

  if (data.pricing && Array.isArray(data.pricing.items) && data.pricing.items.length) {
    const items = data.pricing.items;
    const periodLabel = { once: 'one-time', monthly: '/month', quarterly: '/quarter', yearly: '/year' };
    let onceTotal = 0, monthlyTotal = 0, hasOnce = false, hasMonthly = false;
    const rows = items.map((it) => {
      const numeric = typeof it.amount === 'number' && Number.isFinite(it.amount);
      if (numeric && it.period === 'once') { onceTotal += it.amount; hasOnce = true; }
      if (numeric && it.period === 'monthly') { monthlyTotal += it.amount; hasMonthly = true; }
      const amountHtml = numeric ? money(it.amount, currency) : esc(it.amount);
      const suffix = numeric && periodLabel[it.period] ? `<span class="per">${periodLabel[it.period]}</span>` : '';
      return `
        <tr>
          <td class="p-label">
            ${esc(it.label)}
            ${it.detail ? `<span class="p-detail">${esc(it.detail)}</span>` : ''}
          </td>
          <td class="p-amount">${amountHtml}${suffix}</td>
        </tr>`;
    }).join('\n');

    const totals = [
      hasOnce ? `<tr class="total"><td class="p-label">One-time total</td><td class="p-amount">${money(onceTotal, currency)}</td></tr>` : '',
      hasMonthly ? `<tr class="total"><td class="p-label">Monthly total</td><td class="p-amount">${money(monthlyTotal, currency)}<span class="per">/month</span></td></tr>` : '',
    ].join('\n');

    addSection('investment', 'Investment', `
      <p class="eyebrow">Investment</p>
      <table class="pricing">
        <tbody>${rows}${totals}</tbody>
      </table>
      ${data.pricing.notes ? `<div class="prose small pricing-notes">${paragraphs(data.pricing.notes)}</div>` : ''}`);
  }

  if (Array.isArray(data.terms) && data.terms.length) {
    addSection('terms', 'Terms', `
      <p class="eyebrow">Terms</p>
      <ol class="terms">
        ${data.terms.map((t) => `<li>${esc(t)}</li>`).join('\n')}
      </ol>`);
  }

  // ---- Acceptance block ----

  let acceptHtml = '';
  if (accepted) {
    acceptHtml = `
      <section class="doc-section" id="acceptance" data-section="acceptance">
        <div class="accepted-stamp">
          <p class="eyebrow">Accepted</p>
          <p class="stamp-name">${esc(proposal.accepted_name || '')}</p>
          <p class="stamp-meta">${fmtDate(proposal.accepted_at)} &middot; recorded electronically</p>
        </div>
      </section>`;
  } else if (expired) {
    acceptHtml = `
      <section class="doc-section" id="acceptance" data-section="acceptance">
        <div class="expired-note">
          <p class="eyebrow">Expired</p>
          <p>This proposal expired on ${fmtDate(proposal.expires_at)}. ${by.email ? `Write to <a href="mailto:${esc(by.email)}">${esc(by.email)}</a> to request an updated version.` : 'Contact us to request an updated version.'}</p>
        </div>
      </section>`;
  } else if (canAccept) {
    nav.push({ id: 'acceptance', label: 'Acceptance' });
    acceptHtml = `
      <section class="doc-section" id="acceptance" data-section="acceptance">
        <p class="eyebrow">Acceptance</p>
        <div class="accept-card" id="accept-card">
          <p class="accept-lede">${esc(data.accept?.note || `Ready to move forward? Accepting this proposal confirms the scope and investment above.`)}</p>
          <label class="field">
            <span>Full name</span>
            <input type="text" id="accept-name" autocomplete="name" placeholder="Your full name">
          </label>
          <label class="agree">
            <input type="checkbox" id="accept-agree">
            <span>I have authority to accept this proposal on behalf of ${esc(client.company || 'my company')}.</span>
          </label>
          <button type="button" id="accept-btn">${esc(data.accept?.button || 'Accept proposal')}</button>
          <p class="accept-fineprint">Acceptance is recorded with a timestamp and network address.</p>
          <p class="accept-error" id="accept-error" hidden></p>
        </div>
      </section>`;
  }

  // ---- Rail (document manifest) ----

  const statusLabel = accepted ? 'Accepted' : expired ? 'Expired' : 'Awaiting review';
  const statusClass = accepted ? 'ok' : expired ? 'dim' : 'live';
  const railMeta = [
    meta.number ? ['Proposal', meta.number] : null,
    client.company ? ['Prepared for', client.company] : null,
    by.name ? ['Prepared by', by.name] : null,
    meta.valid_until && !expired && !accepted ? ['Valid until', fmtDate(meta.valid_until)] : null,
  ].filter(Boolean);

  const clientScript = buildClientScript();
  const cfg = JSON.stringify({ slug: proposal.slug, canAccept });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(meta.title || 'Proposal')} · ${esc(brand.name || '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --accent: ${accent};
  --paper: #FAF9F6;
  --card: #FFFFFF;
  --ink: #151B26;
  --muted: #5B6272;
  --hairline: #E5E2D9;
  --rail-bg: #10151F;
  --rail-text: #B9C0CE;
  --rail-dim: #6B7385;
  --ok: #157F5F;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 16.5px;
  line-height: 1.65;
}
a { color: var(--accent); }

/* ---- Layout: rail + document ---- */
.layout { display: grid; grid-template-columns: 264px minmax(0, 1fr); min-height: 100vh; }
.rail {
  background: var(--rail-bg);
  color: var(--rail-text);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12.5px;
  padding: 40px 28px;
  position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column; gap: 28px;
}
.rail .brand { color: #fff; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 17px; letter-spacing: 0.01em; }
.rail dl { margin: 0; display: grid; gap: 14px; }
.rail dt { color: var(--rail-dim); text-transform: uppercase; letter-spacing: 0.14em; font-size: 10px; margin-bottom: 3px; }
.rail dd { margin: 0; color: var(--rail-text); }
.status { display: inline-flex; align-items: center; gap: 8px; }
.status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--rail-dim); }
.status.live .dot { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
.status.ok .dot { background: #2FBF8F; }
.rail-nav { margin-top: auto; display: grid; gap: 2px; }
.rail-nav a {
  color: var(--rail-dim); text-decoration: none; padding: 7px 10px; border-left: 2px solid transparent;
  transition: color .15s ease, border-color .15s ease;
}
.rail-nav a.seen { color: var(--rail-text); }
.rail-nav a.active { color: #fff; border-left-color: var(--accent); }
.rail-actions { display: grid; gap: 8px; }
.rail-actions button {
  font: inherit; color: var(--rail-text); background: transparent; border: 1px solid #2A3140;
  padding: 8px 10px; cursor: pointer; text-align: left; border-radius: 3px;
}
.rail-actions button:hover { border-color: var(--rail-dim); color: #fff; }

/* ---- Document column ---- */
.doc { padding: 72px clamp(28px, 7vw, 96px) 120px; max-width: 860px; }
.eyebrow {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--accent); margin: 0 0 18px;
}
.cover { padding-bottom: 48px; border-bottom: 1px solid var(--hairline); margin-bottom: 8px; }
.cover h1 {
  font-family: 'Space Grotesk', sans-serif; font-weight: 600;
  font-size: clamp(34px, 5vw, 52px); line-height: 1.08; letter-spacing: -0.015em; margin: 0 0 22px;
}
.cover .for { font-size: 19px; color: var(--muted); margin: 0; }
.cover .for strong { color: var(--ink); font-weight: 600; }
.doc-section { padding: 56px 0; border-bottom: 1px solid var(--hairline); }
.doc-section:last-of-type { border-bottom: 0; }
h2, h3 { font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.01em; }
h3 { font-size: 20px; font-weight: 600; margin: 0 0 10px; }
.prose p { margin: 0 0 1em; }
.prose p:last-child { margin-bottom: 0; }
.prose.small { font-size: 15.5px; color: var(--muted); }

.goals { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.goals li { padding-left: 26px; position: relative; font-weight: 500; }
.goals li::before {
  content: ''; position: absolute; left: 0; top: 9px; width: 12px; height: 6px;
  background: var(--accent); clip-path: polygon(0 100%, 50% 0, 100% 100%);
}

.scope-list { display: grid; gap: 20px; }
.scope-item { background: var(--card); border: 1px solid var(--hairline); border-radius: 6px; padding: 26px 28px; }
.deliverables { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 8px; font-size: 15.5px; }
.deliverables li { padding-left: 20px; position: relative; }
.deliverables li::before { content: ''; position: absolute; left: 0; top: 10px; width: 7px; height: 7px; background: color-mix(in srgb, var(--accent) 22%, white); border: 1px solid var(--accent); }

.timeline { list-style: none; margin: 0; padding: 0; }
.phase { display: grid; grid-template-columns: 56px 1fr; gap: 18px; position: relative; padding-bottom: 34px; }
.phase:last-child { padding-bottom: 0; }
.phase::before { content: ''; position: absolute; left: 27px; top: 34px; bottom: 6px; width: 1px; background: var(--hairline); }
.phase:last-child::before { display: none; }
.phase-index {
  font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--accent);
  width: 56px; height: 28px; display: grid; place-items: center;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, white); border-radius: 3px; background: var(--card);
}
.phase-when { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 4px 0 4px; }
.phase-body h3 { margin-bottom: 6px; }

.pricing { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--hairline); border-radius: 6px; overflow: hidden; }
.pricing td { padding: 18px 22px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
.pricing tr:last-child td { border-bottom: 0; }
.p-label { font-weight: 500; }
.p-detail { display: block; font-size: 14px; color: var(--muted); font-weight: 400; margin-top: 2px; }
.p-amount { text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.p-amount .per { color: var(--muted); font-size: 12.5px; margin-left: 4px; }
.pricing .total td { background: color-mix(in srgb, var(--accent) 5%, white); font-weight: 600; border-top: 2px solid var(--ink); }
.pricing .total .p-amount { font-size: 18px; }
.pricing-notes { margin-top: 16px; }

.terms { margin: 0; padding-left: 22px; display: grid; gap: 10px; font-size: 15px; color: var(--muted); }

.accept-card { background: var(--card); border: 1px solid var(--hairline); border-top: 3px solid var(--accent); border-radius: 6px; padding: 30px 32px; max-width: 560px; }
.accept-lede { margin: 0 0 22px; }
.field { display: grid; gap: 6px; margin-bottom: 16px; }
.field span { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.field input {
  font: inherit; padding: 11px 13px; border: 1px solid #C9C5B9; border-radius: 4px; background: var(--paper);
}
.field input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.agree { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; color: var(--muted); margin-bottom: 22px; }
.agree input { margin-top: 4px; accent-color: var(--accent); }
#accept-btn {
  font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; color: #fff;
  background: var(--accent); border: 0; border-radius: 4px; padding: 13px 26px; cursor: pointer; width: 100%;
}
#accept-btn:hover { filter: brightness(1.08); }
#accept-btn:disabled { opacity: .55; cursor: default; }
#accept-btn:focus-visible, .rail-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.accept-fineprint { font-size: 12.5px; color: var(--muted); margin: 14px 0 0; }
.accept-error { color: #B4232A; font-size: 14px; margin: 12px 0 0; }
.accepted-stamp { border: 1.5px solid var(--ok); border-radius: 6px; padding: 28px 32px; max-width: 560px; background: color-mix(in srgb, var(--ok) 4%, white); }
.accepted-stamp .eyebrow { color: var(--ok); }
.stamp-name { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 600; margin: 0 0 6px; }
.stamp-meta { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: var(--muted); margin: 0; }
.expired-note { border: 1px solid var(--hairline); border-radius: 6px; padding: 26px 30px; color: var(--muted); background: var(--card); max-width: 560px; }
.expired-note p { margin: 0; }
.expired-banner {
  font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; background: #F3E9D8; color: #7A5A17;
  padding: 12px clamp(28px, 7vw, 96px);
}
.doc-footer { margin-top: 72px; padding-top: 26px; border-top: 1px solid var(--hairline); font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }

/* ---- Mobile ---- */
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .rail { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding: 18px 22px; }
  .rail dl { display: flex; flex-wrap: wrap; gap: 4px 24px; }
  .rail-nav, .rail-actions { display: none; }
  .doc { padding: 44px 22px 90px; }
}

/* ---- Print ---- */
@media print {
  .rail, .rail-actions, .expired-banner { display: none !important; }
  .layout { display: block; }
  body { background: #fff; font-size: 12.5px; }
  .doc { max-width: none; padding: 0; }
  .doc-section { padding: 22px 0; }
  .scope-item, .pricing, .accept-card, .accepted-stamp { break-inside: avoid; }
  #accept-card { display: none; }
  a { color: inherit; text-decoration: none; }
}
</style>
</head>
<body>
${expired ? `<div class="expired-banner">This proposal expired on ${fmtDate(proposal.expires_at)}.</div>` : ''}
<div class="layout">
  <aside class="rail" aria-label="Document information">
    <div class="brand">${esc(brand.name || 'Proposal')}</div>
    <dl>
      ${railMeta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
      <div><dt>Status</dt><dd><span class="status ${statusClass}"><span class="dot"></span>${statusLabel}</span></dd></div>
    </dl>
    <nav class="rail-nav" id="rail-nav" aria-label="Sections">
      ${nav.map((n) => `<a href="#${n.id}" data-for="${n.id}">${esc(n.label)}</a>`).join('\n')}
    </nav>
    <div class="rail-actions">
      <button type="button" id="pdf-btn">Download as PDF</button>
    </div>
  </aside>

  <main class="doc">
    <header class="cover">
      <p class="eyebrow">${esc(meta.number ? `Proposal ${meta.number}` : 'Proposal')}</p>
      <h1>${esc(meta.title || 'Proposal')}</h1>
      <p class="for">Prepared for <strong>${esc(client.company || client.name || '')}</strong>${client.name && client.company ? `, attention of ${esc(client.name)}` : ''}</p>
    </header>

    ${sections.join('\n')}
    ${acceptHtml}

    <footer class="doc-footer">
      <span>${esc(brand.name || '')}${brand.website ? ` · ${esc(brand.website)}` : ''}</span>
      <span>${esc(meta.number || '')}</span>
    </footer>
  </main>
</div>

<script>
var CFG = ${cfg};
${clientScript}
</script>
</body>
</html>`;
}

// Client-side tracking + acceptance. Plain ES5-ish, no template literals,
// so it nests safely inside the server-side template string.
function buildClientScript() {
  return `
(function () {
  var endpoint = '/p/' + CFG.slug + '/e';
  function send(type, meta) {
    var body = JSON.stringify({ type: type, meta: meta || {} });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    }
  }

  // Section visibility: first-view events + accumulated reading time.
  var seen = {};
  var timers = {};   // sectionId -> total ms
  var openedAt = {}; // sectionId -> timestamp while visible
  var sections = document.querySelectorAll('[data-section]');
  var navLinks = document.querySelectorAll('#rail-nav a');

  function markNav(id, state) {
    for (var i = 0; i < navLinks.length; i++) {
      var a = navLinks[i];
      if (a.getAttribute('data-for') === id) {
        if (state === 'active') a.classList.add('active', 'seen');
      } else if (state === 'active') {
        a.classList.remove('active');
      }
    }
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.getAttribute('data-section');
        if (entry.isIntersecting) {
          openedAt[id] = Date.now();
          markNav(id, 'active');
          if (!seen[id]) {
            seen[id] = true;
            send('section_view', { section: id });
            if (id === 'investment') send('pricing_viewed', {});
          }
        } else if (openedAt[id]) {
          timers[id] = (timers[id] || 0) + (Date.now() - openedAt[id]);
          delete openedAt[id];
        }
      });
    }, { threshold: 0.35 });
    for (var i = 0; i < sections.length; i++) io.observe(sections[i]);
  }

  // Scroll depth milestones.
  var milestones = [25, 50, 75, 100];
  var hit = {};
  window.addEventListener('scroll', function () {
    var h = document.documentElement;
    var depth = Math.round(((h.scrollTop + window.innerHeight) / h.scrollHeight) * 100);
    milestones.forEach(function (m) {
      if (depth >= m && !hit[m]) { hit[m] = true; send('scroll_depth', { percent: m }); }
    });
  }, { passive: true });

  // Flush reading time when the tab is hidden or closed.
  function flush() {
    var now = Date.now();
    for (var id in openedAt) {
      timers[id] = (timers[id] || 0) + (now - openedAt[id]);
      openedAt[id] = now;
    }
    var out = {};
    var any = false;
    for (var k in timers) {
      var s = Math.round(timers[k] / 1000);
      if (s >= 1) { out[k] = s; any = true; }
    }
    if (any) send('section_time', { seconds: out });
    timers = {};
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  // PDF button.
  var pdfBtn = document.getElementById('pdf-btn');
  if (pdfBtn) pdfBtn.addEventListener('click', function () { send('pdf_download', {}); window.print(); });

  // Acceptance flow.
  var btn = document.getElementById('accept-btn');
  if (btn && CFG.canAccept) {
    btn.addEventListener('click', function () {
      var name = (document.getElementById('accept-name').value || '').trim();
      var agree = document.getElementById('accept-agree').checked;
      var errEl = document.getElementById('accept-error');
      errEl.hidden = true;
      if (name.length < 2) { errEl.textContent = 'Please enter your full name.'; errEl.hidden = false; return; }
      if (!agree) { errEl.textContent = 'Please confirm you have authority to accept.'; errEl.hidden = false; return; }
      btn.disabled = true;
      btn.textContent = 'Recording acceptance…';
      fetch('/p/' + CFG.slug + '/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name, agree: true })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || 'Could not record acceptance.');
          var card = document.getElementById('accept-card');
          card.outerHTML = '<div class="accepted-stamp"><p class="eyebrow" style="color:var(--ok)">Accepted</p>' +
            '<p class="stamp-name"></p><p class="stamp-meta">Just now &middot; recorded electronically</p></div>';
          document.querySelector('#acceptance .stamp-name').textContent = name;
          var status = document.querySelector('.status');
          if (status) { status.className = 'status ok'; status.innerHTML = '<span class="dot"></span>Accepted'; }
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = 'Accept proposal';
          errEl.textContent = e.message;
          errEl.hidden = false;
        });
    });
  }
})();
`;
}

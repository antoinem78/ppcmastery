// Fire-and-forget webhook to n8n (or any endpoint). Never throws.

// When WEBHOOK_SECRET is set, receivers can verify authenticity by comparing
// the X-Signature header against hex(HMAC-SHA256(secret, raw body)).
async function signBody(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sendWebhook(env, event, proposal, meta = {}) {
  if (!env.WEBHOOK_URL) return;
  let data = {};
  try {
    data = JSON.parse(proposal.data || '{}');
  } catch {}
  const payload = {
    event, // proposal.viewed | proposal.pricing_viewed | proposal.accepted
    at: new Date().toISOString(),
    proposal: {
      id: proposal.id,
      slug: proposal.slug,
      url: `${env.APP_URL}/p/${proposal.slug}`,
      status: proposal.status,
      title: data?.proposal?.title || '',
      number: data?.proposal?.number || '',
      client_name: data?.client?.name || '',
      client_company: data?.client?.company || '',
      client_email: data?.client?.email || '',
    },
    meta,
  };
  try {
    const body = JSON.stringify(payload);
    const headers = { 'content-type': 'application/json' };
    if (env.WEBHOOK_SECRET) headers['x-signature'] = await signBody(env.WEBHOOK_SECRET, body);
    await fetch(env.WEBHOOK_URL, { method: 'POST', headers, body });
  } catch (err) {
    console.log('webhook failed', String(err));
  }
}

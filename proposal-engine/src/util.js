// Shared helpers

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/l/i

export function newSlug(length = 14) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Split plain text into escaped <p> paragraphs on blank lines.
export function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replaceAll('\n', '<br>')}</p>`)
    .join('\n');
}

export function money(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return esc(String(amount ?? ''));
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: n % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString('en-US')}`;
  }
}

// SHA-256 hex of a string. Seals the exact document content into the
// acceptance record so the agreed text is tamper-evident after the fact.
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(c) {
  return (
    c.req.header('cf-connecting-ip') ||
    (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
    ''
  );
}

export function isExpired(proposal) {
  if (!proposal.expires_at || proposal.status === 'accepted') return false;
  const exp = new Date(proposal.expires_at);
  if (Number.isNaN(exp.getTime())) return false;
  // Treat a bare date as end of that day, UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(proposal.expires_at)) {
    exp.setUTCHours(23, 59, 59, 999);
  }
  return Date.now() > exp.getTime();
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

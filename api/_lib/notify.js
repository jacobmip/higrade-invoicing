// /api/_lib/notify.js — server-side notification fan-out.
//
// Two responsibilities:
//   1. insertNotification(): write a row into the public.notifications table
//      so the bell icon in the web/Capacitor app shows it.
//   2. pushToAllDevices(): grab every registered APNs token and send a
//      silent-or-alert push so the phone wakes the user.
//
// The combined helper notifyAll() does both. Callers pass a single payload
// object — see paypal-webhook.js / paypal-capture-order.js for usage.
//
// Required env vars:
//   SUPABASE_URL                 (or hard-coded fallback)
//   SUPABASE_SERVICE_ROLE_KEY    (writes to notifications + reads device_tokens)
//   APNS_KEY_ID                  (10-char Apple Developer key ID)
//   APNS_TEAM_ID                 (10-char Apple Developer team ID)
//   APNS_BUNDLE_ID               (defaults to com.higradeplumbing.invoicing)
//   APNS_KEY_P8                  (raw .p8 file contents, BEGIN/END lines included)
//   APNS_ENV                     ('production' or 'sandbox', default 'production')
//
// If APNS_* are not set, the push step no-ops with a console.warn — the
// notification still gets written to the table so the in-app bell works
// regardless. This means you can ship the table + UI today and turn on
// real push later by dropping a key into Vercel env.

import crypto from 'node:crypto';

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
            || process.env.VITE_SUPABASE_ANON_KEY
            || process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('Supabase key not configured');
  return {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=representation',
  };
}

function supabaseUrl() {
  return process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
}

// ─── Notification table writes ────────────────────────────────────────────────

export async function insertNotification({ type, title, body, invoiceId, data }) {
  try {
    const res = await fetch(`${supabaseUrl()}/rest/v1/notifications`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        type,
        title,
        body,
        invoice_id: invoiceId || null,
        data: data || {},
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[notify] insertNotification failed:', res.status, text);
      return null;
    }
    const rows = await res.json();
    return rows?.[0] || null;
  } catch (e) {
    console.error('[notify] insertNotification error:', e);
    return null;
  }
}

// ─── APNs JWT (ES256) ─────────────────────────────────────────────────────────
// Apple wants a JWT signed with the .p8 EC key, valid <= 1 hour. We build it
// from scratch — no external apns library — so the function stays cold-start
// fast on Vercel.

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let cachedJwt = null;
let cachedJwtExpires = 0;

function buildApnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  // Re-use the JWT for ~50 minutes (Apple max is 60).
  if (cachedJwt && now < cachedJwtExpires - 600) return cachedJwt;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const p8 = process.env.APNS_KEY_P8;
  if (!keyId || !teamId || !p8) return null;

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  // .p8 is PEM-formatted; createSign accepts it directly.
  const sig = signer.sign({ key: p8, format: 'pem' });
  // Apple expects the JOSE-style raw r||s 64-byte signature, not the
  // ASN.1 DER that OpenSSL emits by default. Convert it.
  const joseSig = derToJose(sig, 64);
  cachedJwt = `${signingInput}.${base64url(joseSig)}`;
  cachedJwtExpires = now + 3600;
  return cachedJwt;
}

// Convert ASN.1 DER ECDSA signature to JOSE concat (r||s) format.
function derToJose(der, expectedLength) {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Bad DER signature');
  // Length byte (may be multi-byte if > 0x80)
  if (der[offset] & 0x80) offset += 1 + (der[offset] & 0x7f);
  else offset += 1;
  if (der[offset++] !== 0x02) throw new Error('Bad DER signature (r)');
  let rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error('Bad DER signature (s)');
  let sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);
  // Strip leading zeros
  while (r.length && r[0] === 0x00) r = r.slice(1);
  while (s.length && s[0] === 0x00) s = s.slice(1);
  const half = expectedLength / 2;
  const rPad = Buffer.concat([Buffer.alloc(half - r.length), r]);
  const sPad = Buffer.concat([Buffer.alloc(half - s.length), s]);
  return Buffer.concat([rPad, sPad]);
}

// ─── APNs HTTP/2 push ─────────────────────────────────────────────────────────
// We use the regular HTTP/1.1-style fetch against api.push.apple.com. APNs
// actually serves HTTP/2 only, but Node's undici fetch (Vercel Node runtime)
// negotiates h2 transparently for https://api.push.apple.com.

async function sendApnsPush({ token, title, body, data }) {
  const jwt = buildApnsJwt();
  if (!jwt) return { ok: false, skip: true, reason: 'APNS env not configured' };

  const env = (process.env.APNS_ENV || 'production').toLowerCase();
  const host = env === 'sandbox'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.higradeplumbing.invoicing';

  const payload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      'content-available': 1,
      'mutable-content': 1,
    },
    ...data,
  };

  try {
    const res = await fetch(`${host}/3/device/${token}`, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 200) return { ok: true };
    const text = await res.text();
    return { ok: false, status: res.status, error: text };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function listDeviceTokens() {
  try {
    const res = await fetch(
      `${supabaseUrl()}/rest/v1/device_tokens?select=token,platform&platform=eq.ios`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) {
      console.error('[notify] listDeviceTokens failed:', res.status, await res.text());
      return [];
    }
    return await res.json();
  } catch (e) {
    console.error('[notify] listDeviceTokens error:', e);
    return [];
  }
}

async function deleteDeviceToken(token) {
  try {
    await fetch(
      `${supabaseUrl()}/rest/v1/device_tokens?token=eq.${encodeURIComponent(token)}`,
      { method: 'DELETE', headers: supabaseHeaders() }
    );
  } catch (e) {
    console.error('[notify] deleteDeviceToken error:', e);
  }
}

export async function pushToAllDevices({ title, body, data }) {
  const tokens = await listDeviceTokens();
  if (!tokens.length) return { sent: 0, skipped: 0 };
  const results = await Promise.all(
    tokens.map(t => sendApnsPush({ token: t.token, title, body, data }))
  );
  let sent = 0, skipped = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.ok) sent++;
    else if (r.skip) skipped++;
    // 410 Gone or BadDeviceToken → the token is dead, prune it so we
    // don't keep retrying.
    else if (r.status === 410 || (r.error || '').includes('BadDeviceToken') || (r.error || '').includes('Unregistered')) {
      await deleteDeviceToken(tokens[i].token);
    } else {
      console.warn('[notify] push failed:', r.status, r.error);
    }
  }
  return { sent, skipped, total: tokens.length };
}

// One-call helper used by webhooks/endpoints.
export async function notifyAll({ type, title, body, invoiceId, data }) {
  const row = await insertNotification({ type, title, body, invoiceId, data });
  const push = await pushToAllDevices({ title, body, data: { type, invoiceId, ...(data || {}) } });
  return { notification: row, push };
}

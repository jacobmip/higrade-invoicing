// /api/track-open
// Logs an "opened" event when a recipient hits the public viewer page (/v/<token>).
// De-duped per (invoice_id, ip_hash) within a 1-hour window so a single visit
// reloading the page or quickly switching tabs doesn't spam the activity log.
//
// Anyone with the token can hit this endpoint (it's how it works) — but the
// token is unguessable (~72 bits) and only the invoice owner sees the resulting
// activity log entry, so abuse risk is minimal.

import { notifyAll } from './_lib/notify.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

const SUPABASE_URL = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
// Public anon key (also baked into the client bundle). RLS-enforced.
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3aGdjeHhzenl2ZXZqcGJubmtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODU4MTUsImV4cCI6MjA5Mjk2MTgxNX0.QrZ37rPNhDl5SjZnuPEFArLA3fdq2cyN2eGDPD6SYm8';

// SHA-256 hex digest, used to anonymize IPs before storing.
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Pull the client name off the invoice for a friendlier push body. Fails
// open — if Supabase is grumpy we just say "a client".
async function fetchInvoiceClient(invoiceId, headers) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}&select=client&limit=1`,
      { headers }
    );
    const rows = await r.json();
    return rows?.[0]?.client || '';
  } catch { return ''; }
}

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Token can come from query (GET, e.g. <img> tracking pixel) or body (POST).
  const url = new URL(req.url);
  let token = url.searchParams.get('token');
  if (!token && req.method === 'POST') {
    try { token = (await req.json())?.token; } catch {}
  }

  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;
  if (!token) return json({ error: 'Missing token' }, 400);

  const headers = {
    'Content-Type': 'application/json',
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
  };

  // Look up the invoice by token.
  const lookupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/invoices?view_token=eq.${encodeURIComponent(token)}&select=id`,
    { headers }
  );
  const rows = await lookupRes.json();
  const invoiceId = rows?.[0]?.id;
  if (!invoiceId) return json({ ok: false, error: 'Invalid token' }, 404);

  // Hash the requester's IP so we don't store raw addresses.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? (await sha256(ip)).slice(0, 16) : null;
  const userAgent = req.headers.get('user-agent') || '';

  // De-dup: skip if we already logged an open from this ip_hash in the last hour.
  if (ipHash) {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/invoice_events?invoice_id=eq.${encodeURIComponent(invoiceId)}` +
      `&kind=eq.opened&created_at=gte.${encodeURIComponent(cutoff)}` +
      `&meta->>ip_hash=eq.${ipHash}&select=id&limit=1`,
      { headers }
    );
    const dups = await dupRes.json();
    if (Array.isArray(dups) && dups.length > 0) {
      return json({ ok: true, deduped: true });
    }
  }

  // Insert the event.
  const insertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/invoice_events`,
    {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        invoice_id: invoiceId,
        kind: 'opened',
        meta: { ip_hash: ipHash, user_agent: userAgent.slice(0, 200) },
      }),
    }
  );

  if (!insertRes.ok) {
    const text = await insertRes.text();
    return json({ ok: false, error: 'Insert failed', detail: text }, 500);
  }

  // Fire-and-forget in-app notification + APNs push. We don't block the
  // tracking pixel response on Supabase or APNs.
  fetchInvoiceClient(invoiceId, headers).then(client => {
    return notifyAll({
      type: 'invoice_open',
      title: 'Invoice opened',
      body: client ? `${client} opened ${invoiceId}` : `${invoiceId} was opened`,
      invoiceId,
      data: { client },
    });
  }).catch(e => console.error('[track-open] notify failed:', e));

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

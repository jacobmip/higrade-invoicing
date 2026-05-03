// /api/track-open
// Logs an "opened" event when a recipient hits the public viewer page (/v/<token>).
// De-duped per (invoice_id, ip_hash) within a 1-hour window so a single visit
// reloading the page or quickly switching tabs doesn't spam the activity log.

import { notifyAll } from './_lib/notify.js';
import crypto from 'node:crypto';

export const config = { runtime: 'nodejs', maxDuration: 15 };

const SUPABASE_URL = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3aGdjeHhzenl2ZXZqcGJubmtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODU4MTUsImV4cCI6MjA5Mjk2MTgxNX0.QrZ37rPNhDl5SjZnuPEFArLA3fdq2cyN2eGDPD6SYm8';

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

// Pull the client name off the invoice for a friendlier push body. Fails
// open if Supabase is grumpy.
async function fetchInvoiceClient(invoiceId, headers) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}&select=client_name&limit=1`,
      { headers }
    );
    const rows = await r.json();
    return rows?.[0]?.client_name || '';
  } catch { return ''; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Token from query (GET) or body (POST).
  let token = (req.query && req.query.token) || '';
  if (!token && req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    token = body.token || '';
  }
  if (!token) return send(res, 400, { error: 'Missing token' });

  // After the May 2026 RLS lockdown, anon can't read invoices or write
  // invoice_events. Use service-role; token still scopes to one invoice.
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY
              || process.env.SUPABASE_ANON_KEY
              || process.env.VITE_SUPABASE_ANON_KEY
              || FALLBACK_ANON_KEY;

  const headers = {
    'Content-Type': 'application/json',
    'apikey': apiKey,
    'Authorization': `Bearer ${apiKey}`,
  };

  try {
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?view_token=eq.${encodeURIComponent(token)}&select=id`,
      { headers }
    );
    const rows = await lookupRes.json();
    const invoiceId = rows?.[0]?.id;
    if (!invoiceId) return send(res, 404, { ok: false, error: 'Invalid token' });

    // Hash the requester's IP so we don't store raw addresses.
    const xff = req.headers['x-forwarded-for'];
    const ip = (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
            || req.headers['cf-connecting-ip']
            || '';
    const ipHash = ip ? sha256hex(ip).slice(0, 16) : null;
    const userAgent = req.headers['user-agent'] || '';

    // De-dup: skip if we already logged an open from this ip_hash within an hour.
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
        return send(res, 200, { ok: true, deduped: true });
      }
    }

    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/invoice_events`,
      {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          invoice_id: invoiceId,
          kind: 'opened',
          meta: { ip_hash: ipHash, user_agent: String(userAgent).slice(0, 200) },
        }),
      }
    );
    if (!insertRes.ok) {
      const text = await insertRes.text();
      return send(res, 500, { ok: false, error: 'Insert failed', detail: text });
    }

    // Fire-and-forget push notification.
    fetchInvoiceClient(invoiceId, headers).then(client => {
      return notifyAll({
        type: 'invoice_open',
        title: 'Invoice opened',
        body: client ? `${client} opened ${invoiceId}` : `${invoiceId} was opened`,
        invoiceId,
        data: { client },
      });
    }).catch(e => console.error('[track-open] notify failed:', e));

    return send(res, 200, { ok: true });
  } catch (e) {
    console.error('[track-open] error:', e);
    return send(res, 500, { ok: false, error: e.message || String(e) });
  }
}

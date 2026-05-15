// /api/public-invoice
// Token-scoped read used by the customer-facing /v/<token> viewer.
//
// Why this exists: once we lock down RLS so only authenticated users can
// read the invoices table, the public viewer can no longer hit Supabase
// directly with the anon key. This endpoint runs server-side with the
// service-role key and returns ONLY the row matching view_token, plus
// its items + payments. No tokens, no client list, no other invoices.
//
// GET  /api/public-invoice?token=<viewToken>
// 200  { invoice, items, payments }
// 404  { error: 'not_found' }
//
// Note: uses the classic Node (req, res) handler signature. The earlier
// version returned a Web Response, which causes Vercel's nodejs runtime
// to hang until timeout instead of completing the request.

export const config = { runtime: 'nodejs', maxDuration: 10 };

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function supaKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.VITE_SUPABASE_ANON_KEY
      || process.env.SUPABASE_ANON_KEY;
}

function supaUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || SUPABASE_URL_FALLBACK;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const token = (req.query && req.query.token) || '';
  if (!token || typeof token !== 'string' || token.length < 8) {
    return send(res, 400, { error: 'Missing or invalid token' });
  }

  const key = supaKey();
  if (!key) return send(res, 500, { error: 'Supabase key not configured' });

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const base = supaUrl();

  try {
    const invRes = await fetch(
      `${base}/rest/v1/invoices?view_token=eq.${encodeURIComponent(token)}&limit=1`,
      { headers }
    );
    if (!invRes.ok) {
      const text = await invRes.text();
      console.error('[public-invoice] invoice query failed:', invRes.status, text);
      return send(res, 500, { error: 'Lookup failed' });
    }
    const invRows = await invRes.json();
    const inv = invRows && invRows[0];
    if (!inv) return send(res, 404, { error: 'not_found' });

    const [itemsRes, paymentsRes, photosRes] = await Promise.all([
      fetch(`${base}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(inv.id)}&order=sort_order`, { headers }),
      fetch(`${base}/rest/v1/payments?invoice_id=eq.${encodeURIComponent(inv.id)}&order=date`, { headers }),
      fetch(`${base}/rest/v1/job_photos?invoice_id=eq.${encodeURIComponent(inv.id)}&order=created_at`, { headers }),
    ]);
    const items = itemsRes.ok ? await itemsRes.json() : [];
    const payments = paymentsRes.ok ? await paymentsRes.json() : [];
    const photos = photosRes.ok ? await photosRes.json() : [];

    return send(res, 200, { invoice: inv, items, payments, photos });
  } catch (e) {
    console.error('[public-invoice] error:', e);
    return send(res, 500, { error: e.message || String(e) });
  }
}

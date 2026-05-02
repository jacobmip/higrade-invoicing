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

export const config = { runtime: 'nodejs', maxDuration: 10 };

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // No caching: invoice rows mutate on payment, and we want the post-payment
      // refresh in the viewer to reflect the new "paid in full" state instantly.
      'Cache-Control': 'no-store',
    },
  });
}

function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
            || process.env.VITE_SUPABASE_ANON_KEY
            || process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('Supabase key not configured');
  return { 'apikey': key, 'Authorization': `Bearer ${key}` };
}

function supaUrl() {
  return process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
}

export default async function handler(req) {
  // Allow GET (viewer) and POST (CORS preflight tolerance not needed since same-origin)
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  // URL.searchParams works on both Vercel Node + Edge runtimes.
  let token;
  try {
    const u = new URL(req.url, 'http://x');
    token = u.searchParams.get('token');
  } catch { return json({ error: 'Bad request' }, 400); }

  if (!token || typeof token !== 'string' || token.length < 8) {
    return json({ error: 'Missing or invalid token' }, 400);
  }

  try {
    const headers = supaHeaders();
    const invRes = await fetch(
      `${supaUrl()}/rest/v1/invoices?view_token=eq.${encodeURIComponent(token)}&limit=1`,
      { headers }
    );
    if (!invRes.ok) {
      const text = await invRes.text();
      console.error('[public-invoice] invoice query failed:', invRes.status, text);
      return json({ error: 'Lookup failed' }, 500);
    }
    const invRows = await invRes.json();
    const inv = invRows?.[0];
    if (!inv) return json({ error: 'not_found' }, 404);

    const [itemsRes, paymentsRes] = await Promise.all([
      fetch(`${supaUrl()}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(inv.id)}&order=sort_order`, { headers }),
      fetch(`${supaUrl()}/rest/v1/payments?invoice_id=eq.${encodeURIComponent(inv.id)}&order=date`, { headers }),
    ]);
    const items = itemsRes.ok ? await itemsRes.json() : [];
    const payments = paymentsRes.ok ? await paymentsRes.json() : [];

    return json({ invoice: inv, items, payments });
  } catch (e) {
    console.error('[public-invoice] error:', e);
    return json({ error: e.message || String(e) }, 500);
  }
}

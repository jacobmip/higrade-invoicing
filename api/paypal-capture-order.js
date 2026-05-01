// Capture a PayPal order after the buyer approves it, then record the
// payment against the invoice in Supabase.
//
// This is the "real" payment moment — until the capture call returns
// COMPLETED, no money has actually moved. Once it does, we insert a row
// into the `payments` table so the public viewer flips to "Paid in
// full" and the in-app invoice list shows the receipt automatically.

export const config = { runtime: 'edge' };

function paypalBase() {
  return (process.env.PAYPAL_ENV || 'live').toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

async function paypalAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal credentials not configured');
  const auth = btoa(`${id}:${secret}`);
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const j = await res.json();
  return j.access_token;
}

// We use the Supabase service-role key here so the insert into `payments`
// bypasses RLS. The payment row references the invoice by id, which we
// found via the view_token the customer was already authorized to see, so
// this can't be abused to write to arbitrary invoices.
async function recordPayment({ invoiceId, amount, paypalOrderId, paypalCaptureId }) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // Idempotency check \u2014 if PayPal retries the capture (or the user
  // refreshes), we don't want to insert duplicate payment rows. The
  // PayPal capture ID is unique per transaction.
  const dupeRes = await fetch(`${url}/rest/v1/payments?paypal_capture_id=eq.${encodeURIComponent(paypalCaptureId)}&select=id&limit=1`, { headers });
  const dupes = await dupeRes.json();
  if (Array.isArray(dupes) && dupes.length > 0) {
    return { ok: true, deduped: true };
  }

  const today = new Date().toISOString().slice(0, 10);
  const note = `PayPal order ${paypalOrderId} \u00b7 capture ${paypalCaptureId}`;
  const insertRes = await fetch(`${url}/rest/v1/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      invoice_id: invoiceId,
      amount: Number(amount),
      method: 'PayPal',
      date: today,
      note,
      paypal_order_id: paypalOrderId,
      paypal_capture_id: paypalCaptureId,
    }),
  });
  if (!insertRes.ok) {
    const t = await insertRes.text();
    throw new Error(`Supabase payment insert failed: ${insertRes.status} ${t}`);
  }
  return { ok: true };
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const { orderID } = await req.json();
    if (!orderID) {
      return new Response(JSON.stringify({ error: 'missing_order_id' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await paypalAccessToken();
    const captureRes = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    const capture = await captureRes.json();
    if (!captureRes.ok) {
      return new Response(JSON.stringify({ error: 'paypal_capture_failed', detail: capture }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pull the captured amount + invoice ID off the response.
    const pu = (capture.purchase_units && capture.purchase_units[0]) || {};
    const cap = (pu.payments && pu.payments.captures && pu.payments.captures[0]) || {};
    const amount = parseFloat(cap.amount?.value || '0');
    const invoiceId = pu.reference_id || pu.invoice_id;
    const captureId = cap.id;

    if (cap.status !== 'COMPLETED') {
      return new Response(JSON.stringify({ error: 'capture_not_completed', status: cap.status }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    await recordPayment({
      invoiceId,
      amount,
      paypalOrderId: orderID,
      paypalCaptureId: captureId,
    });

    return new Response(JSON.stringify({
      ok: true,
      orderID,
      captureID: captureId,
      amount,
      invoiceId,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e?.message || e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

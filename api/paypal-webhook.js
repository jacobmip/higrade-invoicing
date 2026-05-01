// PayPal webhook receiver \u2014 a safety net behind the inline capture flow.
//
// 99% of payments will already be recorded by /api/paypal-capture-order
// before the buyer's browser even closes the PayPal window. But if their
// network drops between capture and the response landing in the browser,
// we'd otherwise miss the receipt. This webhook listens for
// PAYMENT.CAPTURE.COMPLETED and inserts the same payment row, dedupe'd
// on the PayPal capture ID so the inline flow + webhook can both fire
// safely without double-recording.
//
// Configure in the PayPal Developer Dashboard: webhook URL is
// https://higrade-invoicing.vercel.app/api/paypal-webhook subscribed to
// the PAYMENT.CAPTURE.COMPLETED event. Set PAYPAL_WEBHOOK_ID in Vercel
// env to the webhook's ID so this endpoint can verify each request's
// signature (without verification, anyone could POST a fake event).

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

// PayPal's webhook signature verification API. Requires the event body
// plus a handful of headers the platform sets on each delivery. If the
// webhook ID env var is missing we skip verification with a console
// warning \u2014 useful for local debugging, dangerous in production.
async function verifyWebhook(headers, rawBody, webhookId) {
  if (!webhookId) {
    console.warn('[paypal-webhook] PAYPAL_WEBHOOK_ID not set \u2014 skipping signature verification');
    return true;
  }
  const accessToken = await paypalAccessToken();
  const res = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo:        headers.get('paypal-auth-algo'),
      cert_url:         headers.get('paypal-cert-url'),
      transmission_id:  headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'),
      transmission_time:headers.get('paypal-transmission-time'),
      webhook_id:       webhookId,
      webhook_event:    JSON.parse(rawBody),
    }),
  });
  if (!res.ok) return false;
  const j = await res.json();
  return j.verification_status === 'SUCCESS';
}

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
  const dupeRes = await fetch(`${url}/rest/v1/payments?paypal_capture_id=eq.${encodeURIComponent(paypalCaptureId)}&select=id&limit=1`, { headers });
  const dupes = await dupeRes.json();
  if (Array.isArray(dupes) && dupes.length > 0) return { ok: true, deduped: true };
  const today = new Date().toISOString().slice(0, 10);
  const note = `PayPal order ${paypalOrderId} \u00b7 capture ${paypalCaptureId} (webhook)`;
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
  if (!insertRes.ok) throw new Error(`Supabase payment insert failed: ${insertRes.status}`);
  return { ok: true };
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  try {
    const rawBody = await req.text();
    const ok = await verifyWebhook(req.headers, rawBody, process.env.PAYPAL_WEBHOOK_ID);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'invalid_signature' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const event = JSON.parse(rawBody);
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      // Ack other event types so PayPal doesn't retry, but ignore them.
      return new Response(JSON.stringify({ ok: true, ignored: event.event_type }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const r = event.resource || {};
    const captureId = r.id;
    // The order ID lives in the supplementary_data.related_ids OR the
    // capture's links \u2014 supplementary_data is more reliable.
    const orderId = r.supplementary_data?.related_ids?.order_id
                 || (r.links || []).find(l => l.rel === 'up')?.href?.split('/').pop()
                 || '';
    const amount = parseFloat(r.amount?.value || '0');
    const invoiceId = r.invoice_id || r.custom_id || ''; // we set invoice_id on order creation

    if (!captureId || !invoiceId) {
      return new Response(JSON.stringify({ ok: true, ignored: 'missing_ids' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    await recordPayment({ invoiceId, amount, paypalOrderId: orderId, paypalCaptureId: captureId });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[paypal-webhook]', e);
    // Return 200 so PayPal doesn't endlessly retry on an unrecoverable
    // error. We log it so we can investigate manually.
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
}

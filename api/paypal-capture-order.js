// Capture a PayPal order after the buyer approves it, then record the
// payment against the invoice in Supabase.
//
// This is the "real" payment moment — until the capture call returns
// COMPLETED, no money has actually moved. Once it does, we insert a row
// into the `payments` table so the public viewer flips to "Paid in
// full" and the in-app invoice list shows the receipt automatically.

import { notifyAll } from './_lib/notify.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

function paypalBase() {
  return (process.env.PAYPAL_ENV || 'live').toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

async function paypalAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal credentials not configured');
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
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
function supabaseCfg() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  return { url, headers };
}

async function recordPayment({ invoiceId, amount, surcharge, paypalOrderId, paypalCaptureId }) {
  const { url, headers } = supabaseCfg();

  // Idempotency check — if PayPal retries the capture (or the user
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
      surcharge: Number(surcharge || 0),
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

// After recording a payment, mirror the in-app totals math against the
// invoice's items + payments and flip the invoice's status column. The
// in-app list/dashboard UI keys off `invoices.status`, so without this
// update a paid invoice keeps showing as 'outstanding' until the user
// edits it manually.
async function reconcileInvoiceStatus(invoiceId) {
  const { url, headers } = supabaseCfg();

  // Pull the invoice + its items + all payments. We need the same fields
  // the client uses to compute totals (tax %, discount, items, payments).
  const [invRes, itemsRes, paysRes] = await Promise.all([
    fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}&select=id,type,status,tax,discount,discount_type&limit=1`, { headers }),
    fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(invoiceId)}&select=qty,price,discount,discount_type,taxable`, { headers }),
    fetch(`${url}/rest/v1/payments?invoice_id=eq.${encodeURIComponent(invoiceId)}&select=amount`, { headers }),
  ]);
  const invs = await invRes.json();
  const items = await itemsRes.json();
  const pays = await paysRes.json();
  if (!Array.isArray(invs) || invs.length === 0) return;
  const inv = invs[0];
  if (inv.type === 'estimate') return;

  const itemTotal = (it) => {
    const qty = parseFloat(it.qty ?? 1);
    const price = parseFloat(it.price ?? 0);
    const base = qty * price;
    const disc = parseFloat(it.discount ?? 0);
    if (it.discount_type === '%') return base * (1 - disc / 100);
    return Math.max(0, base - disc);
  };
  const sub = (items || []).reduce((s, it) => s + itemTotal(it), 0);
  const taxableSub = (items || []).filter(it => it.taxable !== false).reduce((s, it) => s + itemTotal(it), 0);
  let disc = 0;
  if (inv.discount) {
    if (inv.discount_type === '%') disc = sub * (parseFloat(inv.discount) / 100);
    else disc = parseFloat(inv.discount);
  }
  const taxBase = Math.max(0, taxableSub - disc * (taxableSub / Math.max(sub, 1)));
  const taxAmt = taxBase * (parseFloat(inv.tax || 4.712) / 100);
  const total = Math.max(0, sub - disc + taxAmt);
  const paid = (pays || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const balance = +(total - paid).toFixed(2);

  // Flip status based on balance. Use a 1-cent tolerance so floating-point
  // rounding doesn't leave a paid invoice in 'partial' forever.
  let newStatus = inv.status;
  if (balance <= 0.01) newStatus = 'paid';
  else if (paid > 0) newStatus = 'partial';
  // If nothing was paid yet (shouldn't happen on this code path) leave it.

  if (newStatus !== inv.status) {
    await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() }),
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const orderID = body.orderID;
    if (!orderID) {
      res.status(400).json({ error: 'missing_order_id' });
      return;
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
      res.status(502).json({ error: 'paypal_capture_failed', detail: capture });
      return;
    }

    // Pull the captured amount + invoice ID off the response. The buyer
    // was charged the full grand total (invoice balance + processing
    // surcharge). We split it back out so the receipt can show the
    // invoice portion and the processing fee on separate lines.
    //
    // Note: PayPal echoes the breakdown we sent at order creation on the
    // purchase unit's `amount` field. The capture's own `amount` only
    // carries currency_code + value, no breakdown. So we read item_total
    // and handling (surcharge) from `pu.amount.breakdown`.
    const pu = (capture.purchase_units && capture.purchase_units[0]) || {};
    const cap = (pu.payments && pu.payments.captures && pu.payments.captures[0]) || {};
    const grossAmount = parseFloat(cap.amount?.value || '0');
    const itemTotal = parseFloat(pu.amount?.breakdown?.item_total?.value || '0');
    const handling = parseFloat(pu.amount?.breakdown?.handling?.value || '0');

    // Prefer the breakdown values when present. If the breakdown is
    // missing (legacy orders), record the gross as the invoice portion
    // with zero surcharge — the receipt won't show a fee line, but the
    // balance will still reconcile.
    const amount = itemTotal > 0 ? itemTotal : grossAmount;
    const surcharge = handling > 0 ? handling : 0;
    const invoiceId = pu.reference_id || pu.invoice_id;
    const captureId = cap.id;

    if (cap.status !== 'COMPLETED') {
      res.status(400).json({ error: 'capture_not_completed', status: cap.status });
      return;
    }

    const recordResult = await recordPayment({
      invoiceId,
      amount,
      surcharge,
      paypalOrderId: orderID,
      paypalCaptureId: captureId,
    });

    // Flip invoice.status to 'paid' / 'partial' if the new payment
    // changed the balance. Best-effort: if this fails, the payment is
    // still recorded and the in-app reconciliation can fix the status
    // on the next save. Don't block the success response on it.
    if (recordResult?.ok && !recordResult.deduped) {
      try { await reconcileInvoiceStatus(invoiceId); }
      catch (e) { console.error('[paypal-capture] status reconcile failed:', e); }
    }

    // Fire an in-app notification + APNs push, but only on the first time
    // this capture is recorded (the webhook may also fire and we don't
    // want to double-notify).
    if (recordResult?.ok && !recordResult.deduped) {
      await notifyAll({
        type: 'payment',
        title: 'PayPal payment received',
        body: `$${amount.toFixed(2)} on ${invoiceId}`,
        invoiceId,
        data: { amount, method: 'PayPal', captureId },
      }).catch(e => console.error('[paypal-capture] notify failed:', e));
    }

    res.status(200).json({
      ok: true,
      orderID,
      captureID: captureId,
      amount,
      surcharge,
      gross: grossAmount,
      invoiceId,
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: String(e?.message || e) });
  }
}

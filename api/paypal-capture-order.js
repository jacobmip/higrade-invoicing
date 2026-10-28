// Capture a PayPal order after the buyer approves it, then record the
// payment against the invoice in Supabase.
//
// This is the "real" payment moment — until the capture call returns
// COMPLETED, no money has actually moved. Once it does, we insert a row
// into the `payments` table so the public viewer flips to "Paid in
// full" and the in-app invoice list shows the receipt automatically.
//
// Estimate down-payment flow (2026-05-04): if the captured order's
// reference_id points at an estimate row, that means the customer paid
// a down payment. We auto-convert the estimate into a real INV####
// (full-price items copied), record the down payment as a payment row
// on the new invoice, and link the estimate -> invoice via
// converted_to_id so the in-app history view can show both.

import { notifyAll } from './_lib/notify.js';
import { supabaseCfg, convertEstimateToInvoice, reconcileInvoiceStatus, telegramNotify } from './_lib/convert-estimate.js';

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
    let itemTotal = parseFloat(pu.amount?.breakdown?.item_total?.value || '0');
    let handling = parseFloat(pu.amount?.breakdown?.handling?.value || '0');
    const invoiceId = pu.reference_id || pu.invoice_id;
    const captureId = cap.id;

    // Fallback when PayPal's capture response doesn't echo the breakdown
    // we sent at order creation. This has been observed in production for
    // tiny orders (e.g. $1.03) and for orders captured through Venmo. We
    // re-fetch the order to read back the breakdown we originally posted.
    if ((itemTotal <= 0 || handling <= 0) && orderID) {
      try {
        const orderRes = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderID)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (orderRes.ok) {
          const ord = await orderRes.json();
          const opu = (ord.purchase_units && ord.purchase_units[0]) || {};
          const it = parseFloat(opu.amount?.breakdown?.item_total?.value || '0');
          const hd = parseFloat(opu.amount?.breakdown?.handling?.value || '0');
          if (it > 0) itemTotal = it;
          if (hd > 0) handling = hd;
        }
      } catch (e) {
        console.error('[paypal-capture] order re-fetch for breakdown failed:', e);
      }
    }

    // Prefer the breakdown values when present. If still missing after the
    // re-fetch, record the gross as the invoice portion with zero surcharge
    // — the receipt won't show a fee line, but the balance will still
    // reconcile so the customer's payment is not lost.
    const amount = itemTotal > 0 ? itemTotal : grossAmount;
    const surcharge = handling > 0 ? handling : 0;

    if (cap.status !== 'COMPLETED') {
      res.status(400).json({ error: 'capture_not_completed', status: cap.status });
      return;
    }

    // If the captured order's reference_id is an estimate, convert it into
    // a real INV#### now (idempotent if it already has a converted_to_id).
    // The down-payment is then recorded against the new invoice id.
    let targetInvoiceId = invoiceId;
    let convertedFromEstimateId = null;
    let convertedViewToken = null;
    let convertedClientName = '';
    try {
      const refRes = await fetch(
        `${supabaseCfg().url}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}&select=type,view_token&limit=1`,
        { headers: supabaseCfg().headers }
      );
      const refRows = await refRes.json();
      if (Array.isArray(refRows) && refRows.length > 0 && refRows[0].type === 'estimate') {
        const conv = await convertEstimateToInvoice(invoiceId);
        if (conv && conv.invoiceId) {
          targetInvoiceId = conv.invoiceId;
          convertedFromEstimateId = invoiceId;
          convertedViewToken = conv.viewToken;
          convertedClientName = conv.clientName;
        }
      }
    } catch (e) {
      console.error('[paypal-capture] estimate conversion failed:', e);
      // Fall through and record the payment against the original id so the
      // money isn't lost. Jake can manually fix up the conversion if needed.
    }

    const recordResult = await recordPayment({
      invoiceId: targetInvoiceId,
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
      try { await reconcileInvoiceStatus(targetInvoiceId); }
      catch (e) { console.error('[paypal-capture] status reconcile failed:', e); }
    }

    // Fire an in-app notification + APNs push, but only on the first time
    // this capture is recorded (the webhook may also fire and we don't
    // want to double-notify).
    if (recordResult?.ok && !recordResult.deduped) {
      const title = convertedFromEstimateId ? 'Down payment received' : 'PayPal payment received';
      const body = convertedFromEstimateId
        ? `$${amount.toFixed(2)} \u2014 ${convertedFromEstimateId} converted to ${targetInvoiceId}`
        : `$${amount.toFixed(2)} on ${targetInvoiceId}`;
      if (convertedFromEstimateId) {
        await telegramNotify(`\u2705 ${convertedClientName || 'Client'} paid a $${amount.toFixed(2)} deposit on ${convertedFromEstimateId} \u2014 converted to ${targetInvoiceId}`);
      }
      await notifyAll({
        type: 'payment',
        title,
        body,
        invoiceId: targetInvoiceId,
        data: { amount, method: 'PayPal', captureId, convertedFromEstimateId },
      }).catch(e => console.error('[paypal-capture] notify failed:', e));
    }

    res.status(200).json({
      ok: true,
      orderID,
      captureID: captureId,
      amount,
      surcharge,
      gross: grossAmount,
      invoiceId: targetInvoiceId,
      convertedFromEstimateId,
      convertedViewToken,
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: String(e?.message || e) });
  }
}

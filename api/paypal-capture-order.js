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

// base64url, ~12 chars — same shape as the in-app generateViewToken so
// customer-facing /v/<token> URLs look consistent.
function generateViewToken() {
  const bytes = require('node:crypto').randomBytes(9);
  return bytes.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// If the reference row is an estimate, convert it into a real INV####
// (items copied at full price), and return the new invoice id + token so
// the caller records the down-payment against the new invoice. Idempotent:
// if the estimate has already been converted (converted_to_id set), we
// just return that existing id.
async function convertEstimateToInvoice(estimateId) {
  const { url, headers } = supabaseCfg();

  // Load the estimate row
  const estRes = await fetch(
    `${url}/rest/v1/invoices?id=eq.${encodeURIComponent(estimateId)}&select=*&limit=1`,
    { headers }
  );
  const estRows = await estRes.json();
  if (!Array.isArray(estRows) || estRows.length === 0) {
    throw new Error('Estimate not found: ' + estimateId);
  }
  const est = estRows[0];
  if (est.type !== 'estimate') {
    // Already an invoice — nothing to convert.
    return { invoiceId: est.id, alreadyConverted: false, viewToken: est.view_token };
  }
  if (est.converted_to_id) {
    // Already converted on a previous capture — re-use.
    const linkRes = await fetch(
      `${url}/rest/v1/invoices?id=eq.${encodeURIComponent(est.converted_to_id)}&select=id,view_token&limit=1`,
      { headers }
    );
    const linkRows = await linkRes.json();
    if (Array.isArray(linkRows) && linkRows.length > 0) {
      return { invoiceId: linkRows[0].id, alreadyConverted: true, viewToken: linkRows[0].view_token };
    }
  }

  // Pull items + settings (for next_num)
  const [itemsRes, settingsRes, allInvRes] = await Promise.all([
    fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(estimateId)}&order=sort_order.asc&select=*`, { headers }),
    fetch(`${url}/rest/v1/settings?key=eq.next_num&select=*`, { headers }),
    fetch(`${url}/rest/v1/invoices?type=eq.invoice&select=id&order=id.desc&limit=200`, { headers }),
  ]);
  const items = await itemsRes.json();
  const settingRows = await settingsRes.json();
  const allInv = await allInvRes.json();

  let persistedNext = 1;
  if (Array.isArray(settingRows) && settingRows.length > 0) {
    persistedNext = parseInt(settingRows[0].value, 10) || 1;
  }
  let highestActual = 0;
  if (Array.isArray(allInv)) {
    for (const r of allInv) {
      const m = /^INV(\d+)$/.exec(r.id || '');
      if (m) highestActual = Math.max(highestActual, parseInt(m[1], 10));
    }
  }
  const num = Math.max(persistedNext, highestActual + 1);
  const newId = 'INV' + String(num).padStart(4, '0');
  const viewToken = generateViewToken();
  const today = new Date().toISOString().slice(0, 10);

  // Insert the new invoice row. Items are copied at full price.
  const insertRes = await fetch(`${url}/rest/v1/invoices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: newId,
      type: 'invoice',
      client_id: est.client_id || null,
      client_name: est.client_name || '',
      date: today,
      due_date: null,
      status: 'outstanding',
      tax: est.tax ?? 4.712,
      discount: est.discount ?? 0,
      discount_type: est.discount_type || '$',
      notes: est.notes || `Created from estimate ${estimateId}`,
      year: new Date().getFullYear(),
      client_info: est.client_info || null,
      view_token: viewToken,
      down_payment_pct: 0,
      // Carry the job site / billing address and the private notes across.
      // Without these the auto-created invoice printed with no address and
      // lost every internal note the estimate carried.
      job_address: est.job_address || null,
      billing_address: est.billing_address || null,
      show_billing_address: est.show_billing_address ?? true,
      internal_notes: est.internal_notes || '',
      source: est.source || null,
      // Inherit the estimate's owner. This insert runs with the service-role
      // key, so auth.uid() is NULL and the set_owner_id trigger would leave
      // owner_id NULL -- an orphaned row that RLS then hides from Jake. The
      // invoice would exist in the DB but never show up in the app, so the
      // estimate looked like it had never converted at all.
      owner_id: est.owner_id || null,
    }),
  });
  if (!insertRes.ok) {
    const t = await insertRes.text();
    throw new Error(`Invoice insert failed: ${insertRes.status} ${t}`);
  }

  // Belt-and-suspenders on ownership: if the BEFORE INSERT trigger clobbered
  // owner_id with a NULL auth.uid(), stamp it back on with a PATCH (which the
  // insert trigger can't touch). Cheap, and it guarantees the row is visible.
  if (est.owner_id) {
    const ownRes = await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(newId)}&owner_id=is.null`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ owner_id: est.owner_id }),
    });
    if (!ownRes.ok) {
      console.error('[paypal-capture] owner_id backfill failed:', await ownRes.text());
    }
  }

  // Copy items at full price, preserving qty/unit/discount/taxable.
  if (Array.isArray(items) && items.length > 0) {
    const copiedItems = items.map((it, idx) => ({
      invoice_id: newId,
      name: it.name || '',
      description: it.description || '',
      qty: Number(it.qty) || 1,
      price: Number(it.price) || 0,
      unit: it.unit || 'ea',
      discount: Number(it.discount) || 0,
      discount_type: it.discount_type || '%',
      taxable: it.taxable !== false,
      sort_order: typeof it.sort_order === 'number' ? it.sort_order : idx,
    }));
    const itemsInsertRes = await fetch(`${url}/rest/v1/invoice_items`, {
      method: 'POST',
      headers,
      body: JSON.stringify(copiedItems),
    });
    if (!itemsInsertRes.ok) {
      console.error('[paypal-capture] item copy failed:', await itemsInsertRes.text());
    }
  }

  // Bump settings.next_num
  await fetch(`${url}/rest/v1/settings?key=eq.next_num`, { method: 'DELETE', headers });
  await fetch(`${url}/rest/v1/settings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: 'next_num', value: String(num + 1) }),
  });

  // Link the estimate to the new invoice (status stays 'approved' if it
  // was already signed — we just record the conversion). The estimate
  // remains visible in the app for historical reference. Be loud about
  // failures here — a silent miss leaves an "open" estimate dangling next
  // to its real invoice.
  const newStatus = est.status === 'approved' ? 'approved' : 'converted';
  const linkRes = await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(estimateId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      converted_to_id: newId,
      status: newStatus,
    }),
  });
  if (!linkRes.ok) {
    const t = await linkRes.text();
    console.error('[paypal-capture] link patch failed:', linkRes.status, t);
    // Roll back the new invoice + items so we don't leave orphans.
    try {
      await fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
      await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
    } catch (cleanupErr) {
      console.error('[paypal-capture] rollback failed:', cleanupErr);
    }
    throw new Error(`Estimate link patch failed: ${linkRes.status} ${t}`);
  }
  // Verify by re-reading. PostgREST PATCH returns 200 even when 0 rows
  // are affected (e.g. RLS filter mismatch), so we explicitly confirm.
  const verifyRes = await fetch(
    `${url}/rest/v1/invoices?id=eq.${encodeURIComponent(estimateId)}&select=converted_to_id,status&limit=1`,
    { headers }
  );
  const verifyRows = await verifyRes.json();
  const verified = Array.isArray(verifyRows) && verifyRows[0];
  if (!verified || verified.converted_to_id !== newId || verified.status !== newStatus) {
    console.error('[paypal-capture] link patch did not persist:', verifyRows);
    try {
      await fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
      await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
    } catch (cleanupErr) {
      console.error('[paypal-capture] rollback failed:', cleanupErr);
    }
    throw new Error('Estimate link patch did not persist');
  }

  return { invoiceId: newId, alreadyConverted: false, viewToken };
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

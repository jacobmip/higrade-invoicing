// /api/submit-signature
// Public-viewer endpoint that the customer hits when they tap "Approve & Sign"
// on the /v/<token> page. Writes the signature back to the estimate row,
// flips status to "approved", optionally auto-creates a down-payment invoice,
// and emails Jake a confirmation (and the customer a payment link if a
// down-payment is required).
//
// Why the rewrite (2026-05-04):
//   The previous implementation ran on Vercel's edge runtime, returned a
//   Web `new Response(...)`, and only emailed Jake — it never wrote the
//   signature to the database. That meant signed estimates didn't persist
//   their signature, and the front-end's "something went wrong" error was
//   triggered when the edge handler timed out trying to handle a 50–200KB
//   base64 PNG payload. Now this runs on the Node runtime with the classic
//   (req, res) signature (matching public-invoice.js) and uses the service
//   role key to bypass RLS.
//
// Down-payment workflow (2026-05-04):
//   If the estimate has down_payment_pct > 0 and no down_payment_invoice_id
//   yet, this endpoint mints a new INV####, copies the estimate's items
//   (qty unchanged, price scaled by pct%), inserts a fresh invoice row,
//   bumps settings.next_num, links the new invoice id back onto the estimate,
//   and emails the customer a payment link (/v/<token>) so they can pay it
//   with PayPal right away.

import { notifyAll } from './_lib/notify.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
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

// Generate a base64url view-token, ~12 chars. Same shape as src/db.js
// generateViewToken so customer-facing URLs look consistent.
function generateViewToken() {
  const bytes = new Uint8Array(9);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Read the JSON body — Vercel's Node runtime exposes it pre-parsed on
// req.body when content-type is application/json, but be defensive.
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ─── Down-payment invoice creator ───────────────────────────────────────────
// Side-effect free if estimate.down_payment_pct === 0 or
// down_payment_invoice_id is already set. Otherwise mints INV####, inserts
// the invoice + scaled items, bumps settings.next_num, and links back to
// the estimate. Returns { invoiceId, viewToken, total } or null.
async function maybeCreateDownPaymentInvoice({ base, headers, estimate }) {
  const pct = Number(estimate.down_payment_pct || 0);
  if (!pct || pct <= 0) return null;
  if (estimate.down_payment_invoice_id) return null;

  // Pull items
  const itemsRes = await fetch(
    `${base}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(estimate.id)}&order=sort_order.asc`,
    { headers }
  );
  if (!itemsRes.ok) {
    console.error('[submit-signature] items fetch failed:', itemsRes.status, await itemsRes.text());
    return null;
  }
  const items = await itemsRes.json();

  // Read settings.next_num and compute the new INV id. We re-clamp against
  // the highest actual INV in the table (matches db.js logic) so that
  // explicit-id imports never collide.
  const settingsRes = await fetch(
    `${base}/rest/v1/settings?key=eq.next_num`,
    { headers }
  );
  let persistedNext = 1;
  if (settingsRes.ok) {
    const rows = await settingsRes.json();
    if (rows.length) persistedNext = parseInt(rows[0].value, 10) || 1;
  }
  const highestRes = await fetch(
    `${base}/rest/v1/invoices?type=eq.invoice&select=id&order=id.desc&limit=200`,
    { headers }
  );
  let highestActual = 0;
  if (highestRes.ok) {
    const rows = await highestRes.json();
    for (const r of rows) {
      const m = /^INV(\d+)$/.exec(r.id || '');
      if (m) highestActual = Math.max(highestActual, parseInt(m[1], 10));
    }
  }
  const num = Math.max(persistedNext, highestActual + 1);
  const newId = 'INV' + String(num).padStart(4, '0');
  const viewToken = generateViewToken();

  // Insert the down-payment invoice. Reuse client + tax + discount +
  // client_info from the estimate so the public viewer renders with the
  // same branding/contact info.
  const today = new Date().toISOString().slice(0, 10);
  const insertRes = await fetch(`${base}/rest/v1/invoices`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      id: newId,
      type: 'invoice',
      client_id: estimate.client_id || null,
      client_name: estimate.client_name || '',
      date: today,
      due_date: null,
      status: 'outstanding',
      tax: estimate.tax ?? 4.712,
      discount: estimate.discount ?? 0,
      discount_type: estimate.discount_type || '$',
      notes: `Down payment (${pct}%) for estimate ${estimate.id}`,
      year: new Date().getFullYear(),
      client_info: estimate.client_info || null,
      view_token: viewToken,
      down_payment_pct: 0,
    }),
  });
  if (!insertRes.ok) {
    console.error('[submit-signature] invoice insert failed:', insertRes.status, await insertRes.text());
    return null;
  }

  // Scale items: keep qty + unit + name + description, multiply price by
  // pct/100. Discounts are pass-through; taxable flag is preserved.
  const scaled = (items || []).map((it, idx) => ({
    invoice_id: newId,
    name: it.name || '',
    description: it.description || '',
    qty: Number(it.qty) || 1,
    price: Number((Number(it.price || 0) * pct / 100).toFixed(2)),
    unit: it.unit || 'ea',
    discount: Number(it.discount || 0),
    discount_type: it.discount_type || '%',
    taxable: it.taxable !== false,
    sort_order: typeof it.sort_order === 'number' ? it.sort_order : idx,
  }));
  if (scaled.length) {
    const itemsInsert = await fetch(`${base}/rest/v1/invoice_items`, {
      method: 'POST',
      headers,
      body: JSON.stringify(scaled),
    });
    if (!itemsInsert.ok) {
      console.error('[submit-signature] items insert failed:', itemsInsert.status, await itemsInsert.text());
      // Keep going — the invoice itself exists, Jake can fix items in the app.
    }
  }

  // Bump settings.next_num
  await fetch(`${base}/rest/v1/settings?key=eq.next_num`, {
    method: 'DELETE',
    headers,
  });
  await fetch(`${base}/rest/v1/settings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: 'next_num', value: String(num + 1) }),
  });

  // Link back to the estimate
  await fetch(`${base}/rest/v1/invoices?id=eq.${encodeURIComponent(estimate.id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ down_payment_invoice_id: newId }),
  });

  // Compute total for the email (subtotal * (1 + tax%) — discounts ignored
  // here because we copy them onto the new invoice unchanged; the customer
  // sees the real total in the public viewer either way).
  const subtotal = scaled.reduce((s, it) => s + (Number(it.qty) * Number(it.price)), 0);
  const taxRate = Number(estimate.tax ?? 4.712);
  const total = (subtotal * (1 + taxRate / 100)).toFixed(2);

  return { invoiceId: newId, viewToken, total };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readJson(req); }
  catch (e) { return send(res, 400, { error: 'Invalid JSON: ' + (e.message || e) }); }

  const { estimateId, clientName, total, job, signatureData, signedAt } = body || {};

  if (!estimateId || !signatureData) {
    return send(res, 400, { error: 'Missing estimateId or signatureData' });
  }

  const key = supaKey();
  if (!key) return send(res, 500, { error: 'Supabase key not configured' });
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  const base = supaUrl();

  // 1) Persist the signature to the invoice row. This is the critical step
  //    that the old edge handler skipped — without it, Jake's app never
  //    learned the estimate was signed.
  let estimate;
  try {
    const patchRes = await fetch(
      `${base}/rest/v1/invoices?id=eq.${encodeURIComponent(estimateId)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          signature_data: signatureData,
          signed_at: signedAt || new Date().toISOString(),
          status: 'approved',
        }),
      }
    );
    if (!patchRes.ok) {
      const text = await patchRes.text();
      console.error('[submit-signature] DB patch failed:', patchRes.status, text);
      return send(res, 500, { error: 'Could not save signature to database' });
    }
    const rows = await patchRes.json();
    if (!rows || rows.length === 0) {
      return send(res, 404, { error: 'Estimate not found' });
    }
    estimate = rows[0];
  } catch (e) {
    console.error('[submit-signature] DB write threw:', e);
    return send(res, 500, { error: 'Database write failed: ' + (e.message || e) });
  }

  // 2) Down-payment invoice (best effort — never block the signature
  //    confirmation if this fails; Jake can always create the invoice
  //    manually from the signed estimate).
  let downPayment = null;
  try {
    downPayment = await maybeCreateDownPaymentInvoice({ base, headers, estimate });
  } catch (e) {
    console.error('[submit-signature] down-payment creation threw:', e);
  }

  // 3) Fire the in-app notification (best effort — never block on this).
  notifyAll({
    type: 'estimate_signed',
    title: 'Estimate signed',
    body: downPayment
      ? `${clientName || 'Client'} approved ${estimateId} — down payment ${downPayment.invoiceId} sent`
      : `${clientName || 'Client'} approved ${estimateId}`,
    invoiceId: estimateId,
    data: { clientName, total, job, downPaymentInvoiceId: downPayment?.invoiceId || null },
  }).catch((e) => console.error('[submit-signature] notify failed:', e));

  // 4) Emails (Jake's confirmation + customer's payment link).
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const signedTime = signedAt
      ? new Date(signedAt).toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' }) + ' HST'
      : 'Unknown';

    // Determine origin for /v/<token> links. Vercel sets req.headers.host
    // to the deployment hostname; we default to the production domain.
    const host = req.headers && req.headers.host;
    const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
    const origin = host ? `${proto}://${host}` : 'https://higrade-invoicing.vercel.app';

    // 4a) Jake's confirmation email
    try {
      const downPaymentRow = downPayment
        ? `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Down Payment Invoice</td><td style="padding: 10px 14px; font-weight: bold; color: #2a7a2a;">${downPayment.invoiceId} ($${downPayment.total}) — sent to customer</td></tr>`
        : '';

      const emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #0a1628; padding: 24px; text-align: center;">
            <h1 style="color: #E8622A; margin: 0; font-size: 22px; letter-spacing: 2px;">ESTIMATE APPROVED</h1>
            <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px;">HI Grade Plumbing LLC</p>
          </div>
          <div style="padding: 32px; background: #f4f6fa;">
            <p style="color: #444; font-size: 16px;"><strong>${clientName || 'Client'}</strong> has signed and approved estimate <strong>${estimateId}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #fff; border-radius: 8px; overflow: hidden;">
              <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Estimate</td><td style="padding: 10px 14px; font-weight: bold;">${estimateId}</td></tr>
              <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Client</td><td style="padding: 10px 14px; font-weight: bold;">${clientName || ''}</td></tr>
              <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Total</td><td style="padding: 10px 14px; font-weight: bold; color: #E8622A;">$${total || ''}</td></tr>
              <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Job</td><td style="padding: 10px 14px;">${job || '—'}</td></tr>
              <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px 14px; color: #666;">Signed</td><td style="padding: 10px 14px;">${signedTime}</td></tr>
              ${downPaymentRow}
            </table>
            <div style="margin-top: 16px; background: #fff; padding: 16px; border-radius: 8px; border: 1px solid #eee;"><p style="color: #666; font-size: 13px; margin: 0 0 10px; font-weight: bold;">Client Signature:</p><img src="${signatureData}" style="max-width: 280px; border: 1px solid #dde; border-radius: 4px; background: #fff; padding: 8px; display: block;" /></div>
          </div>
          <div style="background: #0a1628; padding: 16px; text-align: center;">
            <p style="color: #8899bb; font-size: 11px; margin: 0;">HI Grade Plumbing LLC · Honolulu, HI · (808) 393-0015</p>
          </div>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'HI Grade Plumbing <invoices@higradeplumbing.com>',
          to: ['jacobmip@gmail.com'],
          subject: `${estimateId} Signed — ${clientName || 'Client'}`,
          html: emailBody,
        }),
      });
    } catch (e) {
      console.error('[submit-signature] Jake email failed:', e);
    }

    // 4b) Customer's down-payment email (only if invoice was created and
    //     we have a customer email on file).
    const customerEmail = estimate.client_info && estimate.client_info.email;
    if (downPayment && customerEmail) {
      try {
        const payLink = `${origin}/v/${downPayment.viewToken}`;
        const pct = Number(estimate.down_payment_pct || 0);
        const customerHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #0a1628; padding: 24px; text-align: center;">
              <h1 style="color: #E8622A; margin: 0; font-size: 24px; letter-spacing: 2px;">HI GRADE PLUMBING LLC</h1>
              <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px; letter-spacing: 1px;">HONOLULU, HAWAII · (808) 393-0015</p>
            </div>
            <div style="padding: 32px 24px; background: #f4f6fa;">
              <div style="background:#fff;border-radius:10px;padding:22px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,0.06);margin-bottom:20px;">
                <div style="color:#888;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">Down Payment Invoice ${downPayment.invoiceId}</div>
                <div style="color:#0a1628;font-size:30px;font-weight:bold;margin-top:8px;">USD $${downPayment.total}</div>
                <div style="text-align: center; margin: 20px 0 8px;">
                  <a href="${payLink}" target="_blank" style="display: inline-block; background: #E8622A; color: #ffffff; text-decoration: none; font-size: 17px; font-weight: bold; padding: 16px 40px; border-radius: 8px; letter-spacing: 0.5px;">
                    💳 View &amp; Pay Invoice
                  </a>
                  <p style="color: #999; font-size: 12px; margin: 10px 0 0;">Tap above to pay securely with PayPal or card</p>
                </div>
              </div>
              <div style="color: #444; font-size: 15px; line-height: 1.6;">
                Aloha ${clientName || ''},<br><br>
                Thank you for approving estimate <strong>${estimateId}</strong>. To get your job scheduled,
                please pay the <strong>${pct}% down payment</strong> using the link above. We'll be in touch
                shortly to confirm your appointment.
              </div>
              <p style="color: #666; margin-top: 24px; font-size: 13px; line-height: 1.6;">
                Questions? Call or text us at <strong>808-393-0015</strong><br>
                Email: higradeplumbing@gmail.com
              </p>
              <p style="color:#888;font-size:12px;margin:14px 0 0;text-align:center;">
                Trouble viewing invoice? Copy/paste this URL:<br>
                <span style="color:#3070b8;word-break:break-all;">${payLink}</span>
              </p>
            </div>
            <div style="background: #0a1628; padding: 16px; text-align: center;">
              <p style="color: #8899bb; font-size: 11px; margin: 0;">HI Grade Plumbing LLC · Honolulu, HI · higradeplumbing.com</p>
            </div>
          </div>
        `;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: 'HI Grade Plumbing <invoices@higradeplumbing.com>',
            to: [customerEmail],
            subject: `Down Payment ${downPayment.invoiceId} — HI Grade Plumbing`,
            html: customerHtml,
          }),
        });
      } catch (e) {
        console.error('[submit-signature] customer email failed:', e);
      }
    }
  }

  return send(res, 200, {
    ok: true,
    downPaymentInvoiceId: downPayment?.invoiceId || null,
    downPaymentTotal: downPayment?.total || null,
  });
}

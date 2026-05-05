// /api/submit-signature
// Public-viewer endpoint that the customer hits when they tap "Approve & Sign"
// on the /v/<token> page. Writes the signature back to the estimate row,
// flips status to "approved", and emails Jake a confirmation.
//
// Note (2026-05-04): the down-payment-on-signature auto-invoice flow was
// reverted in favor of a down-payment-on-pay flow. The customer can now
// pay a down payment from the public viewer at any time (with or without
// signing first); when PayPal capture completes, the estimate is converted
// into a real INV#### with the down-payment recorded as a payment. See
// /api/paypal-capture-order.js for that logic. This endpoint is now a
// pure signature-recording handler.

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
    Prefer: 'return=representation',
  };
  const base = supaUrl();

  // Persist the signature to the estimate row.
  try {
    const patchRes = await fetch(
      `${base}/rest/v1/invoices?id=eq.${encodeURIComponent(estimateId)}`,
      {
        method: 'PATCH',
        headers,
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
  } catch (e) {
    console.error('[submit-signature] DB write threw:', e);
    return send(res, 500, { error: 'Database write failed: ' + (e.message || e) });
  }

  // In-app notification (best effort).
  notifyAll({
    type: 'estimate_signed',
    title: 'Estimate signed',
    body: `${clientName || 'Client'} approved ${estimateId}`,
    invoiceId: estimateId,
    data: { clientName, total, job },
  }).catch((e) => console.error('[submit-signature] notify failed:', e));

  // Confirmation email to Jake (best effort).
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const signedTime = signedAt
        ? new Date(signedAt).toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' }) + ' HST'
        : 'Unknown';

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
              <tr><td style="padding: 10px 14px; color: #666;">Signed</td><td style="padding: 10px 14px;">${signedTime}</td></tr>
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
      console.error('[submit-signature] email send failed:', e);
    }
  }

  return send(res, 200, { ok: true });
}

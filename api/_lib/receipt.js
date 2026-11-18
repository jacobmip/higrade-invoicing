// /api/_lib/receipt.js — the automatic paid-in-full receipt (v1.85.20).
//
// When an invoice reaches a zero balance, the customer gets a receipt by email
// and by text, once, without Jake having to remember. Called from every place
// a payment lands:
//   * api/paypal-capture-order.js and api/paypal-webhook.js (direct import)
//   * api/stripe-webhook.js (edge, so it posts op send_receipt to sms-inbound)
//   * the app, after a save that carries a payment (op send_receipt)
//
// Guards, in order. Each one is why a receipt can NOT go out:
//   * not an invoice, deleted, or a balance still owed
//   * the newest payment is dated before yesterday (Honolulu). save_invoice
//     deletes and re-inserts payment rows on every save, so created_at is
//     useless here; the payment's own date is what says "just paid". This is
//     what stops an edit to an old paid job from mailing a receipt.
//   * auto_receipt_enabled = 'false' in settings (the off switch)
//   * receipt_sent_at already set. The claim is a conditional PATCH, so two
//     saves racing each other send one receipt (migration 130).
// If both channels fail the claim is released so the next save retries.
//
// Node only: sms.js uses node:crypto.

import { sendTwilioSms, getSetting, rpc, webhookSecret, recordSmsSnapshot } from './sms.js';
import { calcTotals, honoluluDate, supabaseCfg } from './invoice-money.js';
import { randomBytes } from 'node:crypto';

const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';

async function rest(path, opts = {}) {
  const { url, headers } = supabaseCfg();
  const r = await fetch(`${url}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} ${r.status}: ${text.slice(0, 200)}`);
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

const money = (n) => '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

function toE164(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return null;
}

// First name for a person, the whole name for a company. Same rule as the
// On My Way text (v1.85.17) and the invoice emails.
export function greetingName(client, fallbackName) {
  const first = String(client?.first_name || '').trim();
  if (first) return first;
  const name = String(client?.name || fallbackName || '').trim();
  if (!name) return 'there';
  if (client?.company_name || /\b(LLC|Inc|Corp|Construction|Contracting|Services|Co\.|Company)\b/i.test(name)) return name;
  return name.split(/\s+/)[0];
}

export function receiptText({ name, id, total, link }) {
  return `Aloha ${name},\n\nMahalo for your payment! Your invoice ${id} for ${total} is paid in full. Here is your receipt:\n${link}\n\nMahalo,\nHI Grade Plumbing`;
}

export function receiptEmailMessage({ name, id }) {
  return `Aloha ${name},\n\nMahalo for your payment. This email confirms that your invoice ${id} has been paid in full.\n\nWe truly appreciate the opportunity to work with you and your trust in HI Grade Plumbing. If you ever need anything else, a repair, a quote, or just a question, we're a phone call away.\n\nMahalo,\nHI Grade Plumbing`;
}

// Yesterday in Honolulu as YYYY-MM-DD.
function honoluluYesterday() {
  return honoluluDate(new Date(Date.now() - 24 * 3600e3));
}

function reviewLinks(settings) {
  const out = [];
  const on = (v, dflt) => (v == null || v === '' ? dflt : String(v) === 'true');
  // Same defaults as resolveReviewLinks() in src/App.jsx.
  const yUrl = String(settings.review_yelp_url || 'https://www.yelp.com/biz/hi-grade-plumbing-honolulu').trim();
  if (on(settings.review_yelp_enabled, false) && yUrl) out.push({ platform: 'yelp', url: yUrl });
  const gUrl = String(settings.review_google_url || '').trim();
  if (on(settings.review_google_enabled, false) && gUrl) out.push({ platform: 'google', url: gUrl });
  return out;
}

// Returns { sent: {email?, text?}, skipped?: reason, errors: [] }.
export async function sendPaidReceipt(invoiceId, { source = 'app' } = {}) {
  const id = String(invoiceId || '').trim();
  if (!id) return { skipped: 'no invoice id' };
  const enc = encodeURIComponent(id);
  const inv = (await rest(`invoices?id=eq.${enc}&select=*,clients(name,first_name,company_name,email,email2,phone,mobile)&limit=1`))?.[0];
  if (!inv) return { skipped: 'not found' };
  if (inv.type === 'estimate') return { skipped: 'estimate' };
  if (inv.deleted_at) return { skipped: 'deleted' };
  if (inv.receipt_sent_at) return { skipped: 'already sent' };

  const [items, payments] = await Promise.all([
    rest(`invoice_items?invoice_id=eq.${enc}&select=*`),
    rest(`payments?invoice_id=eq.${enc}&select=*`),
  ]);
  if (!payments?.length) return { skipped: 'no payments' };
  const t = calcTotals(inv, items, payments);
  if (!(t.paid > 0 && t.balance <= 0.01)) return { skipped: 'balance owed' };

  const latest = [...payments].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  if (!latest?.date || String(latest.date) < honoluluYesterday()) return { skipped: 'old payment' };

  const settingRows = await rest(`settings?key=in.(auto_receipt_enabled,sms_outbound_enabled,review_yelp_enabled,review_yelp_url,review_google_enabled,review_google_url)&select=key,value`);
  const settings = Object.fromEntries((settingRows || []).map(s => [s.key, s.value]));
  if (String(settings.auto_receipt_enabled || '').toLowerCase() === 'false') return { skipped: 'switched off' };

  // The claim. Only one caller gets a row back.
  const claimed = await rest(`invoices?id=eq.${enc}&receipt_sent_at=is.null`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ receipt_sent_at: new Date().toISOString() }),
  });
  if (!claimed?.length) return { skipped: 'already sent' };

  const client = inv.clients || {};
  const name = greetingName(client, inv.client_name);
  let token = inv.view_token;
  if (!token) {
    token = randomBytes(9).toString('base64url');
    await rest(`invoices?id=eq.${enc}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ view_token: token }) });
  }
  const link = `${APP_URL}/v/${token}`;
  const total = money(t.total);
  const sent = {}, errors = [];

  // Email: the same receipt the Send Email button builds (api/send-email.js),
  // so both look identical.
  const emails = [client.email, client.email2].map(e => String(e || '').trim()).filter(validEmail);
  if (emails.length) {
    try {
      const r = await fetch(`${APP_URL}/api/send-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emails[0], ccAddresses: emails.slice(1), bccAdmin: true,
          clientName: client.name || inv.client_name, invoiceId: id, total: t.total.toFixed(2),
          message: receiptEmailMessage({ name, id }), viewLink: link,
          reviewLinks: reviewLinks(settings), isPaidInFull: true,
          lastPayment: { method: latest.method || 'payment', date: latest.date },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `send-email ${r.status}`);
      sent.email = emails.join(', ');
    } catch (e) { errors.push(`email: ${e.message || e}`); }
  }

  const phone = toE164(client.mobile) || toE164(client.phone);
  if (phone) {
    try {
      if (String(settings.sms_outbound_enabled || 'false').toLowerCase() !== 'true') throw new Error('outbound texting is switched off');
      const body = receiptText({ name, id, total, link });
      const r = await sendTwilioSms({ to: phone, body });
      sent.text = phone;
      try {
        await rpc('log_client_message', { p_secret: await webhookSecret(), p_phone: phone, p_direction: 'outbound', p_body: body, p_call_id: r?.sid || null, p_media: null });
      } catch (e) { console.warn('[receipt] message log failed:', e.message || e); }
      try { await recordSmsSnapshot(id, phone, 'Receipt texted (auto)'); }
      catch (e) { console.warn('[receipt] snapshot failed:', e.message || e); }
    } catch (e) { errors.push(`text: ${e.message || e}`); }
  }

  if (!sent.email && !sent.text) {
    // Nothing reached the customer: release the claim so a later save retries.
    try {
      await rest(`invoices?id=eq.${enc}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ receipt_sent_at: null }) });
    } catch (e) { console.warn('[receipt] release failed:', e.message || e); }
    return { sent, errors, skipped: emails.length || phone ? 'all channels failed' : 'no email or phone on file' };
  }

  // History tab: shows as a send, and drops the invoice out of Unsent.
  try {
    await rest('invoice_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      invoice_id: id, kind: 'sent', recipient: [sent.email, sent.text].filter(Boolean).join(', '),
      meta: { kind: 'receipt', auto: true, source, channel: [sent.email && 'email', sent.text && 'sms'].filter(Boolean).join('+') },
    }) });
  } catch (e) { console.warn('[receipt] history event failed:', e.message || e); }

  return { sent, errors };
}

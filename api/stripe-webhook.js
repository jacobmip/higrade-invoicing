// /api/stripe-webhook — the only thing that records Stripe money.
//
// Edge runtime on purpose (the 12-Node-function cap, see CLAUDE.md), which
// rules out the Stripe SDK and node:crypto. Signature verification is done
// against the Web Crypto API here, following Stripe's documented scheme.
//
// ACH SAFETY, THE WHOLE REASON THIS FILE IS SHAPED THIS WAY.
// A bank debit can sail through checkout and then fail days later when the
// customer's account turns out to be short. So:
//   * checkout.session.completed      -> notify only. NEVER writes a payment.
//   * payment_intent.succeeded        -> the money has actually moved. Record.
//   * payment_intent.payment_failed   -> notify that it bounced.
// The ledger must never show an invoice paid before the funds settle, because
// Jake reads that ledger to decide whether to chase someone. Cards settle
// instantly, so for a card both events arrive together and nothing is lost.
//
// Dedupe: Stripe retries a webhook until it gets a 2xx, so the same event will
// arrive more than once. payments.stripe_payment_intent_id has a partial
// unique index (migration 128) and this also pre-checks, the same belt-and-
// braces the PayPal capture path uses.
//
// Configure in the Stripe dashboard: endpoint
// https://higrade-invoicing.vercel.app/api/stripe-webhook subscribed to
// payment_intent.succeeded, payment_intent.payment_failed and
// checkout.session.completed. Put the endpoint's signing secret in the Vercel
// env as STRIPE_WEBHOOK_SECRET or nothing here will verify.

export const config = { runtime: 'edge' };

import { supabaseCfg, reconcileInvoiceStatus, honoluluDate } from './_lib/invoice-money.js';

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const out = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json' },
});

const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// Length-independent compare over the hex strings. Both are the same fixed
// length for SHA-256, so the early length return leaks nothing useful.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe's scheme: the header carries `t=<unix>` and one or more `v1=<hex>`.
// The signed payload is the timestamp, a literal period, then the RAW body
// bytes exactly as received. Schemes other than v1 are ignored on purpose, so
// a future weaker scheme cannot be used to downgrade this check.
export async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, nowMs = Date.now()) {
  if (!header || !secret) return false;
  let t = null;
  const v1 = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  if (!t || v1.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  // Replay window. Without this, a captured request stays valid forever.
  if (Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = hex(mac);
  return v1.some(sig => timingSafeEqual(sig.toLowerCase(), expected));
}

function methodFor(type) {
  if (type === 'card') return 'Credit Card';
  if (type === 'us_bank_account') return 'Bank Transfer';
  return 'Other';
}

// Ask Stripe what was actually used. The PaymentIntent lists every method the
// session OFFERED, so it cannot tell us whether this was a card or a bank
// debit; only the charge knows. Falls back rather than failing the webhook.
async function chargeType(intent) {
  const fromExpanded = intent?.latest_charge?.payment_method_details?.type;
  if (fromExpanded) return fromExpanded;
  const id = typeof intent?.latest_charge === 'string' ? intent.latest_charge : null;
  if (!id || !STRIPE_SECRET) {
    return Array.isArray(intent?.payment_method_types) && intent.payment_method_types.length === 1
      ? intent.payment_method_types[0] : null;
  }
  try {
    const r = await fetch(`https://api.stripe.com/v1/charges/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
    });
    if (!r.ok) return null;
    const ch = await r.json();
    return ch?.payment_method_details?.type || null;
  } catch {
    return null;
  }
}

async function notify({ type, title, body, invoiceId, data }) {
  const { url, headers } = supabaseCfg();
  // In-app bell. Best effort: a notification must never fail the webhook,
  // because a non-2xx makes Stripe retry an event we already recorded.
  try {
    await fetch(`${url}/rest/v1/notifications`, {
      method: 'POST', headers,
      body: JSON.stringify({ type, title, body, invoice_id: invoiceId || null, data: data || {} }),
    });
  } catch (e) { console.error('[stripe] notification insert failed', e); }

  const tgToken = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID || '6234704324';
  if (!tgToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `${title}\n${body}`, disable_web_page_preview: true }),
    });
  } catch (e) { console.error('[stripe] telegram failed', e); }
}

async function recordPayment({ invoiceId, amount, intentId, sessionId, type }) {
  const { url, headers } = supabaseCfg();

  const dupeRes = await fetch(
    `${url}/rest/v1/payments?stripe_payment_intent_id=eq.${encodeURIComponent(intentId)}&select=id&limit=1`,
    { headers },
  );
  const dupes = await dupeRes.json().catch(() => []);
  if (Array.isArray(dupes) && dupes.length > 0) return { ok: true, deduped: true };

  const res = await fetch(`${url}/rest/v1/payments`, {
    method: 'POST', headers,
    body: JSON.stringify({
      invoice_id: invoiceId,
      amount: Number(amount),
      surcharge: 0,
      method: methodFor(type),
      // Honolulu, not UTC. toISOString() is already tomorrow here after 2pm.
      date: honoluluDate(),
      note: `Stripe ${type || 'payment'} - intent ${intentId}${sessionId ? ` - session ${sessionId}` : ''}`,
      stripe_payment_intent_id: intentId,
      stripe_session_id: sessionId || null,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    // A unique violation means a concurrent delivery won the race. That is a
    // success, not a failure: the money is recorded exactly once.
    if (res.status === 409 || /duplicate key|23505/.test(t)) return { ok: true, deduped: true };
    throw new Error(`payment insert failed: ${res.status} ${t}`);
  }
  return { ok: true };
}

export default async function handler(req) {
  if (req.method !== 'POST') return out(405, { error: 'method_not_allowed' });
  if (!WEBHOOK_SECRET) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET missing; refusing to trust this request');
    return out(500, { error: 'webhook_not_configured' });
  }

  // Raw text BEFORE any parsing. Parsing and re-serialising changes the bytes
  // and the signature will not match.
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  const valid = await verifyStripeSignature(raw, sig, WEBHOOK_SECRET);
  if (!valid) return out(400, { error: 'bad_signature' });

  let event;
  try { event = JSON.parse(raw); } catch { return out(400, { error: 'bad_json' }); }

  const obj = event?.data?.object || {};
  const invoiceId = obj?.metadata?.invoice_id || obj?.client_reference_id || null;

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        if (!invoiceId) {
          console.error('[stripe] succeeded with no invoice_id, intent', obj.id);
          return out(200, { ok: true, ignored: 'no_invoice_id' });
        }
        const type = await chargeType(obj);
        const amount = (Number(obj.amount_received ?? obj.amount ?? 0)) / 100;
        const r = await recordPayment({
          invoiceId, amount, intentId: obj.id,
          sessionId: obj?.metadata?.session_id || null, type,
        });
        if (!r.deduped) {
          await reconcileInvoiceStatus(invoiceId);
          await notify({
            type: 'payment',
            title: `Payment received: $${amount.toFixed(2)}`,
            body: `${methodFor(type)} on ${invoiceId}, via Stripe.`,
            invoiceId,
            data: { source: 'stripe', intent: obj.id, method: methodFor(type) },
          });
        }
        return out(200, { ok: true, deduped: !!r.deduped });
      }

      case 'payment_intent.payment_failed': {
        const reason = obj?.last_payment_error?.message || 'no reason given';
        await notify({
          type: 'payment_failed',
          title: 'Online payment failed',
          body: `${invoiceId || 'unknown invoice'}: ${reason}. Nothing was recorded, so the invoice still shows a balance.`,
          invoiceId,
          data: { source: 'stripe', intent: obj.id },
        });
        return out(200, { ok: true });
      }

      case 'checkout.session.completed': {
        // Deliberately records nothing. For a card the succeeded event lands
        // at the same moment and does the recording; for ACH this is days
        // early and the money may still fail.
        if (obj.payment_status !== 'paid') {
          const amount = Number(obj.amount_total ?? 0) / 100;
          await notify({
            type: 'payment_pending',
            title: `Bank payment started: $${amount.toFixed(2)}`,
            body: `${invoiceId || 'unknown invoice'} was paid by bank transfer. ACH takes a few business days, so the invoice stays open until it clears.`,
            invoiceId,
            data: { source: 'stripe', session: obj.id },
          });
        }
        return out(200, { ok: true });
      }

      default:
        // 200 so Stripe stops retrying something we do not care about.
        return out(200, { ok: true, ignored: event.type });
    }
  } catch (e) {
    // 500 makes Stripe retry, which is what we want for a transient database
    // failure. The dedupe keys make a retry safe.
    console.error('[stripe] handler error', e);
    return out(500, { error: 'handler_error', message: String(e?.message || e) });
  }
}

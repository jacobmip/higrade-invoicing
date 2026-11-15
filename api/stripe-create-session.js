// /api/stripe-create-session — start a Stripe Checkout session for an invoice.
//
// Edge runtime on purpose. The project sits exactly at Vercel Hobby's 12 Node
// function cap (see CLAUDE.md), and edge routes do not count against it, so
// the Stripe rail costs zero slots. That rules out the Stripe npm SDK (it
// reaches for node:https) and api/_lib/convert-estimate.js (node:crypto), so
// this talks to Stripe's REST API with plain fetch and takes its money math
// from api/_lib/invoice-money.js, which is edge-safe by design.
//
// POST { token }            token is the invoice's customer-facing view_token
//   -> 200 { url, session_id, amount, methods }   browser redirects to url
//   -> 400 { error: 'no_balance_due' | 'estimates_not_supported' }
//   -> 404 { error: 'not_found' }
//
// The amount is ALWAYS re-derived here from the database. The browser never
// sends an amount, because a hostile caller would simply send a smaller one.
//
// No surcharge is added. The online surcharge was turned off in v1.84.0 (no
// compliant rate exists while a processor cannot tell us the card type before
// the amount is fixed, and surcharging debit is barred nationwide). ACH costs
// 0.8% capped at $5, so there is nothing worth passing on. Do not re-add one
// here without reading the comment block in src/App.jsx first.
//
// Estimates are deliberately not supported in v1. The PayPal rail has an
// estimate down-payment path that auto-converts the estimate to an invoice,
// but it has never once fired in production (zero rows), and it is the only
// thing that needs the node-only conversion library. Invoices only, for now.

export const config = { runtime: 'edge' };

import { loadByViewToken, calcTotals, calcLateFee } from './_lib/invoice-money.js';

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

const out = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json' },
});

// Stripe's REST API takes application/x-www-form-urlencoded with bracketed
// keys for nested objects, not JSON.
function form(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) p.append(k, String(v));
  }
  return p;
}

async function createSession(params) {
  const res = await fetch(STRIPE_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form(params),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

export default async function handler(req) {
  if (req.method !== 'POST') return out(405, { error: 'method_not_allowed' });
  if (!STRIPE_SECRET) return out(500, { error: 'stripe_not_configured' });

  let token;
  try {
    const parsed = await req.json();
    token = parsed?.token;
  } catch {
    return out(400, { error: 'bad_request' });
  }
  if (!token) return out(400, { error: 'missing_token' });

  let loaded;
  try {
    loaded = await loadByViewToken(token);
  } catch {
    return out(404, { error: 'not_found' });
  }
  const { inv, items, payments, settings } = loaded;

  if (inv.type === 'estimate') return out(400, { error: 'estimates_not_supported' });

  const totals = calcTotals(inv, items, payments);
  const lateFee = calcLateFee(inv, totals, settings);
  const payable = +(totals.balance + lateFee).toFixed(2);
  if (payable <= 0) return out(400, { error: 'no_balance_due' });

  // Stripe works in the currency's smallest unit.
  const cents = Math.round(payable * 100);
  const origin = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
  const label = `Invoice ${inv.id} - HI Grade Plumbing`;

  const base = {
    mode: 'payment',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': cents,
    'line_items[0][price_data][product_data][name]': label,
    success_url: `${origin}/v/${encodeURIComponent(token)}?paid=1`,
    cancel_url: `${origin}/v/${encodeURIComponent(token)}`,
    client_reference_id: inv.id,
    'metadata[invoice_id]': inv.id,
    'metadata[view_token]': token,
    // The webhook that records the money listens to payment_intent.succeeded,
    // and that event carries the PaymentIntent's OWN metadata, not the
    // session's. Both are set so either event can find the invoice.
    'payment_intent_data[metadata][invoice_id]': inv.id,
    'payment_intent_data[metadata][view_token]': token,
    'payment_intent_data[description]': label,
  };

  // Try card + ACH. ACH has to be switched on for the Stripe account before
  // it can be requested, so if it is not active yet fall back to card alone
  // rather than leaving the customer with no way to pay at all.
  let attempt = await createSession({
    ...base,
    'payment_method_types[0]': 'card',
    'payment_method_types[1]': 'us_bank_account',
  });
  let methods = ['card', 'us_bank_account'];

  if (!attempt.ok) {
    const msg = String(attempt.body?.error?.message || '');
    const achProblem = /us_bank_account|bank account|not activated|invalid payment method type/i.test(msg);
    if (achProblem) {
      attempt = await createSession({ ...base, 'payment_method_types[0]': 'card' });
      methods = ['card'];
    }
  }

  if (!attempt.ok) {
    return out(502, {
      error: 'stripe_session_failed',
      detail: attempt.body?.error?.message || `HTTP ${attempt.status}`,
    });
  }

  return out(200, {
    url: attempt.body.url,
    session_id: attempt.body.id,
    amount: payable,
    late_fee: lateFee,
    methods,
  });
}

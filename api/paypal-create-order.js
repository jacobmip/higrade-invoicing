// Create a PayPal order for an outstanding invoice balance.
//
// Called by the PayPal Smart Buttons on the public viewer page after the
// customer clicks "Pay with PayPal." We re-derive the balance + surcharge
// server-side from Supabase (never trust the amount the browser sends — a
// hostile user could lower it) and create an order on PayPal's REST API.
//
// Returns { id } where id is the PayPal order ID. The browser then hands
// that ID back to PayPal so the buyer can approve, after which our
// /api/paypal-capture-order endpoint actually captures the payment and
// records it on the invoice.

export const config = { runtime: 'nodejs' };

// Toggle live vs sandbox via env. Default to live for production safety —
// you must explicitly set PAYPAL_ENV=sandbox to point at the test API.
function paypalBase() {
  return (process.env.PAYPAL_ENV || 'live').toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

// Exchange the client_id + secret for a short-lived OAuth token. PayPal
// caches these for a few hours but we just request a fresh one per
// request — simpler, and these endpoints are low-volume.
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${t}`);
  }
  const j = await res.json();
  return j.access_token;
}

// Hit Supabase REST directly so this stays an edge function (no client
// SDK needed). The anon key is safe here because Row Level Security only
// permits reading invoices via view_token — same path the public viewer
// uses to render the page.
async function fetchInvoiceByToken(token) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const invRes = await fetch(`${url}/rest/v1/invoices?view_token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { headers });
  const invs = await invRes.json();
  if (!Array.isArray(invs) || invs.length === 0) throw new Error('Invoice not found');
  const inv = invs[0];

  const itemsRes = await fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(inv.id)}&select=*`, { headers });
  const items = await itemsRes.json();

  const paysRes = await fetch(`${url}/rest/v1/payments?invoice_id=eq.${encodeURIComponent(inv.id)}&select=*`, { headers });
  const pays = await paysRes.json();

  // Fetch surcharge config from settings.
  const settingsRes = await fetch(`${url}/rest/v1/settings?key=in.(surcharge_enabled,surcharge_pct,surcharge_flat,late_fee_rate)&select=*`, { headers });
  const settings = await settingsRes.json();
  const settingsMap = {};
  for (const s of (Array.isArray(settings) ? settings : [])) settingsMap[s.key] = s.value;

  return { inv, items: items || [], payments: pays || [], settings: settingsMap };
}

// Mirror the in-app totals math so the server-derived balance matches
// what the customer sees on the public viewer page.
function calcTotals(inv, items, payments) {
  const itemTotal = (it) => {
    const qty = parseFloat(it.qty ?? 1);
    const price = parseFloat(it.price ?? 0);
    const base = qty * price;
    const disc = parseFloat(it.discount ?? 0);
    if (it.discount_type === '%') return base * (1 - disc / 100);
    return Math.max(0, base - disc);
  };
  const sub = items.reduce((s, it) => s + itemTotal(it), 0);
  const taxableSub = items.filter(it => it.taxable !== false).reduce((s, it) => s + itemTotal(it), 0);
  let disc = 0;
  if (inv.discount) {
    if (inv.discount_type === '%') disc = sub * (parseFloat(inv.discount) / 100);
    else disc = parseFloat(inv.discount);
  }
  const taxBase = Math.max(0, taxableSub - disc * (taxableSub / Math.max(sub, 1)));
  const taxAmt = taxBase * (parseFloat(inv.tax || 4.712) / 100);
  const total = Math.max(0, sub - disc + taxAmt);
  const paid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  return { sub, disc, taxAmt, total, paid, balance: Math.max(0, total - paid) };
}

function calcLateFee(inv, totals, settings) {
  if (inv.type === 'estimate' || !inv.due_date) return 0;
  if (totals.balance <= 0) return 0;
  const due = new Date(inv.due_date);
  if (isNaN(due)) return 0;
  const ms = Date.now() - due.getTime();
  if (ms <= 30 * 24 * 60 * 60 * 1000) return 0;
  const months = Math.floor(ms / (30 * 24 * 60 * 60 * 1000));
  const r = settings.late_fee_rate;
  const rate = (r != null && r !== '' && !isNaN(Number(r))) ? Number(r) : 1.5;
  return +(totals.balance * (rate / 100) * months).toFixed(2);
}

function calcSurcharge(amount, settings) {
  const en = settings.surcharge_enabled;
  const enabled = (en == null || en === '') ? true : (en === 'true' || en === true);
  if (!enabled) return 0;
  const sp = settings.surcharge_pct;
  const sf = settings.surcharge_flat;
  const pct = (sp != null && sp !== '' && !isNaN(Number(sp))) ? Number(sp) : 3.49;
  const flat = (sf != null && sf !== '' && !isNaN(Number(sf))) ? Number(sf) : 0.49;
  const base = Math.max(0, Number(amount) || 0);
  if (base <= 0) return 0;
  return +(base * (pct / 100) + flat).toFixed(2);
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'missing_token' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { inv, items, payments, settings } = await fetchInvoiceByToken(token);
    if (inv.type === 'estimate') {
      return new Response(JSON.stringify({ error: 'estimates_not_payable' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const totals = calcTotals(inv, items, payments);
    const lateFee = calcLateFee(inv, totals, settings);
    const balanceWithLateFee = +(totals.balance + lateFee).toFixed(2);
    if (balanceWithLateFee <= 0) {
      return new Response(JSON.stringify({ error: 'no_balance_due' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const surcharge = calcSurcharge(balanceWithLateFee, settings);
    const grandTotal = +(balanceWithLateFee + surcharge).toFixed(2);

    const accessToken = await paypalAccessToken();
    const orderRes = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: inv.id,
          custom_id: token, // we use this on capture to look the invoice back up
          description: `Invoice ${inv.id} \u2014 HI Grade Plumbing`,
          invoice_id: inv.id,
          amount: {
            currency_code: 'USD',
            value: grandTotal.toFixed(2),
            breakdown: {
              item_total: { currency_code: 'USD', value: balanceWithLateFee.toFixed(2) },
              handling:   { currency_code: 'USD', value: surcharge.toFixed(2) },
            },
          },
          items: [{
            name: `Invoice ${inv.id}`,
            quantity: '1',
            unit_amount: { currency_code: 'USD', value: balanceWithLateFee.toFixed(2) },
            category: 'DIGITAL_GOODS',
          }],
        }],
        application_context: {
          brand_name: 'HI Grade Plumbing LLC',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      }),
    });

    if (!orderRes.ok) {
      const t = await orderRes.text();
      return new Response(JSON.stringify({ error: 'paypal_order_failed', detail: t }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }
    const order = await orderRes.json();
    return new Response(JSON.stringify({
      id: order.id,
      balance: balanceWithLateFee,
      surcharge,
      total: grandTotal,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e?.message || e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

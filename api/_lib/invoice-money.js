// Server-side money math for the payment rails. EDGE-SAFE ON PURPOSE: no
// `node:` imports anywhere in this file, so an edge route can import it.
//
// Why this file exists. "What does this invoice still owe" was written out
// three times on the server (api/paypal-create-order.js, the reconcile step in
// api/_lib/convert-estimate.js) on top of the two browser copies in
// src/App.jsx and src/printablePdf.js. Divergence in this math is not a
// cosmetic bug: it is the difference between charging a customer $30 and
// charging them 30%. api/_lib/convert-estimate.js now re-exports
// reconcileInvoiceStatus from here so the server has one implementation.
//
// Conventions that have each caused a real bug before:
//   * discount_type is the literal '%' or '$'. Never 'percent'.
//   * default tax is 4.712 (Oahu GET). Only fall back when inv.tax is unset.
//   * payments.date is TEXT 'YYYY-MM-DD', and it must be the Honolulu date.
//     new Date().toISOString() is UTC, which is already tomorrow in Hawaii
//     after 2pm, so it must not be used for a payment date.

export function supabaseCfg() {
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

// 'YYYY-MM-DD' in Honolulu. en-CA formats as ISO, which is why it is used
// here rather than assembling the parts by hand.
export function honoluluDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' });
}

const itemTotal = (it) => {
  const qty = parseFloat(it.qty ?? 1);
  const price = parseFloat(it.price ?? 0);
  const base = qty * price;
  const disc = parseFloat(it.discount ?? 0);
  if (it.discount_type === '%') return base * (1 - disc / 100);
  return Math.max(0, base - disc);
};

// Mirrors the in-app totals so a server-derived balance matches what the
// customer sees on the public viewer page.
export function calcTotals(inv, items, payments) {
  const list = items || [];
  const sub = list.reduce((s, it) => s + itemTotal(it), 0);
  const taxableSub = list.filter(it => it.taxable !== false).reduce((s, it) => s + itemTotal(it), 0);
  let disc = 0;
  if (inv.discount) {
    if (inv.discount_type === '%') disc = sub * (parseFloat(inv.discount) / 100);
    else disc = parseFloat(inv.discount);
  }
  const taxBase = Math.max(0, taxableSub - disc * (taxableSub / Math.max(sub, 1)));
  const taxAmt = taxBase * (parseFloat(inv.tax || 4.712) / 100);
  const total = Math.max(0, sub - disc + taxAmt);
  const paid = (payments || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  return { sub, disc, taxAmt, total, paid, balance: Math.max(0, total - paid) };
}

// 1.5%/month by default, and only once the invoice is more than 30 days past
// its due date. Estimates never carry one.
export function calcLateFee(inv, totals, settings) {
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

// Load everything the payable amount depends on, by the customer-facing
// view token. Service role, so RLS is bypassed: the token IS the credential,
// which is the same trust model api/public-invoice.js uses.
export async function loadByViewToken(token) {
  const { url, headers } = supabaseCfg();
  const invRes = await fetch(`${url}/rest/v1/invoices?view_token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { headers });
  const invs = await invRes.json();
  if (!Array.isArray(invs) || invs.length === 0) throw new Error('Invoice not found');
  const inv = invs[0];

  const [itemsRes, paysRes, settingsRes] = await Promise.all([
    fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(inv.id)}&select=*`, { headers }),
    fetch(`${url}/rest/v1/payments?invoice_id=eq.${encodeURIComponent(inv.id)}&select=*`, { headers }),
    fetch(`${url}/rest/v1/settings?key=in.(late_fee_rate)&select=*`, { headers }),
  ]);
  const items = await itemsRes.json();
  const payments = await paysRes.json();
  const srows = await settingsRes.json();
  const settings = {};
  for (const s of (Array.isArray(srows) ? srows : [])) settings[s.key] = s.value;

  return { inv, items: items || [], payments: payments || [], settings };
}

// Flip an invoice to paid / partial from the sum of its payment rows.
// Re-exported by api/_lib/convert-estimate.js; do not fork it.
export async function reconcileInvoiceStatus(invoiceId) {
  const { url, headers } = supabaseCfg();
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

  const totals = calcTotals(inv, items, pays);
  const balance = +(totals.total - totals.paid).toFixed(2);

  // 1-cent tolerance so float rounding cannot strand a paid invoice in
  // 'partial' forever.
  let newStatus = inv.status;
  if (balance <= 0.01) newStatus = 'paid';
  else if (totals.paid > 0) newStatus = 'partial';

  if (newStatus !== inv.status) {
    await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() }),
    });
  }
}

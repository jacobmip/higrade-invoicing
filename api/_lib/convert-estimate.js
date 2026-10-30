// Shared estimate -> invoice conversion for the server-side paths: PayPal
// capture (a deposit on an estimate) and the public viewer's Approve & Sign.
// A helper, not a route, so it does not count against the 12-function ceiling.
//
// Keeps the same rules as the app's manual conversion: the number identifies
// the job (EST1000 -> INV1000, fresh number only when the pair is taken), items
// are copied at full price, the schedule moves to the invoice, recorded deposits
// move with it, and the estimate ends 'converted' with converted_to_id set.
// Idempotent: an estimate that already has converted_to_id returns that invoice.

import crypto from 'node:crypto';

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

// base64url, ~12 chars — same shape as the in-app generateViewToken so
// customer-facing /v/<token> URLs look consistent.
function generateViewToken() {
  const bytes = crypto.randomBytes(9);
  return bytes.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// If the reference row is an estimate, convert it into a real INV####
// (items copied at full price), and return the new invoice id + token so
// the caller records the down-payment against the new invoice. Idempotent:
// if the estimate has already been converted (converted_to_id set), we
// just return that existing id.
export async function convertEstimateToInvoice(estimateId) {
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
    return { invoiceId: est.id, alreadyConverted: false, viewToken: est.view_token, clientName: est.client_name || '' };
  }
  if (est.converted_to_id) {
    // Already converted on a previous capture — re-use.
    const linkRes = await fetch(
      `${url}/rest/v1/invoices?id=eq.${encodeURIComponent(est.converted_to_id)}&select=id,view_token&limit=1`,
      { headers }
    );
    const linkRows = await linkRes.json();
    if (Array.isArray(linkRows) && linkRows.length > 0) {
      return { invoiceId: linkRows[0].id, alreadyConverted: true, viewToken: linkRows[0].view_token, clientName: est.client_name || '' };
    }
  }

  // Pull items + the shared document counter + every existing id.
  const [itemsRes, settingsRes, allInvRes] = await Promise.all([
    fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(estimateId)}&order=sort_order.asc&select=*`, { headers }),
    fetch(`${url}/rest/v1/settings?key=eq.next_doc_num&select=*`, { headers }),
    fetch(`${url}/rest/v1/invoices?select=id`, { headers }),
  ]);
  const items = await itemsRes.json();
  const settingRows = await settingsRes.json();
  const allInv = await allInvRes.json();

  const takenIds = new Set(Array.isArray(allInv) ? allInv.map(r => r.id) : []);

  // Same rule the app follows: the number identifies the job, so a converted
  // estimate keeps it (EST1000 -> INV1000). Safe because the shared sequence
  // issued that number once. Legacy numbers come from the old side-by-side
  // sequences where INV0767 and EST0767 are both real and unrelated, so when
  // the paired id is taken we fall back to a fresh number off the shared
  // counter and let the cross-link button carry the relationship instead.
  const SHARED_NUMBER_FLOOR = 1000;
  let persistedNext = 0;
  if (Array.isArray(settingRows) && settingRows.length > 0) {
    persistedNext = parseInt(settingRows[0].value, 10) || 0;
  }
  let highestAny = 0;
  for (const id of takenIds) {
    const m = /^(?:EST|INV)(\d+)$/.exec(id || '');
    if (m) highestAny = Math.max(highestAny, parseInt(m[1], 10));
  }

  const estNum = parseInt((/^(?:EST|INV)(\d+)$/.exec(estimateId) || [])[1], 10);
  const pairedId = Number.isFinite(estNum) ? 'INV' + String(estNum).padStart(4, '0') : null;

  let num, newId;
  if (pairedId && !takenIds.has(pairedId)) {
    num = estNum;
    newId = pairedId;
  } else {
    num = Math.max(persistedNext, highestAny + 1, SHARED_NUMBER_FLOOR);
    newId = 'INV' + String(num).padStart(4, '0');
    if (pairedId) console.warn(`[convert-estimate] ${pairedId} taken; minted ${newId} for ${estimateId}`);
  }
  const viewToken = generateViewToken();
  const movedVisits = (Array.isArray(est.visits) ? est.visits : []).map(v => ({ ...v, kind: 'job' }));
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
      // Whoever ran the estimate runs the invoice (migration 053).
      assigned_tech_id: est.assigned_tech_id || est.owner_id || null,
      // Keep the estimate's apprentice (migration 094). A null here is filled
      // with the Default Apprentice by the insert trigger; the PATCH below puts
      // back an estimate that deliberately had none.
      apprentice_id: est.apprentice_id || null,
      // The invoice takes the estimate's schedule (kind relabelled to 'job') and
      // so its Google event ids; the estimate lets go of them below, so no two
      // rows claim one event. The sync_first_visit trigger derives gcal_date,
      // gcal_event_id and gcal_duration_minutes from visits on insert.
      ...(movedVisits.length ? { visits: movedVisits } : {}),
    }),
  });
  if (!insertRes.ok) {
    const t = await insertRes.text();
    throw new Error(`Invoice insert failed: ${insertRes.status} ${t}`);
  }

  // The estimate deliberately had no apprentice: undo the Default Apprentice the
  // insert trigger stamped on the new invoice.
  if (!est.apprentice_id) {
    const appRes = await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(newId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ apprentice_id: null }),
    });
    if (!appRes.ok) console.error('[convert-estimate] apprentice clear failed:', await appRes.text());
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
      console.error('[convert-estimate] owner_id backfill failed:', await ownRes.text());
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
      console.error('[convert-estimate] item copy failed:', await itemsInsertRes.text());
    }
  }

  // Deposits already recorded on the estimate (hand-keyed or earlier PayPal) move
  // with the job, as they do in the app's manual conversion. A move, not a copy,
  // so paypal_capture_id's unique index is never hit and nothing is counted twice.
  {
    const payMove = await fetch(`${url}/rest/v1/payments?invoice_id=eq.${encodeURIComponent(estimateId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ invoice_id: newId }),
    });
    if (!payMove.ok) console.error('[convert-estimate] payment move failed:', await payMove.text());
  }

  // Advance the shared counter past whatever we just used. Only ever forwards:
  // read the current value again and keep the larger, so a concurrent write
  // cannot walk it backwards onto a number already issued.
  {
    const curRes = await fetch(`${url}/rest/v1/settings?key=eq.next_doc_num&select=value`, { headers });
    const curRows = await curRes.json();
    const current = Array.isArray(curRows) && curRows.length ? (parseInt(curRows[0].value, 10) || 0) : 0;
    const advanced = Math.max(current, num + 1, SHARED_NUMBER_FLOOR);
    await fetch(`${url}/rest/v1/settings?key=eq.next_doc_num`, { method: 'DELETE', headers });
    await fetch(`${url}/rest/v1/settings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: 'next_doc_num', value: String(advanced) }),
    });
  }

  // Link the estimate to the new invoice and release its schedule. Be loud about
  // failures here: a silent miss leaves an open estimate dangling next to its
  // real invoice. gcal_* are nulled alongside visits because the trigger only
  // runs for a non-empty visits array.
  const newStatus = 'converted';
  const linkRes = await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(estimateId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      converted_to_id: newId,
      status: newStatus,
      ...(movedVisits.length ? { visits: [], gcal_date: null, gcal_event_id: null, gcal_duration_minutes: null } : {}),
    }),
  });
  if (!linkRes.ok) {
    const t = await linkRes.text();
    console.error('[convert-estimate] link patch failed:', linkRes.status, t);
    // Roll back the new invoice + items so we don't leave orphans.
    try {
      await fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
      await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
    } catch (cleanupErr) {
      console.error('[convert-estimate] rollback failed:', cleanupErr);
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
    console.error('[convert-estimate] link patch did not persist:', verifyRows);
    try {
      await fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
      await fetch(`${url}/rest/v1/invoices?id=eq.${encodeURIComponent(newId)}`, { method: 'DELETE', headers });
    } catch (cleanupErr) {
      console.error('[convert-estimate] rollback failed:', cleanupErr);
    }
    throw new Error('Estimate link patch did not persist');
  }

  return { invoiceId: newId, alreadyConverted: false, viewToken, clientName: est.client_name || '' };
}

// After recording a payment, mirror the in-app totals math against the
// invoice's items + payments and flip the invoice's status column. The
// in-app list/dashboard UI keys off `invoices.status`, so without this
// update a paid invoice keeps showing as 'outstanding' until the user
// edits it manually.
export async function reconcileInvoiceStatus(invoiceId) {
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


// Telegram message to Jake. Best effort: needs TELEGRAM_TOKEN in the Vercel env
// (the HI Grade Manager bot's token; chat id defaults to Jake's).
export async function telegramNotify(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID || '6234704324';
  if (!token) { console.warn('[convert-estimate] TELEGRAM_TOKEN not set; skipped:', text); return false; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.error('[convert-estimate] telegram refused:', JSON.stringify(j).slice(0, 200));
    return !!j.ok;
  } catch (e) {
    console.error('[convert-estimate] telegram failed:', e);
    return false;
  }
}

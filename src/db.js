import { supabase } from './supabase.js'

// ─── Shape helpers ────────────────────────────────────────────────────────────

function toInvoice(row, items = [], payments = []) {
  return {
    id: row.id,
    type: row.type,
    client: row.client_name || '',
    client_id: row.client_id,
    date: row.date,
    dueDate: row.due_date,
    status: row.status,
    tax: parseFloat(row.tax ?? 4.712),
    discount: parseFloat(row.discount ?? 0),
    discountType: row.discount_type || '$',
    notes: row.notes || '',
    year: row.year,
    gcalDate: row.gcal_date || null,
    gcalEventId: row.gcal_event_id || null,
    followUpDate: row.follow_up_date || null,
    followUpEventId: row.follow_up_event_id || null,
    signatureData: row.signature_data || null,
    signedAt: row.signed_at || null,
    clientInfo: row.client_info || null,
    convertedToId: row.converted_to_id || null,
    viewToken: row.view_token || null,
    jobAddress: row.job_address || null,
    billingAddress: row.billing_address || null,
    // Down-payment workflow (estimates only — see migration 016).
    // downPaymentPct: 0–100, the % of the estimate total to bill on signing.
    // downPaymentInvoiceId: id of the invoice auto-created when the customer
    // signed; surfaces a link from the estimate to its down-payment invoice.
    downPaymentPct: parseInt(row.down_payment_pct ?? 0, 10),
    downPaymentInvoiceId: row.down_payment_invoice_id || null,
    // Optimistic-lock token. The server returns this on every save and we
    // pass it back on the next save so a concurrent edit on another device
    // can be detected before it overwrites changes.
    updatedAt: row.updated_at || null,
    items: items
      .filter(it => it.invoice_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(it => ({
        name: it.name || '',
        // server column is `description`; older code used `desc` — accept both
        desc: it.description ?? it.desc ?? '',
        qty: parseFloat(it.qty ?? 1),
        price: parseFloat(it.price ?? 0),
        unit: it.unit || 'ea',
        discount: parseFloat(it.discount ?? 0),
        discountType: it.discount_type || '%',
        taxable: it.taxable !== false,
      })),
    payments: payments
      .filter(p => p.invoice_id === row.id)
      .map(p => ({
        id: p.id,
        amount: parseFloat(p.amount),
        surcharge: parseFloat(p.surcharge ?? 0),
        method: p.method || '',
        date: p.date,
        note: p.note || '',
        paypal_order_id: p.paypal_order_id || null,
        paypal_capture_id: p.paypal_capture_id || null,
      })),
  }
}

function toClient(row) {
  // Promote legacy flat address1/2/3 into a single unlabeled entry in
  // addresses[] when addresses is empty/missing. Keeps old data usable
  // even before migration 008 is applied. Label is blank — a single
  // address with no nickname is implicitly the primary one.
  let addresses = Array.isArray(row.addresses) ? row.addresses : []
  const hasFlat = !!(row.address1 || row.address2 || row.address3)
  if (addresses.length === 0 && hasFlat) {
    addresses = [{
      id: 'primary',
      label: '',
      line1: row.address1 || '',
      line2: row.address2 || '',
      line3: row.address3 || '',
    }]
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    email2: row.secondary_email || '',
    mobile: row.mobile || '',
    phone: row.phone || '',
    fax: row.fax || '',
    contact: row.contact || '',
    // Legacy flat fields kept for any code path that still reads them
    address1: row.address1 || '',
    address2: row.address2 || '',
    address3: row.address3 || '',
    // New structured addresses
    addresses,
    billingAddress: row.billing_address || null,
  }
}

function toSavedItem(row) {
  return {
    id: row.id,
    category: row.category || 'Custom',
    name: row.name,
    // server column is `description`
    desc: row.description ?? row.desc ?? '',
    price: parseFloat(row.price ?? 0),
    taxable: row.taxable !== false,
    unit: row.unit || '',
  }
}

function toExpense(row) {
  return {
    id: row.id,
    date: row.date,
    merchant: row.merchant || '',
    amount: parseFloat(row.amount ?? 0),
    category: row.category || '',
    description: row.description || '',
    receiptData: row.receipt_data || null,
  }
}

// ─── Load all ─────────────────────────────────────────────────────────────────

// Supabase caps a single .select() at 1,000 rows by default. Once the
// invoice_items table grew past that (which happened the moment we
// imported historical line items), the most recent ~440 rows were
// silently dropped — making estimates appear empty in the UI even
// though the data was in the DB. This helper pages through any builder
// in 1,000-row chunks until the result set is fully drained.
async function fetchAllRows(buildQuery) {
  const PAGE = 1000
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return { data: out, error: null }
}

export async function loadAll() {
  const [
    { data: clientRows, error: e1 },
    { data: invoiceRows, error: e2 },
    { data: itemRows, error: e3 },
    { data: paymentRows, error: e4 },
    { data: savedItemRows, error: e5 },
    { data: expenseRows, error: e6 },
    { data: settingRows, error: e7 },
  ] = await Promise.all([
    supabase.from('clients').select('*').order('name'),
    // Sort by invoice date (newest first), with created_at as a secondary key
    // so two invoices with the same date order by entry time. Sorting by date
    // matches what users expect when scanning the list — and is the correct
    // order for back-dated entries (e.g. CSV imports) too.
    // Paginate so we don't lose anything once the table passes 1,000 rows.
    fetchAllRows(() => supabase.from('invoices').select('*').order('date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })),
    fetchAllRows(() => supabase.from('invoice_items').select('*').order('invoice_id').order('sort_order')),
    fetchAllRows(() => supabase.from('payments').select('*').order('invoice_id')),
    supabase.from('saved_items').select('*').order('category').order('name'),
    supabase.from('expenses').select('*').order('date', { ascending: false }),
    supabase.from('settings').select('*'),
  ])

  const err = e1 || e2 || e3 || e4 || e5 || e6 || e7
  if (err) throw err

  // Persisted setting can drift behind reality (bulk imports inserted rows by
  // explicit ID without bumping the counter). Always compute next_num from
  // the actual highest INV#### in the data and use whichever is greater.
  const persisted = parseInt(
    (settingRows || []).find(s => s.key === 'next_num')?.value ?? '1', 10
  ) || 1
  const highestActual = (invoiceRows || []).reduce((mx, row) => {
    if (row.type !== 'invoice') return mx
    const m = /^INV(\d+)$/.exec(row.id || '')
    return m ? Math.max(mx, parseInt(m[1], 10)) : mx
  }, 0)
  const nextNum = Math.max(persisted, highestActual + 1)

  // Estimates have their own counter (EST####) — derived from the highest
  // existing EST id at load time. Persisted as next_estimate_num once
  // we start writing it, but always clamped to highest actual.
  const persistedEst = parseInt(
    (settingRows || []).find(s => s.key === 'next_estimate_num')?.value ?? '1', 10
  ) || 1
  const highestActualEst = (invoiceRows || []).reduce((mx, row) => {
    if (row.type !== 'estimate') return mx
    const m = /^EST(\d+)$/.exec(row.id || '')
    return m ? Math.max(mx, parseInt(m[1], 10)) : mx
  }, 0)
  const nextEstimateNum = Math.max(persistedEst, highestActualEst + 1)

  // Roll the rest of the settings (everything that isn't a counter) into a
  // simple {key: value} map so the UI can read user preferences like custom
  // email/text message templates without re-querying the table.
  const settings = {}
  for (const row of (settingRows || [])) {
    if (row?.key && row.key !== 'next_num' && row.key !== 'next_estimate_num') {
      settings[row.key] = row.value
    }
  }

  return {
    invoices: (invoiceRows || []).map(row => toInvoice(row, itemRows || [], paymentRows || [])),
    clients: (clientRows || []).map(toClient),
    savedItems: (savedItemRows || []).map(toSavedItem),
    expenses: (expenseRows || []).map(toExpense),
    settings,
    nextNum,
    nextEstimateNum,
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────
// User preferences (custom email/text message templates, etc.) are stored as
// key/value rows in the `settings` table. setSetting upserts a single key.
// Pass value=null to delete the override and fall back to the default.
export async function setSetting(key, value) {
  if (value === null || value === undefined) {
    const { error } = await supabase.from('settings').delete().eq('key', key)
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value: String(value) }, { onConflict: 'key' })
  if (error) throw error
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

// Fetch just the optimistic-lock token (updated_at) for a single invoice. Used
// by the auto-save retry path: when a save is rejected as CONCURRENT_EDIT we
// pull the freshest token from the database and retry once with it.
export async function fetchInvoiceUpdatedAt(id) {
  const { data, error } = await supabase
    .from('invoices')
    .select('updated_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data?.updated_at || null
}

// Save an invoice atomically via the save_invoice_with_items Postgres RPC.
// All three writes (invoice header, line items, payments) happen inside one
// transaction so a network drop can't leave you with an invoice that has
// zero line items.
//
// Optimistic locking: we send the updated_at the client last loaded. If the
// row in the database has a different updated_at, the RPC raises
// 'CONCURRENT_EDIT' and we surface that as a tagged error.
//
// Returns the new updated_at so the caller can store it on the local copy.
export async function upsertInvoice(inv, isNew) {
  const payload = {
    inv: {
      id: inv.id,
      type: inv.type || 'invoice',
      client_id: inv.client_id || null,
      client_name: inv.client || '',
      date: inv.date || null,
      due_date: inv.dueDate || null,
      status: inv.status || 'outstanding',
      tax: inv.tax ?? 4.712,
      discount: inv.discount ?? 0,
      discount_type: inv.discountType || '$',
      notes: inv.notes || '',
      year: inv.year ?? null,
      gcal_date: inv.gcalDate || null,
      gcal_event_id: inv.gcalEventId || null,
      follow_up_date: inv.followUpDate || null,
      follow_up_event_id: inv.followUpEventId || null,
      signature_data: inv.signatureData || null,
      signed_at: inv.signedAt || null,
      client_info: inv.clientInfo || null,
      converted_to_id: inv.convertedToId || null,
      view_token: inv.viewToken || null,
      down_payment_pct: typeof inv.downPaymentPct === 'number' ? inv.downPaymentPct : 0,
      down_payment_invoice_id: inv.downPaymentInvoiceId || null,
      job_address: inv.jobAddress || null,
      billing_address: inv.billingAddress || null,
    },
    items: (inv.items || []).map((it, i) => ({
      name: it.name || '',
      description: it.desc || '',
      qty: it.qty ?? 1,
      price: it.price ?? 0,
      unit: it.unit || 'ea',
      discount: it.discount ?? 0,
      discount_type: it.discountType || '%',
      taxable: it.taxable !== false,
      sort_order: i,
    })),
    payments: (inv.payments || []).map(p => ({
      amount: p.amount ?? 0,
      surcharge: p.surcharge ?? 0,
      method: p.method || '',
      date: p.date || null,
      note: p.note || '',
      // Round-trip PayPal identifiers so the save_invoice_with_items RPC
      // recognizes these rows as PayPal-managed and skips re-inserting them.
      // Without this, the RPC strips paypal_capture_id and the dedupe filter
      // misses, producing duplicate manual rows on every save.
      paypal_order_id: p.paypal_order_id || null,
      paypal_capture_id: p.paypal_capture_id || null,
    })),
    expected_updated_at: isNew ? null : (inv.updatedAt || null),
    is_new: !!isNew,
  }

  const { data, error } = await supabase.rpc('save_invoice_with_items', payload)
  if (error) {
    // Surface concurrent edit as a typed error the UI can handle distinctly.
    if ((error.message || '').includes('CONCURRENT_EDIT')) {
      const conflict = new Error('CONCURRENT_EDIT')
      conflict.code = 'CONCURRENT_EDIT'
      conflict.detail = error.message
      throw conflict
    }
    throw error
  }

  return {
    id: data?.id || inv.id,
    updatedAt: data?.updated_at || null,
  }
}

// ─── Invoice version snapshots ────────────────────────────────────────────────

export async function recordInvoiceVersion(inv, sentTo, note) {
  // Get next version number for this invoice
  const { data: existing } = await supabase
    .from('invoice_versions')
    .select('version_number')
    .eq('invoice_id', inv.id)
    .order('version_number', { ascending: false })
    .limit(1)
  const nextVersion = (existing?.[0]?.version_number || 0) + 1

  const { error } = await supabase.from('invoice_versions').insert({
    invoice_id: inv.id,
    version_number: nextVersion,
    snapshot: inv,
    sent_to: sentTo || null,
    note: note || null,
  })
  if (error) throw error
  return nextVersion
}

export async function loadInvoiceVersions(invoiceId) {
  const { data, error } = await supabase
    .from('invoice_versions')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('version_number', { ascending: false })
  if (error) throw error
  return data || []
}

// ─── Invoice events (sent / opened / etc.) ───────────────────────────────────

// Generate a short URL-safe random token for trackable view links.
// Crypto API is available in modern browsers and on Vercel edge runtime.
export function generateViewToken() {
  const bytes = new Uint8Array(9);
  (globalThis.crypto || crypto).getRandomValues(bytes);
  // base64url, ~12 chars — short enough to copy, long enough to be unguessable.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Make sure the invoice has a view_token. Returns the (possibly new) token.
// Persists it on the row if it was newly minted.
export async function ensureViewToken(invoice) {
  if (invoice.viewToken) return invoice.viewToken;
  const token = generateViewToken();
  const { error } = await supabase
    .from('invoices')
    .update({ view_token: token })
    .eq('id', invoice.id);
  if (error) throw error;
  return token;
}

export async function recordInvoiceEvent(invoiceId, kind, recipient, meta) {
  const { error } = await supabase.from('invoice_events').insert({
    invoice_id: invoiceId,
    kind,
    recipient: recipient || null,
    meta: meta || null,
  });
  if (error) throw error;
}

export async function loadInvoiceEvents(invoiceId) {
  const { data, error } = await supabase
    .from('invoice_events')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) throw error
}

// ─── Clients ──────────────────────────────────────────────────────────────────

// Build the clients-table payload. After migration 008, the structured
// addresses[] / billing_address columns exist; before that they don't.
// We always WRITE them — Supabase silently ignores writes to columns that
// don't exist on the table for jsonb default-empty paths, but to be safe
// we wrap in a try/catch fallback.
function clientPayload(client) {
  const addresses = Array.isArray(client.addresses) ? client.addresses : []
  // Mirror first job-site address back into the legacy flat columns so any
  // code path / report still reading address1/2/3 keeps working.
  const primary = addresses[0] || {}
  return {
    name: client.name,
    email: client.email || null,
    secondary_email: client.email2 || null,
    mobile: client.mobile || null,
    phone: client.phone || null,
    fax: client.fax || null,
    contact: client.contact || null,
    address1: primary.line1 || client.address1 || null,
    address2: primary.line2 || client.address2 || null,
    address3: primary.line3 || client.address3 || null,
    addresses,
    billing_address: client.billingAddress || null,
  }
}

export async function insertClient(client) {
  const payload = clientPayload(client)
  const { data, error } = await supabase.from('clients').insert(payload).select().single()
  if (error) {
    // If the new columns don't exist yet (migration 008 not applied), retry
    // without them so the app stays usable.
    if (/column .*(addresses|billing_address)/.test(error.message || '')) {
      const { addresses, billing_address, ...legacy } = payload
      const { data: data2, error: e2 } = await supabase.from('clients').insert(legacy).select().single()
      if (e2) throw e2
      return data2.id
    }
    throw error
  }
  return data.id
}

// Build the client_info JSON shape that invoices snapshot. Mirrors
// the structure created in App.jsx when an invoice is first saved.
function buildClientInfoForInvoices(client) {
  const addresses = Array.isArray(client.addresses) ? client.addresses : []
  const primary = addresses[0] || {}
  return {
    name: client.name || null,
    email: client.email || null,
    phone: client.mobile || client.phone || null,
    address1: primary.line1 || client.address1 || null,
    address2: primary.line2 || client.address2 || null,
    address3: primary.line3 || client.address3 || null,
  }
}

export async function updateClient(client) {
  const payload = clientPayload(client)
  const { error } = await supabase.from('clients').update(payload).eq('id', client.id)
  if (error) {
    if (/column .*(addresses|billing_address)/.test(error.message || '')) {
      const { addresses, billing_address, ...legacy } = payload
      const { error: e2 } = await supabase.from('clients').update(legacy).eq('id', client.id)
      if (e2) throw e2
    } else {
      throw error
    }
  }
  // Propagate fresh client info to all existing invoices for this client
  // so edits show up live across past and future docs. Best-effort — if
  // the RPC isn't deployed yet (migration 008 not run), fall back to a
  // direct table update so the bug is still fixed.
  await propagateClientToInvoices(client).catch((e) => {
    console.warn('propagateClientToInvoices failed:', e?.message || e)
  })
}

async function propagateClientToInvoices(client) {
  const info = buildClientInfoForInvoices(client)
  const billing = client.billingAddress || null
  // Try the RPC first (atomic, future-proof if we add audit logging there).
  const rpcResp = await supabase.rpc('propagate_client_to_invoices', {
    p_client_id: client.id,
    p_client_name: client.name || null,
    p_client_info: info,
    p_billing_address: billing,
  })
  if (!rpcResp.error) return rpcResp.data
  // Fallback: direct UPDATE if the function isn't installed yet.
  const fallback = await supabase
    .from('invoices')
    .update({
      client_name: client.name || null,
      client_info: info,
      billing_address: billing,
    })
    .eq('client_id', client.id)
  if (fallback.error) throw fallback.error
  return null
}

// ─── Saved Items ──────────────────────────────────────────────────────────────

export async function insertSavedItem(item) {
  const { data, error } = await supabase.from('saved_items').insert({
    category: item.category || 'Custom',
    name: item.name,
    description: item.desc || '',
    price: item.price ?? 0,
    taxable: item.taxable !== false,
    unit: item.unit || null,
  }).select().single()
  if (error) throw error
  return data.id
}

export async function updateSavedItem(item) {
  const { error } = await supabase.from('saved_items').update({
    category: item.category || 'Custom',
    name: item.name,
    description: item.desc || '',
    price: item.price ?? 0,
    taxable: item.taxable !== false,
    unit: item.unit || null,
  }).eq('id', item.id)
  if (error) throw error
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export async function upsertExpense(expense) {
  const isNew = !expense.id || expense.id === Date.now()
  if (isNew || typeof expense.id !== 'number' || expense.id > 1e12) {
    const { data, error } = await supabase.from('expenses').insert({
      date: expense.date || null,
      merchant: expense.merchant || '',
      amount: parseFloat(expense.amount) || 0,
      category: expense.category || '',
      description: expense.description || '',
      receipt_data: expense.receiptData || null,
    }).select().single()
    if (error) throw error
    return data.id
  } else {
    const { error } = await supabase.from('expenses').update({
      date: expense.date || null,
      merchant: expense.merchant || '',
      amount: parseFloat(expense.amount) || 0,
      category: expense.category || '',
      description: expense.description || '',
      receipt_data: expense.receiptData || null,
    }).eq('id', expense.id)
    if (error) throw error
    return expense.id
  }
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) throw error
}

export async function deleteClient(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

export async function deleteSavedItem(id) {
  const { error } = await supabase.from('saved_items').delete().eq('id', id)
  if (error) throw error
}

// ─── Notifications ─────────────────────────────────────────────────────────────────────────────
// Server-side endpoints (paypal-webhook, paypal-capture-order,
// track-open, submit-signature) write rows here. The bell icon in the
// app polls listNotifications + listens to a realtime channel for
// instant updates.

export async function listNotifications(limit = 50) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function markNotificationRead(id) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (error) throw error
}

// Subscribe to inserts on the notifications table so the bell badge
// updates the moment a payment lands. Returns the channel so the
// caller can unsubscribe on unmount.
export function subscribeNotifications(onInsert) {
  const channel = supabase
    .channel('notifications-feed')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      (payload) => onInsert?.(payload.new))
    .subscribe()
  return channel
}

export function unsubscribeChannel(channel) {
  if (channel) supabase.removeChannel(channel)
}

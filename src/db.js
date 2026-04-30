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
        method: p.method || '',
        date: p.date,
        note: p.note || '',
      })),
  }
}

function toClient(row) {
  // Promote legacy flat address1/2/3 into a single "Primary" entry in
  // addresses[] when addresses is empty/missing. Keeps old data usable
  // even before migration 008 is applied.
  let addresses = Array.isArray(row.addresses) ? row.addresses : []
  const hasFlat = !!(row.address1 || row.address2 || row.address3)
  if (addresses.length === 0 && hasFlat) {
    addresses = [{
      id: 'primary',
      label: 'Primary',
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
    supabase.from('invoices').select('*').order('created_at', { ascending: false }),
    supabase.from('invoice_items').select('*'),
    supabase.from('payments').select('*'),
    supabase.from('saved_items').select('*').order('category').order('name'),
    supabase.from('expenses').select('*').order('date', { ascending: false }),
    supabase.from('settings').select('*'),
  ])

  const err = e1 || e2 || e3 || e4 || e5 || e6 || e7
  if (err) throw err

  const nextNum = parseInt(
    (settingRows || []).find(s => s.key === 'next_num')?.value ?? '753'
  )

  return {
    invoices: (invoiceRows || []).map(row => toInvoice(row, itemRows || [], paymentRows || [])),
    clients: (clientRows || []).map(toClient),
    savedItems: (savedItemRows || []).map(toSavedItem),
    expenses: (expenseRows || []).map(toExpense),
    nextNum,
  }
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

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
      method: p.method || '',
      date: p.date || null,
      note: p.note || '',
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

export async function updateClient(client) {
  const payload = clientPayload(client)
  const { error } = await supabase.from('clients').update(payload).eq('id', client.id)
  if (error) {
    if (/column .*(addresses|billing_address)/.test(error.message || '')) {
      const { addresses, billing_address, ...legacy } = payload
      const { error: e2 } = await supabase.from('clients').update(legacy).eq('id', client.id)
      if (e2) throw e2
      return
    }
    throw error
  }
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

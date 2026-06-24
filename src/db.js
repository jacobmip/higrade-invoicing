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
    lateFeeWaived: row.late_fee_waived ?? false,
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
    ownerId: row.owner_id || null,
    deletedAt: row.deleted_at || null,
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

// Parse "City ST" or "City, ST" into separate city and state parts.
function parseCityState(str) {
  if (!str) return { city: '', state: '' }
  const m = str.match(/^(.*?)(?:,\s+|\s+)([A-Z]{2})$/)
  return m ? { city: m[1].trim(), state: m[2] } : { city: str.trim(), state: '' }
}

// Normalize an address object: if the new city/state/zip keys are missing,
// parse them out of the legacy line3 string. Always recomputes line3 so it
// stays in sync with city/state/zip.
function normalizeAddr(a) {
  if (!a) return null
  const hasCsz = a.city !== undefined || a.state !== undefined || a.zip !== undefined
  let city = a.city || '', state = a.state || '', zip = a.zip || ''
  if (!hasCsz) {
    const line3 = a.line3 || ''
    const zipM = line3.match(/\b(\d{5}(?:-\d{4})?)\s*$/)
    zip = zipM ? zipM[1] : ''
    const rest = zipM ? line3.slice(0, line3.length - zipM[0].length).trim() : line3.trim()
    const cs = parseCityState(rest)
    city = cs.city; state = cs.state
  }
  const line3 = [city, state, zip].filter(Boolean).join(' ')
  return { ...a, city, state, zip, line3 }
}

function toClient(row) {
  // Promote legacy flat address1/2/3 into a single unlabeled entry in
  // addresses[] when addresses is empty/missing. Keeps old data usable
  // even before migration 008 is applied. Label is blank — a single
  // address with no nickname is implicitly the primary one.
  let addresses = Array.isArray(row.addresses) ? row.addresses.map(normalizeAddr).filter(Boolean) : []
  const hasFlat = !!(row.address1 || row.address2 || row.address3)
  if (addresses.length === 0 && hasFlat) {
    const { city, state } = parseCityState(row.address2 || '')
    const zip = row.address3 || ''
    addresses = [{
      id: 'primary',
      label: '',
      line1: row.address1 || '',
      line2: row.address_unit || '',
      city, state, zip,
      line3: [row.address2, row.address3].filter(Boolean).join(' ') || '',
    }]
  }
  const { city: flatCity, state: flatState } = parseCityState(row.address2 || '')
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    email2: row.secondary_email || '',
    mobile: row.mobile || '',
    phone: row.phone || '',
    contact: row.contact || '',
    // Legacy flat fields
    address1: row.address1 || '',
    unit: row.address_unit || '',
    address2: row.address2 || '',
    address3: row.address3 || '',
    // Parsed flat fields for quick-add pre-fill
    city: flatCity,
    state: flatState,
    zip: row.address3 || '',
    // New structured addresses
    addresses,
    billingAddress: normalizeAddr(row.billing_address),
    ownerId: row.owner_id || null,
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
    ownerId: row.owner_id || null,
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
    ownerId: row.owner_id || null,
  }
}

// ─── Profile / multi-user helpers ─────────────────────────────────────────────

// Returns the current authenticated user's profile row { id, display_name,
// role } or null if not signed in / no profile yet. Used by the App shell to
// decide whether to show admin-only UI (header badge, Users settings panel,
// View-as toggle).
export async function getMyProfile() {
  const { data: sessionData } = await supabase.auth.getSession()
  const uid = sessionData?.session?.user?.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('profiles').select('id, display_name, role').eq('id', uid).maybeSingle()
  if (error) {
    console.warn('getMyProfile failed:', error.message)
    return null
  }
  return data || null
}

// Lists every profile in the system. Admin-only — RLS will return only the
// caller's own row for non-admins, which is fine. For each profile we also
// surface a quick invoice count so the admin Users panel can show activity
// at a glance.
export async function listAllUsers() {
  const { data: profs, error } = await supabase
    .from('profiles').select('id, display_name, role, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  const profiles = profs || []
  if (profiles.length === 0) return []

  // Count invoices per owner. RLS returns only rows the caller can see — for
  // admin that's everything, so this works cleanly.
  const { data: invs } = await supabase.from('invoices').select('owner_id, type')
  const invCount = new Map()
  const estCount = new Map()
  for (const r of (invs || [])) {
    if (!r.owner_id) continue
    if (r.type === 'estimate') estCount.set(r.owner_id, (estCount.get(r.owner_id) || 0) + 1)
    else invCount.set(r.owner_id, (invCount.get(r.owner_id) || 0) + 1)
  }
  return profiles.map(p => ({
    id: p.id,
    displayName: p.display_name || '',
    role: p.role || 'plumber',
    createdAt: p.created_at,
    invoiceCount: invCount.get(p.id) || 0,
    estimateCount: estCount.get(p.id) || 0,
  }))
}

// ─── AI chat history (server-side, per user) ─────────────────────────────────

// Loads the signed-in user's saved chat thread from the ai_chat_history table.
// Returns an array of {role, text, ...} message objects, or null if no row
// exists yet. Returns null on any error so the caller falls back to whatever
// it had locally cached — we never want a transient network blip to make
// chat appear deleted.
export async function loadChatHistory() {
  const { data: sessionData } = await supabase.auth.getSession()
  const uid = sessionData?.session?.user?.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('ai_chat_history').select('messages').eq('user_id', uid).maybeSingle()
  if (error) {
    console.warn('loadChatHistory failed:', error.message)
    return null
  }
  if (!data) return [] // no row yet — fresh user, empty thread
  const msgs = data.messages
  return Array.isArray(msgs) ? msgs : []
}

// Saves the full chat thread for the signed-in user. Uses upsert so the
// first save creates the row and subsequent ones update it. Returns true
// on success, false on any failure. Caller is expected to keep its
// localStorage cache up to date so a failed save doesn't lose the thread.
export async function saveChatHistory(messages) {
  const { data: sessionData } = await supabase.auth.getSession()
  const uid = sessionData?.session?.user?.id
  if (!uid) return false
  const trimmed = Array.isArray(messages) ? messages.slice(-200) : []
  const { error } = await supabase
    .from('ai_chat_history')
    .upsert({ user_id: uid, messages: trimmed }, { onConflict: 'user_id' })
  if (error) {
    console.warn('saveChatHistory failed:', error.message)
    return false
  }
  return true
}

// ─── Load all ─────────────────────────────────────────────────────────────

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
    // Soft-deleted invoices/estimates (deleted_at IS NOT NULL) live in the
    // Recently Deleted tab for 30 days, so exclude them from the main list.
    fetchAllRows(() => supabase.from('invoices').select('*').is('deleted_at', null).order('date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })),
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
      late_fee_waived: inv.lateFeeWaived ?? false,
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

// ─── Client version snapshots ─────────────────────────────────────────────────

export async function recordClientVersion(client, note) {
  const { data: existing } = await supabase
    .from('client_versions')
    .select('version_number')
    .eq('client_id', client.id)
    .order('version_number', { ascending: false })
    .limit(1)
  const nextVersion = (existing?.[0]?.version_number || 0) + 1
  const { error } = await supabase.from('client_versions').insert({
    client_id: client.id,
    version_number: nextVersion,
    snapshot: client,
    note: note || null,
  })
  if (error) throw error
  return nextVersion
}

export async function loadClientVersions(clientId) {
  const { data, error } = await supabase
    .from('client_versions')
    .select('*')
    .eq('client_id', clientId)
    .order('version_number', { ascending: false })
  if (error) throw error
  return data || []
}


// Generate a short URL-safe random token for trackable view links.
// Crypto API is available in modern browsers and on Vercel edge runtime.
export function generateViewToken() {
  const bytes = new Uint8Array(9);
  (globalThis.crypto || crypto).getRandomValues(bytes);
  // base64url, ~12 chars — short enough to copy, long enough to be unguessable.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Delete any invoices that share the given viewToken but are not keepId.
// Called before stamping convertedToId on a source estimate so orphaned
// invoices left by previous failed conversion attempts don't block the
// unique constraint on view_token.
export async function deleteOrphansByViewToken(viewToken, keepId) {
  if (!viewToken) return [];
  const { data } = await supabase
    .from('invoices')
    .select('id')
    .eq('view_token', viewToken)
    .neq('id', keepId);
  const ids = (data || []).map(r => r.id);
  for (const id of ids) {
    await supabase.from('invoices').delete().eq('id', id);
  }
  return ids;
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

// Soft-delete: stamp deleted_at so the invoice/estimate drops out of the
// normal tabs (loadAll filters deleted_at IS NULL) but is recoverable from
// the Recently Deleted tab for 30 days.
export async function deleteInvoice(id) {
  const { error } = await supabase
    .from('invoices')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function claimInvoiceOwner(id) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return;
  await supabase.from('invoices').update({ owner_id: user.id }).eq('id', id);
}

// Restore a soft-deleted invoice/estimate by clearing deleted_at.
export async function restoreInvoice(id) {
  const { error } = await supabase
    .from('invoices')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) throw error
}

// Hard-delete — used by the Recently Deleted tab's "Delete" button and the
// 30-day auto-purge. This is unrecoverable.
export async function permanentlyDeleteInvoice(id) {
  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// Load every soft-deleted invoice/estimate for an owner, newest deletion
// first, hydrated with line items + payments so the preview/totals render.
export async function loadDeletedInvoices(ownerId) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_items(*), payments(*)')
    .not('deleted_at', 'is', null)
    .eq('owner_id', ownerId)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return (data || []).map(row =>
    toInvoice(row, row.invoice_items || [], row.payments || [])
  )
}

// ─── Clients ──────────────────────────────────────────────────────────────────

// Build the clients-table payload. After migration 008, the structured
// addresses[] / billing_address columns exist; before that they don't.
// We always WRITE them — Supabase silently ignores writes to columns that
// don't exist on the table for jsonb default-empty paths, but to be safe
// we wrap in a try/catch fallback.
function clientPayload(client) {
  const addresses = Array.isArray(client.addresses) ? client.addresses : []
  const primary = addresses[0] || {}
  // Derive flat city/state/zip: structured address wins, then quick-add top-level fields
  const city  = primary.city  || client.city  || ''
  const state = primary.state || client.state || ''
  const zip   = primary.zip   || client.zip   || client.address3 || ''
  // Serialize every address so line3 always reflects city/state/zip
  const serializedAddresses = addresses.map(a => ({
    ...a,
    line3: [a.city, a.state, a.zip].filter(Boolean).join(' ') || a.line3 || '',
  }))
  const bl = client.billingAddress
  const serializedBilling = bl ? {
    ...bl,
    line3: [bl.city, bl.state, bl.zip].filter(Boolean).join(' ') || bl.line3 || '',
  } : null
  return {
    name: client.name,
    email: client.email || null,
    secondary_email: client.email2 || null,
    mobile: client.mobile || null,
    phone: client.phone || null,
    contact: client.contact || null,
    address1: primary.line1 || client.address1 || null,
    address_unit: primary.line2 || client.unit || null,
    address2: [city, state].filter(Boolean).join(' ') || client.address2 || null,
    address3: zip || null,
    addresses: serializedAddresses,
    billing_address: serializedBilling,
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
  const primary = addresses[0] || null
  // line3 is always the computed city+state+zip string (kept in sync by normalizeAddr/clientPayload)
  return {
    name: client.name || null,
    email: client.email || null,
    phone: client.mobile || client.phone || null,
    address1: primary ? (primary.line1 || '') : (client.address1 || null),
    address2: primary ? (primary.line2 || '') : (client.unit || null),
    address3: primary ? (primary.line3 || '') : ([client.city, client.state, client.zip].filter(Boolean).join(' ') || client.address3 || null),
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
  // Two passes: one by client_id, one by name for invoices that were saved
  // before client_id was reliably written (back-links client_id while fixing).
  const byId = await supabase
    .from('invoices')
    .update({ client_name: client.name || null, client_info: info, billing_address: billing })
    .eq('client_id', client.id)
  if (byId.error) throw byId.error
  if (client.name) {
    const byName = await supabase
      .from('invoices')
      .update({ client_name: client.name, client_id: client.id, client_info: info, billing_address: billing })
      .eq('client_name', client.name)
      .is('client_id', null)
    if (byName.error) console.warn('name-based propagation failed:', byName.error.message)
  }
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

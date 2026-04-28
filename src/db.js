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
    items: items
      .filter(it => it.invoice_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(it => ({
        name: it.name || '',
        desc: it.desc || '',
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
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    email2: row.secondary_email || '',
    mobile: row.mobile || '',
    phone: row.phone || '',
    fax: row.fax || '',
    contact: row.contact || '',
    address1: row.address1 || '',
    address2: row.address2 || '',
    address3: row.address3 || '',
  }
}

function toSavedItem(row) {
  return {
    id: row.id,
    category: row.category || 'Custom',
    name: row.name,
    price: parseFloat(row.price ?? 0),
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

export async function upsertInvoice(inv, isNew) {
  const { error: invErr } = await supabase.from('invoices').upsert({
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
    year: inv.year,
    gcal_date: inv.gcalDate || null,
    gcal_event_id: inv.gcalEventId || null,
    follow_up_date: inv.followUpDate || null,
    follow_up_event_id: inv.followUpEventId || null,
    signature_data: inv.signatureData || null,
    signed_at: inv.signedAt || null,
    updated_at: new Date().toISOString(),
  })
  if (invErr) throw invErr

  await supabase.from('invoice_items').delete().eq('invoice_id', inv.id)
  if (inv.items?.length) {
    const { error: itemErr } = await supabase.from('invoice_items').insert(
      inv.items.map((it, i) => ({
        invoice_id: inv.id,
        name: it.name || '',
        desc: it.desc || '',
        qty: it.qty ?? 1,
        price: it.price ?? 0,
        unit: it.unit || 'ea',
        discount: it.discount ?? 0,
        discount_type: it.discountType || '%',
        taxable: it.taxable !== false,
        sort_order: i,
      }))
    )
    if (itemErr) throw itemErr
  }

  await supabase.from('payments').delete().eq('invoice_id', inv.id)
  if (inv.payments?.length) {
    const { error: payErr } = await supabase.from('payments').insert(
      inv.payments.map(p => ({
        invoice_id: inv.id,
        amount: p.amount,
        method: p.method || '',
        date: p.date || null,
        note: p.note || '',
      }))
    )
    if (payErr) throw payErr
  }

  if (isNew) {
    const next = parseInt(inv.id.replace('INV', '')) + 1
    await supabase.from('settings').upsert({ key: 'next_num', value: String(next) })
  }
}

export async function deleteInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) throw error
}

// ─── Clients ──────────────────────────────────────────────────────────────────

export async function insertClient(client) {
  const { data, error } = await supabase.from('clients').insert({
    name: client.name,
    email: client.email || null,
    secondary_email: client.email2 || null,
    mobile: client.mobile || null,
    phone: client.phone || null,
    fax: client.fax || null,
    contact: client.contact || null,
    address1: client.address1 || null,
    address2: client.address2 || null,
    address3: client.address3 || null,
  }).select().single()
  if (error) throw error
  return data.id
}

export async function updateClient(client) {
  const { error } = await supabase.from('clients').update({
    name: client.name,
    email: client.email || null,
    secondary_email: client.email2 || null,
    mobile: client.mobile || null,
    phone: client.phone || null,
    fax: client.fax || null,
    contact: client.contact || null,
    address1: client.address1 || null,
    address2: client.address2 || null,
    address3: client.address3 || null,
  }).eq('id', client.id)
  if (error) throw error
}

// ─── Saved Items ──────────────────────────────────────────────────────────────

export async function insertSavedItem(item) {
  const { data, error } = await supabase.from('saved_items').insert({
    category: item.category || 'Custom',
    name: item.name,
    price: item.price ?? 0,
  }).select().single()
  if (error) throw error
  return data.id
}

export async function updateSavedItem(item) {
  const { error } = await supabase.from('saved_items').update({
    category: item.category || 'Custom',
    name: item.name,
    price: item.price ?? 0,
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

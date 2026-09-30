// Browser half of the app-wide AI chat agent (GlobalAIModal).
//
// /api/ai in agent mode relays one model turn at a time; this file runs the
// loop around it: send the conversation, execute whatever tools the model
// called, send the results back, repeat until it answers. It is the same loop
// as runAgent() in the AI-OS repo's agent.js, which drives the HI Grade Manager
// on Telegram, moved into the app.
//
// Why the tools run here and not on the server:
//   - Reads use the data the app already holds, and the app's own calcTotals,
//     so a balance in chat always matches the balance on screen.
//   - Writes go through App.jsx's existing handlers, so document numbers come
//     from mintDocId, saves take the optimistic lock, and a booked job uses the
//     same calendar builder as the schedule modal. A second writer with its own
//     rules is how this codebase has broken before (see CLAUDE.md).
//   - Everything runs as the signed-in user, under RLS. The server never holds
//     a database credential for this.
//
// Tool schemas and the system prompt live in api/_lib/agent-tools.js. Keep the
// names below in step with that file.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { api } from './apiBase.js';

const MAX_STEPS = 12;            // model calls per message
const MAX_RESULT_CHARS = 12000;  // per tool result sent back to the model
const HISTORY_MESSAGES = 30;     // earlier chat turns replayed as context

// ─── Dates ───────────────────────────────────────────────────────────────────
// The business runs on Hawaii time. `new Date().toISOString()` is UTC, which is
// already tomorrow from 2pm HST onwards, so never use it for "today" here.
const TZ = 'Pacific/Honolulu';
export function hawaiiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function contextBlock(userLabel) {
  const now = new Date();
  const long = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  return `<context>\nToday: ${long} (${hawaiiToday()}), ${time} HST.\nSigned in: ${userLabel || 'unknown'}.\n</context>\n\n`;
}

// ─── Small helpers ───────────────────────────────────────────────────────────
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lc = (s) => String(s || '').toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');
const clampInt = (n, lo, hi, dflt) => {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
};
function streetOf(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return [a.line1, a.line2, a.line3 || [a.city, a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(it => ({
    name: String(it?.name || '').trim(),
    desc: String(it?.desc || it?.description || ''),
    qty: Number(it?.qty) > 0 ? Number(it.qty) : 1,
    price: Number(it?.price) || 0,
    unit: 'ea',
    discount: 0,
    discountType: '%',
    taxable: it?.taxable !== false,
  })).filter(it => it.name || it.desc);
}

// ─── Reads ───────────────────────────────────────────────────────────────────
function docSummary(inv, calcTotals) {
  const t = calcTotals(inv);
  const firstVisit = (inv.visits || []).map(v => v.start).filter(Boolean).sort()[0] || inv.gcalDate || null;
  return {
    id: inv.id,
    type: inv.type,
    client: inv.client,
    date: inv.date,
    due: inv.dueDate,
    status: inv.status,
    total: money(t.total),
    paid: money(t.paid),
    balance: money(t.balance),
    items: (inv.items || []).slice(0, 3).map(it => it.name).filter(Boolean),
    ...(firstVisit ? { scheduled: firstVisit } : {}),
    ...(inv.convertedToId ? { converted_to: inv.convertedToId } : {}),
    ...(inv.source ? { source: inv.source } : {}),
  };
}

const isUnpaidInvoice = (inv, calcTotals) =>
  inv.type !== 'estimate' && inv.status !== 'paid' && calcTotals(inv).balance > 0.005;

function searchDocuments(input, ctx) {
  const { invoices } = ctx.getData();
  const text = lc(input.text).trim();
  const client = lc(input.client).trim();
  const type = input.type && input.type !== 'any' ? input.type : null;
  const status = input.status && input.status !== 'any' ? input.status : null;
  const limit = clampInt(input.limit, 1, 100, 25);
  const hits = invoices.filter(inv => {
    if (type && (inv.type === 'estimate' ? 'estimate' : 'invoice') !== type) return false;
    if (client && !lc(inv.client).includes(client)) return false;
    if (input.date_from && (inv.date || '') < input.date_from) return false;
    if (input.date_to && (inv.date || '') > input.date_to) return false;
    if (status === 'unpaid') { if (!isUnpaidInvoice(inv, ctx.calcTotals)) return false; }
    else if (status && inv.status !== status) return false;
    if (text) {
      const hay = [inv.id, inv.client, inv.notes, ...(inv.items || []).map(it => it.name)].map(lc).join(' | ');
      if (!hay.includes(text)) return false;
    }
    return true;
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return {
    matched: hits.length,
    showing: Math.min(limit, hits.length),
    documents: hits.slice(0, limit).map(inv => docSummary(inv, ctx.calcTotals)),
  };
}

function getDocument(input, ctx) {
  const id = String(input.document_id || '').trim().toUpperCase();
  const inv = ctx.getData().invoices.find(i => i.id === id);
  if (!inv) return { error: `No document ${id} in the app. It may be deleted, or try search_documents.` };
  const t = ctx.calcTotals(inv);
  return {
    ...docSummary(inv, ctx.calcTotals),
    subtotal: money(t.sub),
    discount: money(t.disc),
    tax_rate: inv.tax,
    tax: money(t.taxAmt),
    items: (inv.items || []).map((it, i) => ({
      item_number: i + 1, name: it.name, desc: it.desc, qty: it.qty, price: it.price, taxable: it.taxable,
    })),
    payments: (inv.payments || []).map(p => ({ amount: p.amount, method: p.method, date: p.date })),
    visits: (inv.visits || []).map(v => ({ start: v.start, minutes: v.minutes, label: v.label || '', kind: v.kind || null })),
    job_address: streetOf(inv.jobAddress),
    notes: inv.notes || '',
    internal_notes: inv.internalNotes || '',
    signed: !!inv.signedAt,
  };
}

function findClient(input, ctx) {
  const { clients, invoices } = ctx.getData();
  const q = lc(input.query).trim();
  if (!q) return { error: 'Give a name, phone or email to search for.' };
  const qd = digits(q);
  const qWords = q.split(/\s+/).filter(Boolean);
  const scored = clients.map(c => {
    const name = lc(c.name);
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (qWords.length && qWords.every(w => name.split(/\s+/).some(nw => nw.startsWith(w)))) score = 50;
    else if (qWords.some(w => w.length > 2 && name.split(/\s+/).some(nw => nw.startsWith(w)))) score = 20;
    if (qd.length >= 4 && [c.phone, c.mobile].some(p => digits(p).includes(qd))) score = Math.max(score, 90);
    if (q.includes('@') && [c.email, c.email2].some(e => lc(e) === q)) score = Math.max(score, 95);
    return { c, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  return {
    matches: scored.map(({ c }) => {
      const docs = invoices.filter(i => i.client === c.name);
      const open = docs.filter(i => isUnpaidInvoice(i, ctx.calcTotals));
      return {
        client_id: c.id,
        name: c.name,
        phone: c.phone || c.mobile || '',
        email: c.email || '',
        email2: c.email2 || '',
        billing_address: [c.address1, c.unit, c.address2, c.address3].filter(Boolean).join(', '),
        job_sites: (Array.isArray(c.addresses) ? c.addresses : [])
          .map(a => ({ label: a.label || '', address: streetOf(a) }))
          .filter(a => a.address),
        documents: docs.length,
        open_balance: money(open.reduce((s, i) => s + ctx.calcTotals(i).balance, 0)),
        unpaid_invoices: open.map(i => i.id),
        recent: docs.slice(0, 5).map(i => `${i.id} ${i.date || ''} ${i.status || ''}`.trim()),
      };
    }),
  };
}

function searchPriceBook(input, ctx) {
  const q = lc(input.query).trim();
  const items = ctx.getData().savedItems || [];
  const words = q.split(/\s+/).filter(Boolean);
  const hits = items.filter(i => !q || words.every(w => lc(`${i.name} ${i.category}`).includes(w)));
  return {
    matched: hits.length,
    items: hits.slice(0, 60).map(i => ({ name: i.name, category: i.category, price: i.price })),
  };
}

function getSchedule(input, ctx) {
  const from = input.date_from || hawaiiToday();
  const to = input.date_to || addDays(from, 7);
  const out = [];
  for (const inv of ctx.getData().invoices) {
    const visits = (inv.visits && inv.visits.length)
      ? inv.visits
      : (inv.gcalDate ? [{ start: inv.gcalDate, minutes: inv.gcalDurationMinutes }] : []);
    for (const v of visits) {
      const day = String(v.start || '').slice(0, 10);
      if (!day || day < from || day > to) continue;
      out.push({
        start: v.start,
        minutes: v.minutes || null,
        label: v.label || '',
        document: inv.id,
        client: inv.client,
        address: streetOf(inv.jobAddress),
        work: (inv.items || []).map(it => it.name).filter(Boolean).slice(0, 3),
      });
    }
  }
  out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { from, to, visits: out };
}

function businessSummary(input, ctx) {
  const today = hawaiiToday();
  const from = input.date_from || `${today.slice(0, 7)}-01`;
  const to = input.date_to || today;
  const { invoices } = ctx.getData();
  const inRange = (d) => d && d >= from && d <= to;
  let invoiced = 0, invoiceCount = 0, collected = 0, paymentCount = 0, estValue = 0, estCount = 0;
  for (const inv of invoices) {
    const t = ctx.calcTotals(inv);
    if (inv.type === 'estimate') {
      if (inRange(inv.date)) { estValue += t.total; estCount++; }
      continue;
    }
    if (inRange(inv.date)) { invoiced += t.total; invoiceCount++; }
    for (const p of inv.payments || []) {
      if (inRange(p.date)) { collected += Number(p.amount) || 0; paymentCount++; }
    }
  }
  const open = invoices.filter(i => isUnpaidInvoice(i, ctx.calcTotals))
    .map(i => ({ id: i.id, client: i.client, date: i.date, balance: money(ctx.calcTotals(i).balance) }))
    .sort((a, b) => b.balance - a.balance);
  return {
    from, to,
    invoiced: money(invoiced), invoice_count: invoiceCount,
    collected: money(collected), payment_count: paymentCount,
    estimates_written: money(estValue), estimate_count: estCount,
    unpaid_total_all_time: money(open.reduce((s, i) => s + i.balance, 0)),
    unpaid_count: open.length,
    largest_unpaid: open.slice(0, 10),
  };
}

// Live read under the signed-in user's own session, so RLS decides what comes
// back exactly as it does for the rest of the app. GET only, a fixed list of
// tables, no RPCs.
const READABLE_TABLES = new Set([
  'invoices', 'invoice_items', 'clients', 'payments', 'expenses', 'saved_items',
  'invoice_events', 'invoice_versions', 'job_photos', 'client_versions',
]);
async function queryDatabase(input) {
  let q = String(input.query || '').trim().replace(/^\/?(rest\/v1\/)?/, '');
  const table = q.split(/[?/]/)[0];
  if (!READABLE_TABLES.has(table) || q.includes('..') || /^[^?]*\//.test(q)) {
    return { error: `Not allowed. Readable tables: ${[...READABLE_TABLES].join(', ')}.` };
  }
  if (!/[?&]limit=/.test(q)) q += (q.includes('?') ? '&' : '?') + 'limit=50';
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (!session?.access_token) return { error: 'Not signed in.' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
  });
  const body = await res.text();
  if (!res.ok) return { error: `Query failed (${res.status}): ${body.slice(0, 300)}` };
  try { return { rows: JSON.parse(body) }; } catch { return { raw: body }; }
}

// ─── Writes ──────────────────────────────────────────────────────────────────
// Every write goes through ctx.onAction, which is App.jsx's handleGlobalAIAction
// in strict mode (it throws instead of swallowing a failed save). The checks
// here exist so the model gets a useful error back rather than a silent no-op.

function requireDoc(ctx, rawId) {
  const id = String(rawId || '').trim().toUpperCase();
  const inv = ctx.getData().invoices.find(i => i.id === id);
  if (!inv) return { error: `No document ${id} in the app.` };
  // An open form re-saves its whole item list on the next keystroke or when
  // it closes, which would silently undo this write. See CLAUDE.md, "An open
  // invoice form overwrites any outside write".
  if (ctx.openDocId?.() === id) {
    return { error: `${id} is open in the editor right now. Ask Jake to close it first, then try again.` };
  }
  return { inv };
}

function exactClient(ctx, name) {
  const n = lc(name).trim();
  return ctx.getData().clients.find(c => lc(c.name).trim() === n) || null;
}

async function createClient(input, ctx) {
  const name = String(input.name || '').trim();
  if (!name) return { error: 'A client needs a name.' };
  const existing = exactClient(ctx, name);
  if (existing) return { error: `A client named "${existing.name}" already exists (client_id ${existing.id}). Use update_client for them.` };
  const client = await ctx.onAction({ action: 'create_client', client: { ...input, name } });
  if (!client) return { error: 'The client was not created.' };
  return { ok: true, client_id: client.id, name: client.name, card: { type: 'created_client', client } };
}

async function updateClient(input, ctx) {
  const target = ctx.getData().clients.find(c => String(c.id) === String(input.client_id));
  if (!target) return { error: `No client with id ${input.client_id}. Use find_client first.` };
  const updated = await ctx.onAction({ action: 'update_client', clientName: target.name, changes: input.changes || {} });
  return { ok: true, client_id: target.id, name: updated?.name || target.name, changed: Object.keys(input.changes || {}) };
}

async function createDocument(input, ctx) {
  const type = input.type === 'invoice' ? 'invoice' : 'estimate';
  const client = exactClient(ctx, input.client_name);
  if (!client) return { error: `No client named "${input.client_name}". Use find_client, or create_client first.` };
  const items = normalizeItems(input.items);
  if (!items.length) return { error: 'A document needs at least one line item.' };
  const doc = await ctx.onAction({
    action: type === 'estimate' ? 'create_estimate' : 'create_invoice',
    invoice: { client: client.name, items, notes: input.notes || '' },
  });
  if (!doc) return { error: 'The document was not created.' };
  return { ok: true, document_id: doc.id, type, client: client.name, total: money(ctx.calcTotals(doc).total), card: { type: 'created', invoice: doc } };
}

async function addLineItems(input, ctx) {
  const { inv, error } = requireDoc(ctx, input.document_id);
  if (error) return { error };
  const items = normalizeItems(input.items);
  if (!items.length) return { error: 'No items to add.' };
  const updated = await ctx.onAction({ action: 'add_items', invoiceId: inv.id, items });
  return {
    ok: true, document_id: inv.id, added: items.length,
    new_total: money(ctx.calcTotals(updated || inv).total),
    card: { type: 'added', invoiceId: inv.id, count: items.length },
  };
}

async function updateLineItem(input, ctx) {
  const { inv, error } = requireDoc(ctx, input.document_id);
  if (error) return { error };
  const n = parseInt(input.item_number, 10);
  if (!(n >= 1 && n <= (inv.items || []).length)) return { error: `${inv.id} has ${(inv.items || []).length} line items; there is no item ${input.item_number}.` };
  const updated = await ctx.onAction({ action: 'update_item', invoiceId: inv.id, itemIndex: n, changes: input.changes || {} });
  const it = (updated || inv).items[n - 1];
  return { ok: true, document_id: inv.id, item_number: n, item: { name: it.name, qty: it.qty, price: it.price }, new_total: money(ctx.calcTotals(updated || inv).total) };
}

async function removeLineItem(input, ctx) {
  const { inv, error } = requireDoc(ctx, input.document_id);
  if (error) return { error };
  const n = parseInt(input.item_number, 10);
  if (!(n >= 1 && n <= (inv.items || []).length)) return { error: `${inv.id} has ${(inv.items || []).length} line items; there is no item ${input.item_number}.` };
  const removed = inv.items[n - 1]?.name;
  const updated = await ctx.onAction({ action: 'remove_item', invoiceId: inv.id, itemIndex: n });
  return { ok: true, document_id: inv.id, removed, new_total: money(ctx.calcTotals(updated || inv).total) };
}

async function updateDocument(input, ctx) {
  const { inv, error } = requireDoc(ctx, input.document_id);
  if (error) return { error };
  const changes = { ...(input.changes || {}) };
  if (typeof changes.client === 'string') {
    const c = exactClient(ctx, changes.client);
    if (!c) return { error: `No client named "${changes.client}".` };
    changes.client = c.name;
  }
  const updated = await ctx.onAction({ action: 'update_invoice', invoiceId: inv.id, changes });
  const u = updated || inv;
  return { ok: true, document_id: inv.id, status: u.status, due: u.dueDate, client: u.client, total: money(ctx.calcTotals(u).total) };
}

async function recordPayment(input, ctx) {
  const { inv, error } = requireDoc(ctx, input.document_id);
  if (error) return { error };
  if (inv.type === 'estimate') return { error: `${inv.id} is an estimate. Payments go on invoices.` };
  const amount = Number(input.amount);
  if (!(amount > 0)) return { error: 'Payment amount must be more than zero.' };
  const updated = await ctx.onAction({
    action: 'add_payment', invoiceId: inv.id,
    payment: { amount, method: input.method || 'Cash', date: input.date || hawaiiToday() },
  });
  const u = updated || inv;
  const t = ctx.calcTotals(u);
  return { ok: true, document_id: inv.id, recorded: money(amount), paid: money(t.paid), balance: money(t.balance), status: u.status };
}

async function savePrice(input, ctx) {
  const price = Number(input.price);
  if (!input.name || !Number.isFinite(price)) return { error: 'Need a name and a price.' };
  const item = { name: String(input.name).trim(), category: input.category || 'Custom', price };
  await ctx.onAction({ action: 'save_item', item });
  return { ok: true, saved: item, card: { type: 'saved_item', item } };
}

async function deleteDocument(input, ctx) {
  const { inv, error } = requireDoc(ctx, input.document_id);
  if (error) return { error };
  const t = ctx.calcTotals(inv);
  const label = `${inv.id} (${inv.client || 'no client'}, $${money(t.total).toFixed(2)})`;
  if (!window.confirm(`Delete ${label}? It goes to Recently Deleted for 30 days.`)) {
    return { ok: false, cancelled: true, note: 'Jake cancelled the delete. Nothing was changed.' };
  }
  await ctx.onAction({ action: 'delete_invoice', invoiceId: inv.id });
  return { ok: true, deleted: inv.id };
}

function sendDocumentEmail(input, ctx) {
  const id = String(input.document_id || '').trim().toUpperCase();
  const inv = ctx.getData().invoices.find(i => i.id === id);
  if (!inv) return { error: `No document ${id} in the app.` };
  const client = ctx.getData().clients.find(c => c.name === inv.client);
  if (!client?.email) return { error: `${inv.client || 'That client'} has no email on file. Add one with update_client first.` };
  return {
    ok: true, sent: false,
    note: `Confirmation card shown. Nothing is sent until Jake taps Confirm Send. Recipient: ${client.email}.`,
    card: { type: 'confirm_email', invoiceId: id, email: client.email, total: ctx.calcTotals(inv).total },
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────
const TOOLS = {
  search_documents: searchDocuments,
  get_document: getDocument,
  find_client: findClient,
  search_price_book: searchPriceBook,
  get_schedule: getSchedule,
  business_summary: businessSummary,
  query_database: queryDatabase,
  create_client: createClient,
  update_client: updateClient,
  create_document: createDocument,
  add_line_items: addLineItems,
  update_line_item: updateLineItem,
  remove_line_item: removeLineItem,
  update_document: updateDocument,
  record_payment: recordPayment,
  save_price: savePrice,
  schedule_job: (input, ctx) => ctx.scheduleJob(input),
  send_document_email: sendDocumentEmail,
  delete_document: deleteDocument,
};
const WRITE_TOOLS = new Set([
  'create_client', 'update_client', 'create_document', 'add_line_items', 'update_line_item',
  'remove_line_item', 'update_document', 'record_payment', 'save_price', 'schedule_job',
  'send_document_email', 'delete_document',
]);

// What the chat shows while a tool runs.
const PROGRESS = {
  search_documents: 'Searching documents',
  get_document: (i) => `Reading ${i.document_id || 'document'}`,
  find_client: (i) => `Looking up ${i.query || 'client'}`,
  search_price_book: 'Checking the price book',
  get_schedule: 'Checking the schedule',
  business_summary: 'Adding up the numbers',
  query_database: 'Checking the database',
  create_client: (i) => `Adding client ${i.name || ''}`.trim(),
  update_client: 'Updating client',
  create_document: (i) => `Creating ${i.type || 'estimate'}`,
  add_line_items: (i) => `Adding items to ${i.document_id || 'document'}`,
  update_line_item: (i) => `Editing ${i.document_id || 'line item'}`,
  remove_line_item: (i) => `Editing ${i.document_id || 'line item'}`,
  update_document: (i) => `Updating ${i.document_id || 'document'}`,
  record_payment: (i) => `Recording payment on ${i.document_id || 'invoice'}`,
  save_price: 'Saving price',
  schedule_job: (i) => `Booking ${i.client_name || 'job'}`,
  send_document_email: 'Preparing email',
  delete_document: (i) => `Deleting ${i.document_id || 'document'}`,
};
const progressLabel = (name, input) => {
  const p = PROGRESS[name];
  return (typeof p === 'function' ? p(input || {}) : p) || 'Working';
};

async function execTool(name, input, ctx) {
  const fn = TOOLS[name];
  if (!fn) return { error: `Unknown tool ${name}.` };
  try {
    return (await fn(input || {}, ctx)) || { ok: true };
  } catch (e) {
    console.error('[agent tool failed]', name, e);
    return { error: `${name} failed: ${e?.message || e}. Nothing may have been saved; check before retrying.` };
  }
}

// A one-line trace of what each write did, stored with the reply and replayed
// to the model on later turns, so "add a drain line to that estimate" still
// knows which estimate. Without it the model only sees its own prose.
function traceLine(name, input, result) {
  if (result?.error) return `${name} FAILED: ${result.error}`;
  const bits = [result.document_id || input.document_id, result.name || input.name || input.client_name,
    result.total != null ? `$${result.total}` : null, result.new_total != null ? `now $${result.new_total}` : null,
    result.recorded != null ? `$${result.recorded} recorded, balance $${result.balance}` : null,
    result.cancelled ? 'cancelled by Jake' : null, result.sent === false ? 'awaiting Jake\'s tap' : null]
    .filter(Boolean);
  return `${name}${bits.length ? ' -> ' + bits.join(', ') : ''}`;
}

// Turn Anthropic / network failures into something Jake can act on. "Try
// again" is wrong advice for a spend cap or a dead key.
export function describeFailure(err) {
  const raw = String(err?.message || err || '');
  if (/usage limit/i.test(raw)) return 'Blocked: the Anthropic API usage limit is maxed out. Retrying will not help until it resets or the limit is raised in the Anthropic Console.';
  if (/credit balance|billing/i.test(raw)) return 'Blocked: the Anthropic account is out of credit. Top it up in the Anthropic Console.';
  if (/authentication|invalid x-api-key|API key not configured/i.test(raw)) return 'Blocked: the Anthropic API key on Vercel is missing or rejected.';
  if (/rate.?limit/i.test(raw)) return 'Rate limited, not broken. Give it a minute and ask again.';
  if (/overloaded/i.test(raw)) return 'The AI service is overloaded right now. Same question in a minute should work.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return 'No connection to the server. Check signal and try again.';
  return `Something failed: ${raw.slice(0, 200)}`;
}

// Rebuild the API conversation from the chat's stored messages: text only,
// oldest first, starting on a user turn. Tool calls from earlier messages are
// not replayed; their trace line stands in for them.
function buildHistory(msgs, cleanText) {
  const out = [];
  for (const m of msgs.slice(-HISTORY_MESSAGES)) {
    if (m.role === 'user') {
      const text = (m.agentCtx || '') + (m.text || '');
      if (text.trim()) out.push({ role: 'user', content: text });
    } else {
      const body = cleanText ? cleanText(m.text || '') : (m.text || '');
      const text = [body, m.agentTrace ? `[Actions taken: ${m.agentTrace}]` : ''].filter(s => s.trim()).join('\n\n');
      if (text.trim()) out.push({ role: 'assistant', content: text });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function callModel(messages) {
  const res = await fetch(api('/api/ai'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'agent', messages }),
  });
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || data.error);
  if (data?.type === 'error') throw new Error(data?.error?.message || 'API error');
  return data;
}

/**
 * Run one user message through the agent.
 *
 * @param {object}   opts
 * @param {Array}    opts.priorMsgs   chat messages before this one (GlobalAIModal shape)
 * @param {string}   opts.text        what Jake typed
 * @param {Array}    opts.photos      data URLs attached to this message
 * @param {string}   opts.userLabel   who is signed in, for the context block
 * @param {object}   opts.ctx         { getData, calcTotals, onAction, scheduleJob, openDocId, cleanText }
 * @param {Function} opts.onProgress  called with a short status string while tools run
 * @returns {Promise<{ reply: string, cards: object[], trace: string, agentCtx: string }>}
 */
export async function runAgentMessage({ priorMsgs, text, photos, userLabel, ctx, onProgress }) {
  const agentCtx = contextBlock(userLabel);
  const content = [];
  for (const dataUrl of photos || []) {
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: agentCtx + (text || '(see attached photo)') });

  // Append-only within the message: every model call re-sends this array with
  // the previous response and tool results added on the end, unmodified, which
  // is what keeps the model's own reasoning valid between steps.
  const working = [...buildHistory(priorMsgs, ctx.cleanText), { role: 'user', content }];
  const cards = [];
  const trace = [];
  let reply = '';

  for (let step = 0; step < MAX_STEPS; step++) {
    onProgress?.(step === 0 ? 'Thinking' : 'Working');
    const resp = await callModel(working);
    working.push({ role: 'assistant', content: resp.content || [] });
    const said = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    if (resp.stop_reason === 'refusal') {
      reply = said || 'I can\'t help with that one.';
      break;
    }
    if (resp.stop_reason !== 'tool_use') {
      reply = said || 'Done.';
      if (resp.stop_reason === 'max_tokens') reply += '\n\n(Cut off. Ask me to continue.)';
      break;
    }

    const results = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      onProgress?.(progressLabel(block.name, block.input));
      const result = await execTool(block.name, block.input, ctx);
      if (result?.card) cards.push(result.card);
      if (WRITE_TOOLS.has(block.name)) trace.push(traceLine(block.name, block.input || {}, result));
      const { card, ...forModel } = result || {};
      let body = JSON.stringify(forModel);
      if (body.length > MAX_RESULT_CHARS) body = body.slice(0, MAX_RESULT_CHARS) + '... [truncated; narrow the query]';
      results.push({ type: 'tool_result', tool_use_id: block.id, content: body, ...(forModel.error ? { is_error: true } : {}) });
    }
    working.push({ role: 'user', content: results });

    if (step === MAX_STEPS - 1) {
      reply = (said ? said + '\n\n' : '') + 'That took more steps than I allow in one message. Say "keep going" and I will pick it up.';
    }
  }

  return { reply, cards, trace: trace.join('; '), agentCtx };
}

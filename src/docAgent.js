// The estimate assistant's loop (v1.88.0). The model runs on the server
// (/api/ai, mode 'doc', prompt and tools in api/_lib/doc-agent.js); its tools
// run here, against the document open in the editor, through the form's own
// local-action handler. So a change shows on screen the moment it happens and
// the form's normal save path persists it.
//
// The result of each tool is the only record of what changed. The chat shows
// those results, never the model's own claim, so "Done" with nothing done
// cannot happen. When every tool in a response is an edit and all of them
// succeed, the turn ends there: one model call per thing Jake says, which is
// what keeps a voice walk-through quick.

import { api } from './apiBase.js';
import { pastJobLines } from '../api/_lib/pricing-brain.js';

const MAX_STEPS = 8;
const HISTORY_MESSAGES = 30;
const WRITE_TOOLS = new Set(['add_lines', 'update_line', 'remove_lines', 'duplicate_line', 'move_line', 'update_document', 'record_payment', 'open_send', 'convert_to_invoice', 'change_order']);
const TZ = 'Pacific/Honolulu';

const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function imageBlocks(photos) {
  const out = [];
  for (const dataUrl of photos || []) {
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (m) out.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  return out;
}

// The <document> block: the open document exactly as it is now.
export function documentBlock(ctx) {
  const { doc, coMode } = ctx.getDoc();
  const t = ctx.calcTotals ? ctx.calcTotals(doc) : null;
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now);
  const lines = (doc.items || []).map((it, i) => {
    const total = (Number(it.qty) || 1) * (Number(it.price) || 0);
    const desc = it.desc ? `\n     ${String(it.desc).replace(/\n/g, ' / ').slice(0, 400)}` : '';
    return `  ${i + 1}. ${it.name || '(no title)'} | qty ${it.qty ?? 1} x ${money(it.price)} = ${money(total)}${it.taxable === false ? ' | not taxed' : ''}${desc}`;
  }).join('\n');
  const ci = doc.clientInfo || {};
  const parts = [
    `<document>`,
    `Today: ${today}. Signed in: ${ctx.userLabel || 'unknown'}.`,
    `${(doc.type || 'invoice').toUpperCase()} ${doc.id || '(new, not saved yet)'} | status ${doc.status || 'draft'} | date ${doc.date || ''}${doc.dueDate ? ` | due ${doc.dueDate}` : ''}`,
    `Client: ${doc.client || '(none)'}${ci.phone ? ` | phone ${ci.phone}` : ''}${ci.email ? ` | email ${ci.email}` : ''}`,
    coMode ? `CHANGE ORDER MODE: the lines below are change order ${coMode}'s lines, not the invoice's. Line tools edit the change order.` : '',
    `Lines:\n${lines || '  (none yet)'}`,
    t ? `Subtotal ${money(t.subtotal)}${Number(doc.discount) ? ` | discount ${doc.discountType === '%' ? `${doc.discount}%` : money(doc.discount)}` : ''} | tax ${doc.tax ?? 0}% ${money(t.tax)} | total ${money(t.total)}${t.paid ? ` | paid ${money(t.paid)} | balance ${money(t.balance)}` : ''}` : '',
    `Notes (customer sees): ${doc.notes || '(none)'}`,
    ctx.changeOrderBlock ? ctx.changeOrderBlock : 'Change orders: not available on this document (they start once an estimate is approved and converted).',
    `</document>`,
  ];
  return parts.filter(Boolean).join('\n');
}

// Earlier messages as plain text. Changes ride along so "the last one" and
// "make that two" resolve against what really happened.
function history(priorMsgs) {
  const out = [];
  for (const m of (priorMsgs || []).slice(-HISTORY_MESSAGES)) {
    let text = m.role === 'user' ? (m.text || '') : [m.text || '', (m.changes || []).length ? `[Changes made: ${m.changes.map((c) => c.text).join('; ')}]` : ''].filter(Boolean).join('\n');
    if (!text.trim()) continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function callModel(messages) {
  const res = await fetch(api('/api/ai'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'doc', messages }),
  });
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || String(data.error));
  return data;
}

const lineNo = (n, count) => {
  const i = Math.floor(Number(n)) - 1;
  return i >= 0 && i < count ? i : null;
};

function pickLine(it) {
  const out = {};
  if (typeof it.name === 'string') out.name = it.name.trim();
  // The model sometimes writes the two characters \\n instead of a line break.
  if (typeof it.desc === 'string') out.desc = it.desc.replace(/\\n/g, '\n').trim();
  if (Number.isFinite(Number(it.qty)) && it.qty !== undefined && it.qty !== null && it.qty !== '') out.qty = Number(it.qty);
  if (Number.isFinite(Number(it.price)) && it.price !== undefined && it.price !== null && it.price !== '') out.price = Math.round(Number(it.price) * 100) / 100;
  if (typeof it.taxable === 'boolean') out.taxable = it.taxable;
  return out;
}

// One tool call against the open document. Returns { ok, ...forModel } plus
// change/draft side records the chat shows.
async function runTool(name, input, ctx, rec) {
  const items = () => ctx.getDoc().doc.items || [];
  const act = async (a) => { const ok = await ctx.act(a); await tick(); return !!ok; };
  const change = (text, extra = {}) => rec.changes.push({ text, ...extra });

  switch (name) {
    case 'add_lines': {
      const add = (input.lines || []).map(pickLine).filter((l) => l.name && Number.isFinite(l.price));
      if (!add.length) return { ok: false, error: 'No usable lines (each needs a name and a price).' };
      const start = items().length;
      const ok = await act({ action: 'append_items', items: add.map((l) => ({ qty: 1, desc: '', ...l })) });
      if (!ok) return { ok: false, error: 'The editor did not accept the lines.' };
      const assumptions = (input.assumptions || []).filter(Boolean).map(String);
      add.forEach((l, i) => change(`Added line ${start + i + 1}: ${l.name}${(l.qty || 1) !== 1 ? ` x${l.qty}` : ''}, ${money(l.price)}`, { kind: 'add', name: l.name, price: l.price, qty: l.qty || 1 }));
      if (assumptions.length) rec.assumptions.push(...assumptions);
      return { ok: true, added: add.map((l, i) => ({ line: start + i + 1, name: l.name, price: l.price })), line_count: items().length };
    }
    case 'update_line': {
      const i = lineNo(input.line, items().length);
      if (i === null) return { ok: false, error: `There is no line ${input.line}. The document has ${items().length} lines.` };
      const changes = pickLine(input);
      if (!Object.keys(changes).length) return { ok: false, error: 'Nothing to change.' };
      const before = items()[i];
      const ok = await act({ action: 'update_item', itemIndex: i + 1, changes });
      if (!ok) return { ok: false, error: 'The editor did not accept the change.' };
      const what = [
        changes.name !== undefined && changes.name !== before.name ? `title "${changes.name}"` : '',
        changes.qty !== undefined && changes.qty !== before.qty ? `qty ${changes.qty}` : '',
        changes.price !== undefined && changes.price !== before.price ? `price ${money(before.price)} to ${money(changes.price)}` : '',
        changes.desc !== undefined && changes.desc !== before.desc ? 'description' : '',
        changes.taxable !== undefined ? (changes.taxable ? 'taxed' : 'not taxed') : '',
      ].filter(Boolean).join(', ');
      change(`Line ${i + 1} (${changes.name || before.name}): ${what || 'updated'}`, { kind: 'update', name: changes.name || before.name, price: changes.price ?? before.price });
      if (input.assumptions?.length) rec.assumptions.push(...input.assumptions.map(String));
      return { ok: true, line: i + 1 };
    }
    case 'remove_lines': {
      const count = items().length;
      const idx = [...new Set((input.lines || []).map((n) => lineNo(n, count)).filter((x) => x !== null))].sort((a, b) => b - a);
      if (!idx.length) return { ok: false, error: `No such line. The document has ${count} lines.` };
      const names = idx.map((i) => items()[i]?.name || `line ${i + 1}`);
      for (const i of idx) if (!(await act({ action: 'remove_item', itemIndex: i + 1 }))) return { ok: false, error: `Could not remove line ${i + 1}.` };
      idx.forEach((i, k) => change(`Removed line ${i + 1}: ${names[k]}`, { kind: 'remove', name: names[k] }));
      return { ok: true, removed: idx.map((i) => i + 1), line_count: items().length, note: 'Line numbers after the removed ones moved up.' };
    }
    case 'duplicate_line': {
      const i = lineNo(input.line, items().length);
      if (i === null) return { ok: false, error: `There is no line ${input.line}.` };
      const n = Math.min(20, Math.max(1, Math.floor(Number(input.copies) || 1)));
      const src = items()[i];
      const start = items().length;
      if (!(await act({ action: 'duplicate_item', itemIndex: i + 1, copies: n }))) return { ok: false, error: 'Could not duplicate it.' };
      for (let k = 0; k < n; k++) change(`Added line ${start + k + 1}: copy of line ${i + 1} (${src.name}), ${money(src.price)}`, { kind: 'add', name: src.name, price: src.price, qty: src.qty || 1 });
      return { ok: true, new_lines: Array.from({ length: n }, (_, k) => start + k + 1) };
    }
    case 'move_line': {
      const count = items().length;
      const i = lineNo(input.line, count);
      const to = Math.min(count, Math.max(1, Math.floor(Number(input.to) || 1))) - 1;
      if (i === null) return { ok: false, error: `There is no line ${input.line}.` };
      const nm = items()[i]?.name;
      if (!(await act({ action: 'move_item', from: i, to }))) return { ok: false, error: 'Could not move it.' };
      change(`Moved ${nm} from line ${i + 1} to line ${to + 1}`);
      return { ok: true, line: to + 1 };
    }
    case 'update_document': {
      const c = {};
      if (typeof input.notes === 'string') c.notes = input.notes;
      if (Number.isFinite(Number(input.discount)) && input.discount !== undefined) c.discount = Number(input.discount);
      if (input.discount_type === '%' || input.discount_type === '$') c.discountType = input.discount_type;
      if (Number.isFinite(Number(input.tax)) && input.tax !== undefined) c.tax = Number(input.tax);
      if (typeof input.client === 'string' && input.client.trim()) c.client = input.client.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) c.date = input.date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.due_date || '')) c.dueDate = input.due_date;
      if (!Object.keys(c).length) return { ok: false, error: 'Nothing to change.' };
      if (ctx.getDoc().coMode) return { ok: false, error: 'Leave change order mode to change the document itself.' };
      if (!(await act({ action: 'update_invoice', changes: c }))) return { ok: false, error: 'The editor did not accept the change.' };
      const d = ctx.getDoc().doc;
      const said = [
        c.discount !== undefined || c.discountType ? `discount ${d.discountType === '%' ? `${d.discount}%` : money(d.discount)}` : '',
        c.tax !== undefined ? `tax ${c.tax}%` : '',
        c.notes !== undefined ? 'notes updated' : '',
        c.client ? `client ${d.client}` : '',
        c.date ? `date ${c.date}` : '', c.dueDate ? `due ${c.dueDate}` : '',
      ].filter(Boolean).join(', ');
      change(`Document: ${said}`);
      const t = ctx.calcTotals ? ctx.calcTotals(d) : null;
      return { ok: true, client: d.client, ...(t ? { total: t.total } : {}) };
    }
    case 'record_payment': {
      const { doc } = ctx.getDoc();
      if (doc.type === 'estimate') return { ok: false, error: 'This is an estimate. Payments go on the invoice.' };
      const amount = Number(input.amount);
      if (!(amount > 0)) return { ok: false, error: 'Give a payment amount.' };
      if (!(await act({ action: 'add_payment', payment: { amount, method: input.method || 'Cash', date: input.date, note: input.note || '' } }))) return { ok: false, error: 'The editor did not accept the payment.' };
      change(`Payment recorded: ${money(amount)}${input.method ? ` by ${input.method}` : ''}`);
      return { ok: true };
    }
    case 'open_send': {
      const { doc } = ctx.getDoc();
      if (!doc.client) return { ok: false, error: 'No client on this document yet.' };
      if (input.channel === 'text') {
        if (!(await act({ action: 'send_text' }))) return { ok: false, error: 'Save the document first, then I can open the text.' };
        change('Text ready to check. Tap Send when it looks right.');
        return { ok: true, opened: 'text preview' };
      }
      if (!(await act({ action: 'send_email' }))) return { ok: false, error: 'Save the document first, then I can open the email.' };
      change('Email ready to check. Tap Send when it looks right.');
      return { ok: true, opened: 'email send screen' };
    }
    case 'convert_to_invoice': {
      const { doc } = ctx.getDoc();
      if (doc.type !== 'estimate') return { ok: false, error: 'This is already an invoice.' };
      if (!(await act({ action: 'convert_to_invoice' }))) return { ok: false, error: 'Could not start the conversion.' };
      change('Conversion to an invoice started. Confirm it on screen.');
      return { ok: true };
    }
    case 'change_order': {
      if (!ctx.runChangeOrder) return { ok: false, error: 'Change orders are not available on this document.' };
      const r = await ctx.runChangeOrder(input.order || {});
      if (r?.draft) rec.drafts.push(r.draft);
      change(r?.text || 'Change order updated.');
      return { ok: !r?.error, result: r?.text || '' };
    }
    case 'walkthrough_summary': {
      const { doc } = ctx.getDoc();
      const log = ctx.sessionLog ? ctx.sessionLog() : { changes: [], assumptions: [] };
      const t = ctx.calcTotals ? ctx.calcTotals(doc) : null;
      return {
        ok: true,
        changes_this_session: [...log.changes, ...rec.changes].map((c) => c.text),
        assumptions_this_session: [...log.assumptions, ...rec.assumptions],
        lines_now: (doc.items || []).map((it, i) => ({ line: i + 1, name: it.name, qty: it.qty ?? 1, price: it.price })),
        ...(t ? { subtotal: t.subtotal, tax: t.tax, total: t.total } : {}),
      };
    }
    case 'search_price_book': {
      const words = String(input.query || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ''));
      const book = ctx.savedItems || [];
      const scored = book.map((i) => {
        const hay = `${i.name} ${i.category}`.toLowerCase();
        return { i, s: words.length ? words.filter((w) => hay.includes(w)).length : 1 };
      }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 25);
      return {
        ok: true,
        items: scored.map(({ i }) => ({
          name: i.name, price: i.price,
          ...(i.hours ? { labor_hours: i.hours } : {}),
          ...(i.materials?.length ? { parts_at_cost: i.materials.map((m) => ({ name: m.name, qty: m.qty || 1, cost: m.cost })) } : {}),
        })),
      };
    }
    case 'past_jobs': {
      const q = (input.keywords || []).join(' ');
      const lines = pastJobLines(ctx.invoices || [], q, 25);
      return { ok: true, jobs: lines ? lines.split('\n').map((s) => s.trim()) : [], note: lines ? 'date | doc status | client | line | price' : 'No past line items match.' };
    }
    default:
      return { ok: false, error: `Unknown tool ${name}.` };
  }
}

/**
 * Run one message. ctx: { getDoc, act, calcTotals, savedItems, invoices,
 * sessionLog, changeOrderBlock, runChangeOrder, userLabel }.
 * Returns { reply, changes, assumptions, drafts }.
 */
export async function runDocMessage({ priorMsgs, text, photos, ctx, onProgress }) {
  const content = [...imageBlocks(photos), { type: 'text', text: `${documentBlock(ctx)}\n\n${text || '(see attached photo)'}` }];
  const working = [...history(priorMsgs), { role: 'user', content }];
  if (working.length > 1 && working[working.length - 2].role === 'user') {
    // Two user turns in a row (an earlier reply failed): fold them together.
    const prev = working.splice(working.length - 2, 1)[0];
    content.unshift({ type: 'text', text: `(Earlier, unanswered: ${prev.content})` });
  }
  const rec = { changes: [], assumptions: [], drafts: [] };
  let reply = '';

  for (let step = 0; step < MAX_STEPS; step++) {
    onProgress?.(step === 0 ? 'Thinking' : 'Working');
    const resp = await callModel(working);
    working.push({ role: 'assistant', content: resp.content || [] });
    const said = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    if (resp.stop_reason === 'refusal') { reply = said || "I can't help with that one."; break; }
    if (resp.stop_reason === 'pause_turn') continue;
    if (resp.stop_reason !== 'tool_use') {
      reply = said;
      if (resp.stop_reason === 'max_tokens') reply += '\n\n(Cut off. Ask me to continue.)';
      break;
    }

    const uses = (resp.content || []).filter((b) => b.type === 'tool_use');
    const results = [];
    let allWritesOk = uses.length > 0;
    for (const u of uses) {
      onProgress?.(u.name === 'add_lines' ? 'Adding' : u.name.startsWith('search') || u.name === 'past_jobs' ? 'Checking prices' : 'Working');
      let out;
      try { out = await runTool(u.name, u.input || {}, ctx, rec); }
      catch (e) { out = { ok: false, error: String(e?.message || e) }; }
      if (!WRITE_TOOLS.has(u.name) || !out?.ok) allWritesOk = false;
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 12000), ...(out?.ok === false ? { is_error: true } : {}) });
    }
    // Every edit landed: the change list is the answer. One call per message.
    if (allWritesOk) { reply = said; break; }
    working.push({ role: 'user', content: results });
    if (step === MAX_STEPS - 1) reply = (said ? `${said}\n\n` : '') + 'That took more steps than I allow in one message. Say "keep going" and I will pick it up.';
  }

  return { reply, ...rec };
}

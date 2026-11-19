// Estimate assistant test (v1.88.0). Replays a walk-through and the common
// edit commands against a fake open document, with the real prompt, tools,
// model and the real tool code in src/docAgent.js. Sends nothing, writes
// nothing: the "editor" here is a plain object with the same local actions
// the app's InvoiceForm handles.
//
//   bash tests/doc-agent/run.sh          all steps
// Each step checks what the document looks like afterwards, not what the
// model said.

import { DOC_MODEL, DOC_SYSTEM, DOC_TOOLS } from '../../api/_lib/doc-agent.js';

// /api/ai mode 'doc', straight to Anthropic.
globalThis.fetch = ((orig) => async (url, opts) => {
  if (!String(url).endsWith('/api/ai')) return orig(url, opts);
  const { messages } = JSON.parse(opts.body);
  const r = await orig('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: DOC_MODEL, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
      system: [{ type: 'text', text: DOC_SYSTEM, cache_control: { type: 'ephemeral' } }], tools: DOC_TOOLS, messages }),
  });
  return r;
})(globalThis.fetch);

const { runDocMessage } = await import('../../src/docAgent.js');
const { PRICING_BRAIN } = await import('../../api/_lib/pricing-brain.js');

// Real price book and past jobs, so prices are tested too.
const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
const get = async (p) => (await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } })).json();
const savedItems = (await get('saved_items?select=name,category,price,hours,materials')).map((r) => ({ ...r, price: Number(r.price) }));
const invs = await get('invoices?select=id,type,status,client_name,date&deleted_at=is.null&order=date.desc&limit=1000');
const its = await get('invoice_items?select=invoice_id,name,description,qty,price&order=invoice_id.desc&limit=4000');
const byId = new Map(invs.map((i) => [i.id, { ...i, client: i.client_name, items: [] }]));
for (const it of its) byId.get(it.invoice_id)?.items.push({ ...it, desc: it.description });
const invoices = [...byId.values()];

// The fake editor.
const doc = { id: 'EST9999', type: 'estimate', status: 'pending', date: '2026-11-18', client: 'Test Customer', clientInfo: { phone: '8085550100', email: 'test@example.com' }, items: [], notes: '', discount: 0, discountType: '$', tax: 4.712, payments: [] };
const opened = [];
function act(a) {
  const it = doc.items;
  switch (a.action) {
    case 'append_items': doc.items = [...it, ...a.items.map((x) => ({ qty: 1, desc: '', ...x }))]; return true;
    case 'update_item': { const i = a.itemIndex - 1; if (!it[i]) return false; it[i] = { ...it[i], ...a.changes }; return true; }
    case 'remove_item': { const i = a.itemIndex - 1; if (!it[i]) return false; it.splice(i, 1); return true; }
    case 'duplicate_item': { const i = a.itemIndex - 1; if (!it[i]) return false; for (let k = 0; k < (a.copies || 1); k++) it.push({ ...it[i] }); return true; }
    case 'move_item': { const [m] = it.splice(a.from, 1); it.splice(a.to, 0, m); return true; }
    case 'update_invoice': Object.assign(doc, a.changes); return true;
    case 'add_payment': doc.payments.push(a.payment); return true;
    case 'send_email': case 'send_text': case 'convert_to_invoice': opened.push(a.action); return true;
    case 'restore_doc': Object.assign(doc, JSON.parse(JSON.stringify(a.snapshot))); return true;
    default: return false;
  }
}
const calcTotals = (d) => {
  const sub = d.items.reduce((s, x) => s + (Number(x.qty) || 1) * (Number(x.price) || 0), 0);
  const disc = d.discountType === '%' ? sub * (Number(d.discount) || 0) / 100 : Number(d.discount) || 0;
  const tax = (sub - disc) * (Number(d.tax) || 0) / 100;
  const paid = (d.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { subtotal: sub, tax, total: sub - disc + tax, paid, balance: sub - disc + tax - paid };
};

const msgs = [];
const ctx = {
  getDoc: () => ({ doc, coMode: null }), act, calcTotals, savedItems, invoices, userLabel: 'Jake Petersen (admin)',
  sessionLog: () => ({ changes: msgs.flatMap((m) => m.changes || []), assumptions: msgs.flatMap((m) => m.assumptions || []) }),
};

const names = () => doc.items.map((x) => x.name.toLowerCase());
const has = (re) => doc.items.some((x) => re.test(`${x.name} ${x.desc}`));
const STEPS = [
  ['add a new toilet install', () => doc.items.length === 1 && has(/toilet/i)],
  ['in the master bath the shower valve needs to be replaced, customer already bought the valve', () => doc.items.length === 2 && /master/i.test(doc.items[1].name) && has(/valve/i)],
  ['also add to new angle stops at the master bath sink', () => doc.items.length === 3 && has(/angle/i)],
  ['make that two', () => doc.items.length === 3 && (Number(doc.items[2].qty) === 2 || /pair|two|\(2\)/i.test(doc.items[2].name + doc.items[2].desc))],
  ['kitchen faucet is dripping, replace the cartridge. and the disposal hums, replace it with a badger 5', () => doc.items.length === 5 && has(/cartridge/i) && has(/dispos/i)],
  ['scratch the last one', () => doc.items.length === 4 && !names().some((n) => /dispos/.test(n))],
  ['duplicate line 1', () => doc.items.length === 5 && doc.items[4].name === doc.items[0].name && doc.items[4].price === doc.items[0].price],
  ['remove the duplicate toilet', () => doc.items.length === 4 && names().filter((n) => /toilet/.test(n)).length === 1],
  ['change the toilet to $950', () => doc.items.some((x) => /toilet/i.test(x.name) && Number(x.price) === 950)],
  ['move the kitchen line to the top', () => /kitchen|cartridge/i.test(doc.items[0].name)],
  ['add a 10% discount', () => Number(doc.discount) === 10 && doc.discountType === '%'],
  ['put in the notes that the price is good for 30 days', () => /30 days/i.test(doc.notes)],
  ['what is the total right now?', () => doc.items.length === 4],
  ['show me everything from this walk through', () => doc.items.length === 4],
  ['reword the toilet description so it says we haul away the old one', () => doc.items.some((x) => /toilet/i.test(x.name) && /haul/i.test(x.desc))],
  ['take the discount off', () => !Number(doc.discount)],
  ['add a water heater flush for the 50 gallon in the garage', () => doc.items.length === 5 && has(/flush/i)],
  ['send it to her by text', () => opened.includes('send_text')],
  ['email it too', () => opened.includes('send_email')],
  ['convert it to an invoice', () => opened.includes('convert_to_invoice')],
];

let failed = 0;
const t0 = Date.now();
for (const [say, check] of STEPS) {
  const t = Date.now();
  const user = { role: 'user', text: say };
  let out;
  try { out = await runDocMessage({ priorMsgs: msgs, text: say, photos: [], ctx }); }
  catch (e) { out = { reply: `ERROR ${e.message}`, changes: [], assumptions: [], drafts: [] }; }
  msgs.push(user, { role: 'assistant', text: out.reply, changes: out.changes, assumptions: out.assumptions });
  const ok = check();
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${((Date.now() - t) / 1000).toFixed(1)}s  "${say}"`);
  if (out.reply) console.log(`      reply: ${out.reply.replace(/\n+/g, ' | ').slice(0, 400)}`);
  for (const c of out.changes) console.log(`      ✓ ${c.text}`);
  if (out.assumptions.length) console.log(`      assumed: ${out.assumptions.join('; ').slice(0, 300)}`);
}
console.log('\nFINAL DOCUMENT');
doc.items.forEach((x, i) => console.log(`  ${i + 1}. ${x.name} | qty ${x.qty} | $${x.price}`));
const T = calcTotals(doc);
console.log(`  total $${T.total.toFixed(2)} | notes: ${doc.notes}`);
console.log(`\n${STEPS.length - failed}/${STEPS.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);

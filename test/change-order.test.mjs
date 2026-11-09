// Server-side change order logic against a fake Supabase/Twilio/Telegram.
// Run: node test/change-order.test.mjs   (exits non-zero on failure)
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.TELEGRAM_TOKEN = 't';
process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 'x'; process.env.TWILIO_FROM_NUMBER = '+18085550000';
process.env.SMS_WEBHOOK_SECRET = 'whs';
process.env.RESEND_API_KEY = 're';

const db = {
  invoices: [{ id: 'INV1300', status: 'paid', tax: 4.712, client_name: 'Test', job_address: { line1: '1 Main St' }, deleted_at: null, updated_at: 'old' }],
  invoice_items: [{ invoice_id: 'INV1300', name: 'Water heater', sort_order: 0 }],
  change_orders: [{ id: 'co1', invoice_id: 'INV1300', seq: 1, status: 'sent', view_token: 'tok_aaaaaaaaaaaaaaaa', sent_to: '+18085551234', sent_at: new Date().toISOString(),
    items: [{ name: 'Add shutoff valve', desc: '3/4 inch', qty: 1, price: 150 }, { name: 'Extra hour', qty: 2, price: 100, taxable: false }], note: null }],
  invoice_events: [], settings: [{ key: 'sms_outbound_enabled', value: 'true' }],
};
const sms = [], tg = [], mail = [];
let failText = false;
const match = (row, params) => {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    if (op === 'eq' && String(row[k]) !== val) return false;
    if (op === 'like' && !String(row[k] || '').endsWith(val.replace(/^\*/, ''))) return false;
    if (op === 'gte' && !(String(row[k]) >= val)) return false;
  }
  return true;
};
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const m = opts.method || 'GET';
  const ok = (b, s = 200) => new Response(b == null ? '' : JSON.stringify(b), { status: s });
  if (u.hostname === 'api.telegram.org') { tg.push(JSON.parse(opts.body).text); return ok({ ok: true }); }
  if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(opts.body)); return ok({ id: 'em1' }); }
  if (u.hostname === 'api.twilio.com' && failText) return ok({ message: 'carrier blocked' }, 400);
  if (u.hostname === 'api.twilio.com') { sms.push(Object.fromEntries(new URLSearchParams(opts.body))); return ok({ sid: 'SM1' }, 201); }
  if (u.pathname.startsWith('/rest/v1/rpc/')) return ok({ ok: true });
  const table = u.pathname.replace('/rest/v1/', '');
  const rows = db[table] || (db[table] = []);
  const params = [...u.searchParams];
  if (m === 'GET') {
    let out = rows.filter(r => match(r, params));
    if (u.searchParams.get('order')?.startsWith('sort_order.desc')) out = [...out].sort((a, b) => b.sort_order - a.sort_order);
    return ok(out.slice(0, Number(u.searchParams.get('limit') || 1e9)));
  }
  if (m === 'POST') { const b = JSON.parse(opts.body); (Array.isArray(b) ? b : [b]).forEach(r => rows.push(r)); return ok(null, 201); }
  if (m === 'PATCH') { const b = JSON.parse(opts.body); const hit = rows.filter(r => match(r, params)); hit.forEach(r => Object.assign(r, b)); return ok(hit); }
  return ok(null);
};

const co = await import('../api/_lib/change-order.js');
let fails = 0;
const check = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fails++; };

for (const [t, want] of [['Yes', true], ['ok', true], ['OK!', true], ['Sounds good', true], ['yes please', true], ['go ahead', true], ['Approved.', true],
  ['ok?', false], ['no', false], ['yes but can you also look at the sink first', false], ['not yet', false], ['wait', false], ['what is this', false], ['', false]]) {
  check(`isYesReply(${JSON.stringify(t)}) = ${want}`, co.isYesReply(t) === want);
}

const txt = co.changeOrderText(db.change_orders[0], db.invoices[0]);
check('text has total incl. tax and link', /Total: \$357\.07 incl\. tax/.test(txt) && /\/co\/tok_aaaaaaaaaaaaaaaa/.test(txt) && /Reply YES/.test(txt));

const pub = await co.loadPublicChangeOrder('tok_aaaaaaaaaaaaaaaa');
check('public read hides id, shows label', pub && pub.changeOrder.id === undefined && pub.changeOrder.label === 'INV1300-CO1');

// Approve by text.
const r1 = await co.handleChangeOrderReply({ phone: '+1 (808) 555-1234', body: 'Yes' });
check('text YES approves', /approved by text/.test(r1 || ''));
const added = db.invoice_items.filter(i => /^Change order #1, approved/.test(i.description || ''));
check('2 lines added to invoice, after existing', added.length === 2 && added[0].sort_order === 1 && added[1].sort_order === 2);
check('desc keeps the original after the mark', /approved .* - 3\/4 inch$/.test(added[0].description));
check('paid invoice becomes partial and updated_at bumped', db.invoices[0].status === 'partial' && db.invoices[0].updated_at !== 'old');
check('change order approved via sms and applied', db.change_orders[0].status === 'approved' && db.change_orders[0].approved_via === 'sms' && !!db.change_orders[0].applied_at && db.change_orders[0].approval_message === 'Yes');
check('history event written', db.invoice_events.some(e => e.kind === 'change_order_approved' && e.meta.seq === 1));
check('customer got a confirmation text', sms.some(s => /change order 1 is approved/.test(s.Body)));
check('Jake told on Telegram', tg.some(t => /INV1300-CO1 approved by text/.test(t)));

// Second approval (signature after the text) adds nothing.
const r2 = await co.approveChangeOrder({ token: 'tok_aaaaaaaaaaaaaaaa', via: 'signature', signatureData: 'data:x', name: 'Test' });
check('second approval is a no-op', r2.ok && r2.already && db.invoice_items.length === 3);

// A YES with nothing open falls through to Lisa.
check('YES with no open change order returns null', (await co.handleChangeOrderReply({ phone: '+18085551234', body: 'yes' })) === null);

// Decline.
db.change_orders.push({ id: 'co2', invoice_id: 'INV1300', seq: 2, status: 'sent', view_token: 'tok_bbbbbbbbbbbbbbbb', sent_to: '+18085551234', sent_at: new Date().toISOString(), items: [{ name: 'X', qty: 1, price: 50 }] });
const d = await co.declineChangeOrder({ token: 'tok_bbbbbbbbbbbbbbbb' });
check('decline marks declined, adds nothing', d.ok && db.change_orders[1].status === 'declined' && db.invoice_items.length === 3);
const r3 = await co.approveChangeOrder({ token: 'tok_bbbbbbbbbbbbbbbb', via: 'signature', signatureData: 'x', name: 'T' });
check('declined cannot be approved', !r3.ok && r3.error === 'declined');

// Two open: asks for the links, approves nothing.
for (const [id, seq, tok] of [['co3', 3, 'tok_cccccccccccccccc'], ['co4', 4, 'tok_dddddddddddddddd']]) db.change_orders.push({ id, invoice_id: 'INV1300', seq, status: 'sent', view_token: tok, sent_to: '+18085551234', sent_at: new Date().toISOString(), items: [{ name: 'Y', qty: 1, price: 10 }] });
const r4 = await co.handleChangeOrderReply({ phone: '8085551234', body: 'ok' });
check('two open: nothing approved', /several open/.test(r4) && db.change_orders.filter(c => c.status === 'approved').length === 1);

// Send marks it sent with the phone.
db.change_orders.push({ id: 'co5', invoice_id: 'INV1300', seq: 5, status: 'draft', view_token: 'tok_eeeeeeeeeeeeeeee', items: [{ name: 'Z', qty: 1, price: 20 }] });
const s = await co.sendChangeOrder({ id: 'co5', to: '+18085559999' });
check('send texts the link and marks sent', s.ok && db.change_orders[4].status === 'sent' && db.change_orders[4].sent_to === '+18085559999' && sms.some(x => x.To === '+18085559999' && /tok_eeee/.test(x.Body)));

// Email only: no text goes out, the address is recorded, YES matching is untouched.
db.change_orders.push({ id: 'co6', invoice_id: 'INV1300', seq: 6, status: 'draft', view_token: 'tok_ffffffffffffffff', items: [{ name: 'Pressure valve', desc: 'PRV 3/4', qty: 1, price: 300 }], note: 'Found at the meter' });
const smsBefore = sms.length;
const e1 = await co.sendChangeOrder({ id: 'co6', email: 'pat@example.com' });
const m = mail[mail.length - 1];
check('email only: sent, no text', e1.ok && e1.sent.email === 'pat@example.com' && !e1.sent.text && sms.length === smsBefore);
check('email: to, bcc, subject, button link, nothing due', m && m.to[0] === 'pat@example.com' && m.bcc[0] === 'higradeplumbing@gmail.com' && /Change order 6 for your job at 1 Main St/.test(m.subject) && m.html.includes('/co/tok_ffffffffffffffff') && /Nothing is due now/.test(m.html) && /Aloha Test/.test(m.html));
check('email escapes customer-visible text', !/<script/.test((await (async () => { const x = co.changeOrderEmail({ ...db.change_orders[5], note: '<script>x</script>' }, db.invoices[0]); return x.html; })())));
check('email only: status sent, sent_email set, sent_to empty', db.change_orders[5].status === 'sent' && db.change_orders[5].sent_email === 'pat@example.com' && !db.change_orders[5].sent_to);
// Both, with the text failing: email still goes, result says what failed.
db.change_orders.push({ id: 'co7', invoice_id: 'INV1300', seq: 7, status: 'draft', view_token: 'tok_gggggggggggggggg', items: [{ name: 'Q', qty: 1, price: 5 }] });
failText = true;
const b = await co.sendChangeOrder({ id: 'co7', to: '+18085557777', email: 'pat@example.com' });
failText = false;
check('both, text fails: email sent, error reported', b.ok && b.sent.email && !b.sent.text && /text:/.test(b.errors.join()));
check('bad email refused', !(await co.sendChangeOrder({ id: 'co7', email: 'not-an-email' })).ok);

// Photos: page gets URLs only, email shows them, text points to the link.
const pc = { invoice_id: 'INV1300', seq: 8, status: 'sent', view_token: 'tok_hhhhhhhhhhhhhhhh', items: [{ name: 'W', qty: 1, price: 10 }],
  photos: [{ url: 'https://fake.supabase.co/storage/v1/object/public/job-photos/INV1300/a.jpg', job_photo_id: 'jp1' }, { url: 'javascript:alert(1)' }] };
db.change_orders.push({ id: 'co8', ...pc });
const pub2 = await co.loadPublicChangeOrder('tok_hhhhhhhhhhhhhhhh');
check('page photos: https only, url only', pub2.changeOrder.photos.length === 1 && Object.keys(pub2.changeOrder.photos[0]).join() === 'url');
const em2 = co.changeOrderEmail(pc, db.invoices[0]);
check('email shows the photo', em2.html.includes('job-photos/INV1300/a.jpg') && !em2.html.includes('javascript:'));
check('text mentions photos', /Photos are on the link/.test(co.changeOrderText(pc, db.invoices[0])));
check('no photos: text does not mention them', !/Photos are on/.test(co.changeOrderText({ ...pc, photos: [] }, db.invoices[0])));

// Preview sends nothing.
const sms0 = sms.length, mail0 = mail.length;
const pv = await co.previewChangeOrder({ id: 'co8' });
check('preview returns text + email, sends nothing', pv.ok && /Reply YES/.test(pv.text) && /Review &amp; Approve/.test(pv.email.html) && sms.length === sms0 && mail.length === mail0);

// v1.59.3: History events for change order sends and declines (never kind 'sent').
check('send logs change_order_sent with where it went', db.invoice_events.some(e => e.kind === 'change_order_sent' && e.meta.seq === 6 && e.meta.email === 'pat@example.com'));
check('decline logs change_order_declined', db.invoice_events.some(e => e.kind === 'change_order_declined' && e.meta.seq === 2));
check('change order sends never log a plain sent event', !db.invoice_events.some(e => e.kind === 'sent'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);

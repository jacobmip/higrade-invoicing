// Change orders (v1.53.0), driven in the built app against a fake Supabase.
//   SCENARIO=send     create a change order on INV1300 and text it
//   SCENARIO=landed   approved while the app was open: its lines reach the form and the save
//   SCENARIO=page     the customer's /co/<token> page: sign and approve
// Run: npm run build && npx vite preview --port 4173, then SCENARIO=... node test/e2e/change-order.mjs
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:4173';
const SCENARIO = process.env.SCENARIO || 'send';
const JAKE = '0a3bcefd-6faf-4bae-b43b-cd4492dd9938';
const t0 = Date.now(); const log = (...a) => console.log(String(Date.now()-t0).padStart(6), ...a);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now()/1000) + 3600*24;
const jwt = `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:JAKE,role:'authenticated',exp,aud:'authenticated'})}.sig`;
const user = { id: JAKE, aud:'authenticated', role:'authenticated', email:'jacobmip@gmail.com' };
const session = { access_token: jwt, refresh_token:'r', expires_in: 86400, expires_at: exp, token_type:'bearer', user };

const now = new Date(Date.now() - 3600e3).toISOString();
const db = {
  invoices: [
    { id:'EST1070', type:'estimate', client_name:'Test Client', date:'2026-10-29', status:'draft', converted_to_id:null, owner_id:JAKE, assigned_tech_id:JAKE, tax:4.712, discount:0, view_token:'tok1', visits:null, updated_at: now, created_at: now, deleted_at:null },
    { id:'INV1070', type:'invoice', client_name:'Test Client', date:'2026-10-29', status:'outstanding', converted_to_id:null, owner_id:JAKE, assigned_tech_id:JAKE, tax:4.712, discount:0, view_token:'tok2', visits:null, updated_at: now, created_at: now, deleted_at:null },
  ],
  invoice_items: [
    { id:'i1', invoice_id:'EST1070', name:'Drain clear', description:'', qty:1, price:250, unit:'ea', taxable:true, sort_order:0 },
    { id:'i2', invoice_id:'INV1070', name:'Drain clear', description:'', qty:1, price:250, unit:'ea', taxable:true, sort_order:0 },
  ],
  profiles: [{ id: JAKE, display_name:'Jake Petersen', role:'admin', tier:'admin' }],
};
db.invoices = [{ id:'INV1300', type:'invoice', client_name:'Test Client', date:'2026-11-08', status:'outstanding', converted_to_id:null, owner_id:JAKE, assigned_tech_id:JAKE, tax:4.712, discount:0, notes:'', view_token:'t2', visits:null, updated_at: now, created_at: now, deleted_at:null }];
db.invoice_items = [{ id:'a2', invoice_id:'INV1300', name:'Water heater', description:'', qty:1, price:1800, unit:'ea', taxable:true, sort_order:0 }];
db.clients = [{ id:'c1', name:'Test Client', phone:'8085551234', addresses:[] }];
db.change_orders = [];
const apiCalls = [];
let coState = 'sent';
if (SCENARIO === 'fresh') { db.invoices = db.invoices.filter(r => r.id !== 'INV1070'); db.invoice_items = db.invoice_items.filter(r => r.invoice_id !== 'INV1070'); }
const saves = [];
let saveDelayMs = Number(process.env.SAVE_DELAY || 300);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
await ctx.addInitScript(([s, scenario]) => {
  localStorage.setItem('sb-cwhgcxxszyvevjpbnnkc-auth-token', JSON.stringify(s));
  if (scenario === 'staledraft') {
    // A draft of EST1070 written on the phone before it was linked, newer than the server copy.
    localStorage.setItem('__stale_marker', '1');
  }
}, [session, SCENARIO]);
const page = await ctx.newPage();
page.on('dialog', async d => { const msg = d.message(); log('DIALOG', d.type(), JSON.stringify(msg.slice(0,90)));
  if (SCENARIO === 'cancel' && /already exists/.test(msg)) { log('  -> dismissing'); await d.dismiss(); } else await d.accept(); });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log('console.'+m.type(), m.text().slice(0,160)); });
page.on('pageerror', e => log('PAGEERROR', e.message));

await page.route('**/*', async route => {
  const req = route.request(); const url = new URL(req.url()); const m = req.method();
  if (!url.hostname.includes('supabase.co') && !url.pathname.startsWith('/api/')) return route.continue();
  const json = (body, status=200) => route.fulfill({ status, contentType:'application/json', body: JSON.stringify(body) });
  if (url.pathname.startsWith('/api/')) {
    const b = req.postData() ? JSON.parse(req.postData()) : null;
    apiCalls.push({ path: url.pathname, q: url.search, body: b });
    if (url.pathname === '/api/sms-inbound' && b?.op === 'send_change_order') {
      const co = db.change_orders.find(c => c.id === b.change_order_id); if (co) Object.assign(co, { status: 'sent', sent_to: b.to });
      return json({ ok: true, label: 'INV1300-CO1' });
    }
    if (url.pathname === '/api/public-invoice' && url.searchParams.get('co')) {
      return json({ changeOrder: { seq: 1, label: 'INV1300-CO1', status: coState, items: [{ name: 'Add shutoff valve', desc: '3/4 inch', qty: 1, price: 150 }], note: 'Found during repair', totals: { subtotal: 150, tax: 7.07, total: 157.07 }, approved_at: coState === 'approved' ? new Date().toISOString() : null, approved_name: 'Pat Customer' },
        job: { invoice_id: 'INV1300', client_name: 'Test Client', job_address: { line1: '1 Main St', city: 'Honolulu' }, tax: 4.712 } });
    }
    if (url.pathname === '/api/submit-signature' && b?.coToken) { coState = 'approved'; return json({ ok: true, label: 'INV1300-CO1' }); }
    return json({});
  }
  if (url.pathname.startsWith('/auth/v1/user')) return json(user);
  if (url.pathname.startsWith('/auth/v1/')) return json(session);
  if (url.pathname.startsWith('/realtime')) return route.abort();
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  if (url.pathname === '/rest/v1/rpc/save_invoice_with_items') {
    const body = req.postDataJSON(); const inv = body.inv;
    log('RPC save', inv.id, 'status=', inv.status, 'converted_to_id=', inv.converted_to_id, 'payments=', (body.payments||[]).length);
    saves.push({ at: Date.now()-t0, id: inv.id, status: inv.status, items: (body.items||[]).map(i => i.name + '|' + i.description) });
    await new Promise(r => setTimeout(r, saveDelayMs));
    const row = db.invoices.find(r => r.id === inv.id);
    const upd = new Date().toISOString();
    if (row) Object.assign(row, { status: inv.status, converted_to_id: inv.converted_to_id, updated_at: upd });
    else db.invoices.push({ ...inv, owner_id: JAKE, assigned_tech_id: JAKE, updated_at: upd, created_at: upd, deleted_at: null, visits: null });
    return json({ id: inv.id, updated_at: upd });
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  const table = url.pathname.replace('/rest/v1/','');
  if (m === 'GET') {
    let rows = db[table] || [];
    const idEq = url.searchParams.get('id');
    if (idEq && idEq.startsWith('eq.')) rows = rows.filter(r => r.id === idEq.slice(3));
    const invEq = url.searchParams.get('invoice_id');
    if (invEq && invEq.startsWith('eq.')) rows = rows.filter(r => r.invoice_id === invEq.slice(3));
    if (table === 'invoices' && /invoice_items/.test(url.searchParams.get('select') || '')) rows = rows.map(r => ({ ...r, invoice_items: db.invoice_items.filter(i => i.invoice_id === r.id), payments: [] }));
    if (single) return rows[0] ? json(rows[0]) : json({ code:'PGRST116', message:'none' }, 406);
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range': `0-${Math.max(rows.length-1,0)}/${rows.length}` }, body: JSON.stringify(rows) });
  }
  if (table === 'change_orders') {
    const b = req.postData() ? JSON.parse(req.postData()) : {};
    if (m === 'POST') { const row = { id: 'co' + (db.change_orders.length + 1), created_at: new Date().toISOString(), ...b }; db.change_orders.push(row); return json(single ? row : [row], 201); }
    if (m === 'PATCH') { const idq = url.searchParams.get('id'); const row = db.change_orders.find(c => 'eq.' + c.id === idq); if (row) Object.assign(row, b); return single ? json(row || null) : json(row ? [row] : []); }
  }
  log('WRITE', m, table, url.search.slice(0,80));
  return route.fulfill({ status: 204, body: '' });
});

if (SCENARIO === 'page') {
  await page.goto(BASE + '/co/tok_aaaaaaaaaaaaaaaaaaaa');
  await page.waitForTimeout(2000);
  log('page shows total:', (await page.getByText('$157.07').count()) > 0 ? 'PASS' : 'FAIL');
  await page.getByPlaceholder('Your full name').fill('Pat Customer');
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Approve & Sign' }).click();
  await page.waitForTimeout(1500);
  const sub = apiCalls.find(c => c.path === '/api/submit-signature');
  log('submitted name + signature:', sub && sub.body.name === 'Pat Customer' && /^data:image\/png/.test(sub.body.signatureData) ? 'PASS' : 'FAIL');
  log('page shows approved:', (await page.getByText(/Approved .*Thank you/).count()) > 0 ? 'PASS' : 'FAIL');
} else {
  await page.goto(BASE + '/');
  await page.waitForTimeout(2500);
  await page.getByText('Invoices', { exact: false }).first().click().catch(()=>{});
  await page.waitForTimeout(800);
  if (SCENARIO === 'landed') {
    // Approved after the app loaded its copy of INV1300.
    const at = new Date(Date.now() + 1000).toISOString();
    db.change_orders.push({ id: 'coX', invoice_id: 'INV1300', seq: 1, status: 'approved', items: [{ name: 'Add shutoff valve', desc: '3/4 inch', qty: 1, price: 150, taxable: true }], approved_at: at, applied_at: at, approved_via: 'sms', view_token: 'tok_x' });
  }
  await page.getByText('INV1300').first().click({ force: true });
  await page.waitForTimeout(2500);
  log('card shown:', (await page.getByText('Change orders', { exact: true }).count()) > 0 ? 'PASS' : 'FAIL');
  if (SCENARIO === 'send') {
    await page.getByRole('button', { name: '+ Change order' }).click();
    await page.waitForTimeout(600);
    await page.getByPlaceholder(/Work to add/).fill('Add shutoff valve');
    const nums = page.locator('input[type=number]');
    await nums.last().fill('150');
    log('phone prefilled:', (await page.getByPlaceholder('(808) 555-1234').inputValue()) === '8085551234' ? 'PASS' : 'FAIL');
    if (process.env.SHOT_EDITOR) await page.screenshot({ path: process.env.SHOT_EDITOR });
    await page.getByRole('button', { name: 'Send to customer by text' }).click();
    await page.waitForTimeout(2000);
    const co = db.change_orders[0];
    log('saved:', co && co.seq === 1 && co.items[0].name === 'Add shutoff valve' && co.items[0].price === 150 && co.view_token.length >= 16 ? 'PASS' : 'FAIL ' + JSON.stringify(co));
    const sendCall = apiCalls.find(c => c.body?.op === 'send_change_order');
    log('texted:', sendCall && sendCall.body.to === '8085551234' && sendCall.body.change_order_id === co.id ? 'PASS' : 'FAIL');
    log('confirmation shown:', (await page.getByText(/Sent to 8085551234/).count()) > 0 ? 'PASS' : 'FAIL');
  }
  if (SCENARIO === 'landed') {
    await page.waitForTimeout(2500);
    const last = saves.filter(x => x.id === 'INV1300').pop();
    log('save carries change order line:', last && last.items.some(i => /^Add shutoff valve\|Change order #1, approved .* - 3\/4 inch$/.test(i)) && last.items.length === 2 ? 'PASS' : 'FAIL ' + JSON.stringify(last));
    log('line visible in form:', (await page.getByText('Add shutoff valve').count()) > 0 ? 'PASS' : 'FAIL');
  }
}
await page.screenshot({ path: process.env.SHOT || 'change-order.png' });
await browser.close();

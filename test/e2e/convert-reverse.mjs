// Invoice -> estimate keeps the invoice and links the two (v1.51.1).
// Run like convert.mjs: node test/e2e/convert-reverse.mjs. Pass = no write deletes
// INV1174, EST1174 is saved with converted_to_id INV1174, and after a reload the
// invoice shows "<- EST1174" and the estimate "-> INV1174".
//
// Run: npm run build && npx vite preview --port 4173, then
//   SCENARIO=basic|fresh|cancel node test/e2e/convert.mjs
// Pass = two saves per conversion (pre-save, then the converted+linked one),
// never a third that writes the estimate back as an unlinked draft (v1.42.5).
// Playwright must resolve: install it locally, or set NODE_PATH to a global install.
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:4173';
const SCENARIO = process.env.SCENARIO || 'basic';   // basic | staledraft
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
db.invoices = [{ id:'INV1174', type:'invoice', client_name:'Test Client', date:'2026-11-05', status:'outstanding', converted_to_id:null, owner_id:JAKE, assigned_tech_id:JAKE, tax:4.712, discount:0, view_token:'tok9', visits:null, updated_at: now, created_at: now, deleted_at:null }];
db.invoice_items = [{ id:'i9', invoice_id:'INV1174', name:'Water heater', description:'', qty:1, price:1800, unit:'ea', taxable:true, sort_order:0 }];
const writes = [];
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
  if (url.pathname.startsWith('/api/')) return json({});
  if (url.pathname.startsWith('/auth/v1/user')) return json(user);
  if (url.pathname.startsWith('/auth/v1/')) return json(session);
  if (url.pathname.startsWith('/realtime')) return route.abort();
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  if (url.pathname === '/rest/v1/rpc/save_invoice_with_items') {
    const body = req.postDataJSON(); const inv = body.inv;
    log('RPC save', inv.id, 'status=', inv.status, 'converted_to_id=', inv.converted_to_id, 'payments=', (body.payments||[]).length);
    saves.push({ at: Date.now()-t0, id: inv.id, converted_to_id: inv.converted_to_id, status: inv.status });
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
    if (single) return rows[0] ? json(rows[0]) : json({ code:'PGRST116', message:'none' }, 406);
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range': `0-${Math.max(rows.length-1,0)}/${rows.length}` }, body: JSON.stringify(rows) });
  }
  log('WRITE', m, table, url.search.slice(0,80)); writes.push({ m, table, q: url.search, body: req.postData() });
  return route.fulfill({ status: 204, body: '' });
});

await page.goto(BASE + '/');
await page.waitForTimeout(2500);
const openDoc = async (tab, id) => {
  await page.getByText(tab, { exact: false }).first().click({ timeout: 5000 }).catch(()=>log(tab+' tab click failed'));
  await page.waitForTimeout(800);
  await page.getByText(id).first().click({ timeout: 8000, force: true }).catch(()=>log(id+' click failed'));
  await page.waitForTimeout(1800);
};
await openDoc('Invoices', 'INV1174');
const btn = page.getByRole('button', { name: /Estimate|EST1174/ }).last();
log('button text:', (await btn.innerText()).replace(/\s+/g,' '));
await btn.click();
await page.waitForTimeout(5000);
const killed = writes.filter(w => w.table.startsWith('invoices') && /INV1174/.test(w.q) && (w.m === 'DELETE' || /deleted_at/.test(w.body || '')));
log('writes deleting INV1174:', killed.length, '(want 0)');
const est = db.invoices.find(r => r.type === 'estimate');
log('new estimate:', JSON.stringify(est && { id: est.id, status: est.status, converted_to_id: est.converted_to_id }));
const inv = db.invoices.find(r => r.id === 'INV1174');
log('INV1174 still live:', !!inv && !inv.deleted_at, 'status=', inv && inv.status);
await page.reload(); await page.waitForTimeout(3500);
await openDoc('Invoices', 'INV1174');
log('after reload, INV1174 button:', (await page.getByRole('button', { name: /EST1174|Estimate/ }).last().innerText({ timeout: 3000 }).catch(()=>'?')).replace(/\s+/g,' '));
await page.getByRole('button', { name: /^Done$/ }).first().click({ timeout: 5000, force: true }).catch(()=>{});
await page.waitForTimeout(1500);
await openDoc('Estimates', 'EST1174');
log('EST1174 button:', (await page.getByRole('button', { name: /INV1174|Invoice/ }).last().innerText({ timeout: 3000 }).catch(()=>'?')).replace(/\s+/g,' '));
await page.screenshot({ path: process.env.SHOT || 'convert-reverse.png' });
await browser.close();

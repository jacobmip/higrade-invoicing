// New-document duplicate check (v1.51.2). Creating one estimate used to save two
// rows: the first save switched the form's key from new<N> to EST####, the form
// remounted, and the old form's save-on-close ran with no id and minted a second
// number. Pass = exactly one distinct document id saved.
// Run: npm run build && npx vite preview --port 4173, then
//   DOC=estimate|invoice [MINT_DELAY=2000] node test/e2e/new-doc.mjs
// MINT_DELAY slows the number allocator to mimic poor signal.
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
db.clients = [{ id:'c1', name:'Test Client', phone:'8085551234', addresses:[] }];
let nextNum = 1200;
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
    saves.push({ at: Date.now()-t0, id: inv.id, converted_to_id: inv.converted_to_id, status: inv.status, notes: inv.notes });
    await new Promise(r => setTimeout(r, saveDelayMs));
    const row = db.invoices.find(r => r.id === inv.id);
    const upd = new Date().toISOString();
    if (row) Object.assign(row, { status: inv.status, converted_to_id: inv.converted_to_id, updated_at: upd });
    else db.invoices.push({ ...inv, owner_id: JAKE, assigned_tech_id: JAKE, updated_at: upd, created_at: upd, deleted_at: null, visits: null });
    return json({ id: inv.id, updated_at: upd });
  }
  if (url.pathname === '/rest/v1/rpc/allocate_doc_number') { await new Promise(r => setTimeout(r, Number(process.env.MINT_DELAY || 250))); return json(nextNum++); }
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

const DOC = process.env.DOC || 'estimate';
await page.goto(BASE + '/');
await page.waitForTimeout(2500);
await page.getByText(DOC === 'estimate' ? 'Estimates' : 'Invoices', { exact: false }).first().click().catch(()=>{});
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'New' }).last().click();
await page.waitForTimeout(1200);
await page.getByText('Select client…').first().click();
await page.waitForTimeout(600);
await page.getByText('Test Client').last().click();
await page.waitForTimeout(900);
await page.locator('textarea').first().fill('typed while the number was pending').catch(()=>log('no textarea'));
await page.waitForTimeout(6000);
const ids = [...new Set(saves.map(s => s.id))];
log('saved ids:', JSON.stringify(ids), ids.length === 1 ? 'PASS' : 'FAIL (want 1)');
await page.getByRole('button', { name: /^Done$/ }).first().click({ timeout: 5000, force: true }).catch(()=>{});
await page.waitForTimeout(2500);
const ids2 = [...new Set(saves.map(s => s.id))];
log('after Done, saved ids:', JSON.stringify(ids2), ids2.length === 1 ? 'PASS' : 'FAIL (want 1)');
log('typed text saved:', saves.some(x => /typed while/.test(x.notes || '')) ? 'PASS' : 'FAIL');
await page.screenshot({ path: process.env.SHOT || 'new-doc.png' });
await browser.close();

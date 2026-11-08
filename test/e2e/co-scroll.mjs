// Scrolling and layout of change-order mode on a phone (v1.57.2). Prints where
// things land; PASS lines are the checks. Run like change-order.mjs.
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
db.invoice_items = Array.from({ length: 7 }, (_, k) => ({ id:'a'+k, invoice_id:'INV1300', name: k ? 'Line '+k : 'Water heater', description:'Some details for line '+k, qty:1, price:100+k, unit:'ea', taxable:true, sort_order:k }));
db.clients = [{ id:'c1', name:'Test Client', phone:'8085551234', email:'pat@example.com', addresses:[] }];
const aiPrompts = [];
db.saved_items = [{ id: 's1', name: 'Angle stop replacement', price: 95, category: 'Valves', owner_id: JAKE, taxable: true }];
db.job_photos = [{ id: 'jp1', invoice_id: 'INV1300', url: 'https://cwhgcxxszyvevjpbnnkc.supabase.co/storage/v1/object/public/job-photos/INV1300/old.jpg', type: 'before', created_at: now }];
const uploads = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFTEMZQkAmb8/wbgYdQcAAAAASUVORK5CYII=', 'base64');
const fs = await import('node:fs'); fs.writeFileSync('/tmp/claude-0/test-photo.png', PNG);
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
      const co = db.change_orders.find(c => c.id === b.change_order_id); if (co) Object.assign(co, { status: 'sent', ...(b.to ? { sent_to: b.to } : {}), ...(b.email ? { sent_email: b.email } : {}) });
      return json({ ok: true, label: 'INV1300-CO1', sent: { ...(b.email ? { email: b.email } : {}), ...(b.to ? { text: b.to } : {}) }, errors: [] });
    }
    if (url.pathname === '/api/ai') {
      aiPrompts.push(b);
      if (b?.mode === 'agent') {
        const n = aiPrompts.filter(x => x.mode === 'agent').length;
        if (n === 1 && SCENARIO === 'globalco') return json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'draft_change_order', input: { document_id: 'INV1300', items: [{ name: 'Replace angle stop', qty: 1, price: 95 }], send: 'auto' } }] });
        if (n === 1) return json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'send_sms', input: { phone: '8085551234', message: 'Aloha Pat, just checking in on the water heater. Mahalo!' } }] });
        return json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'The draft text is ready for you to check.' }] });
      }
      if (SCENARIO === 'aisms' || SCENARIO === 'aicancel') return json({ content: [{ type: 'text', text: JSON.stringify({ action: 'send_sms', phone: '8085551234', message: 'Aloha Pat, the valve is in. Mahalo!', summary: 'Texted Pat' }) }] });
      if (SCENARIO === 'modeai') return json({ content: [{ type: 'text', text: JSON.stringify({ action: 'add_items', invoiceId: 'INV1300', items: [{ name: 'Pressure regulator', desc: 'PRV 3/4', qty: 1, price: 310 }], summary: 'Added a PRV' }) }] });
      if (SCENARIO === 'ghost') {
        const n = aiPrompts.filter(x => !x.mode).length;
        return json({ content: [{ type: 'text', text: n === 1 ? "I've drafted up a change order for the two angle stops. Let me know when to send it." : JSON.stringify({ action: 'create_change_order', items: [{ name: 'Replace angle stop', qty: 2, price: 95 }], send: 'none', summary: 'Drafted CO' }) }] });
      }
      if (SCENARIO === 'aiemail') return json({ content: [{ type: 'text', text: JSON.stringify({ action: 'send_email', invoiceId: 'INV1300', summary: 'Emailing the invoice' }) }] });
      const text = SCENARIO === 'ai' || SCENARIO === 'aiphoto'
        ? JSON.stringify({ action: 'create_change_order', items: [{ name: 'Replace angle stop', desc: 'Corroded, leaking', qty: 2, price: 95, taxable: true }], note: 'Found behind the vanity', send: 'auto', summary: 'Created and sent CO1' })
        : 'INV1300 has one line: the water heater at $1,800.';
      return json({ content: [{ type: 'text', text }] });
    }
    if (url.pathname === '/api/sms-inbound' && b?.op === 'preview_change_order') {
      return json({ ok: true, label: 'INV1300-CO1', text: 'HI Grade Plumbing: change order 1 for your job.\nReply YES to approve', email: { subject: 'Change order 1 for your job: please review', html: '<p>PREVIEW-EMAIL-BODY</p>' } });
    }
    if (url.pathname === '/api/public-invoice' && url.searchParams.get('co')) {
      return json({ changeOrder: { seq: 1, label: 'INV1300-CO1', status: coState, photos: [{ url: 'https://cwhgcxxszyvevjpbnnkc.supabase.co/storage/v1/object/public/job-photos/INV1300/old.jpg' }], items: [{ name: 'Add shutoff valve', desc: '3/4 inch', qty: 1, price: 150 }], note: 'Found during repair', totals: { subtotal: 150, tax: 7.07, total: 157.07 }, approved_at: coState === 'approved' ? new Date().toISOString() : null, approved_name: 'Pat Customer' },
        job: { invoice_id: 'INV1300', client_name: 'Test Client', job_address: { line1: '1 Main St', city: 'Honolulu' }, tax: 4.712 } });
    }
    if (url.pathname === '/api/submit-signature' && b?.coToken) { coState = 'approved'; return json({ ok: true, label: 'INV1300-CO1' }); }
    return json({});
  }
  if (url.pathname.startsWith('/storage/v1/object/job-photos/')) { uploads.push(url.pathname); return json({ Key: url.pathname }); }
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
    if (invEq && invEq.startsWith('in.(')) { const ids = invEq.slice(4, -1).split(','); rows = rows.filter(r => ids.includes(r.invoice_id)); }
    if (table === 'invoices' && /invoice_items/.test(url.searchParams.get('select') || '')) rows = rows.map(r => ({ ...r, invoice_items: db.invoice_items.filter(i => i.invoice_id === r.id), payments: [] }));
    if (single) return rows[0] ? json(rows[0]) : json({ code:'PGRST116', message:'none' }, 406);
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range': `0-${Math.max(rows.length-1,0)}/${rows.length}` }, body: JSON.stringify(rows) });
  }
  if (table === 'job_photos' && m === 'POST') { const b = JSON.parse(req.postData()); const row = { id: 'jp' + (db.job_photos.length + 1), created_at: new Date().toISOString(), ...b }; db.job_photos.push(row); return json(single ? row : [row], 201); }
  if (table === 'change_orders') {
    const b = req.postData() ? JSON.parse(req.postData()) : {};
    if (m === 'POST') { const row = { id: 'co' + (db.change_orders.length + 1), created_at: new Date().toISOString(), ...b }; db.change_orders.push(row); return json(single ? row : [row], 201); }
    if (m === 'PATCH') { const idq = url.searchParams.get('id'); const row = db.change_orders.find(c => 'eq.' + c.id === idq); if (row) Object.assign(row, b); return single ? json(row || null) : json(row ? [row] : []); }
  }
  log('WRITE', m, table, url.search.slice(0,80));
  return route.fulfill({ status: 204, body: '' });
});


const geo = () => page.evaluate(() => {
  const sticky = [...document.querySelectorAll('div')].find(d => d.style.position === 'sticky' && d.style.top === '0px' && d.textContent.includes('INV1300'));
  const find = (t) => [...document.querySelectorAll('div,span,button')].filter(e => e.offsetParent && e.textContent.trim().startsWith(t)).pop();
  const r = (e) => e ? Math.round(e.getBoundingClientRect().top) : null;
  return { scrollY: Math.round(window.scrollY), vh: innerHeight, headerBottom: sticky ? Math.round(sticky.getBoundingClientRect().bottom) : null,
    banner: r(find('Building change order')), card: r(find('Change orders')), lastCo: (() => { const rows = [...document.querySelectorAll('div')].filter(d => d.offsetParent && d.textContent.trim().startsWith('Angle stop replacement')); const e = rows.pop(); return e ? Math.round(e.getBoundingClientRect().bottom) : null; })() };
});
await page.goto(BASE + '/');
await page.waitForTimeout(2500);
await page.getByText('Invoices', { exact: false }).first().click().catch(()=>{});
await page.waitForTimeout(800);
await page.getByText('INV1300').first().click({ force: true });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: '+ Change order' }).scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 100));
await page.waitForTimeout(400);
log('scrollers', JSON.stringify(await page.evaluate(() => { const out = []; let e = [...document.querySelectorAll('button')].find(b => b.textContent.includes('+ Change order')); while (e) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY)) out.push({ tag: e.tagName, sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop, cls: e.className, style: (e.getAttribute('style')||'').slice(0,120) }); e = e.parentElement; } return out; })));
// Price Book opened while scrolled down must appear on screen.
await page.getByRole('button', { name: 'Price Book' }).dispatchEvent('click');
await page.waitForTimeout(600);
const pbTop = await page.evaluate(() => { const h = [...document.querySelectorAll('div,span')].find(d => d.offsetParent && d.textContent.trim() === 'Price Book' && getComputedStyle(d).fontSize !== '12px'); const inp = document.querySelector('input[placeholder="Search items…"]'); return inp ? Math.round(inp.getBoundingClientRect().top) : null; });
log('price book opens on screen when scrolled:', pbTop !== null && pbTop > 0 && pbTop < 844 ? 'PASS' : 'FAIL ' + pbTop);
if (process.env.SHOT0) await page.screenshot({ path: process.env.SHOT0 });
await page.getByRole('button', { name: 'Price Book' }).first().dispatchEvent('click'); // the toggle closes it
await page.waitForTimeout(400);
log('before start', JSON.stringify(await geo()));
await page.getByRole('button', { name: '+ Change order' }).click();
await page.waitForTimeout(1500);
let g = await geo();
log('after start', JSON.stringify(g));
log('banner fully visible below the sticky header:', g.banner !== null && g.banner >= g.headerBottom && g.banner < g.vh - 150 ? 'PASS' : 'FAIL');
if (process.env.SHOT1) await page.screenshot({ path: process.env.SHOT1 });
for (let k = 0; k < 8; k++) {
  // dispatchEvent: a tap, without Playwright's scroll-into-view first (that
  // scroll is what nudged the tab carousel sideways before the guard).
  await page.getByRole('button', { name: 'Price Book' }).dispatchEvent('click');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Add Angle stop replacement' }).dispatchEvent('click');
  await page.waitForTimeout(900);
  g = await geo();
  const bt = await page.evaluate(() => { const b = document.querySelector('[aria-label="Change order actions"]'); return b ? Math.round(b.getBoundingClientRect().top) : null; });
  const sl = await page.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.scrollLeft > 0).map(d => d.scrollLeft + ':' + (d.getAttribute('style') || '').slice(0, 60)));
  log('form not shifted sideways:', sl.length ? 'FAIL ' + JSON.stringify(sl) : 'PASS');
  log('after add ' + (k + 1), JSON.stringify(g), 'bar', bt, g.lastCo !== null && g.lastCo <= bt && g.lastCo > g.headerBottom ? 'line clear: PASS' : 'line clear: FAIL');
}
const barTop = await page.evaluate(() => { const b = document.querySelector('[aria-label="Change order actions"]'); return b ? Math.round(b.getBoundingClientRect().top) : null; });
log('bottom bar shown:', barTop !== null && barTop > g.vh - 120 ? 'PASS' : 'FAIL ' + barTop);
log('newest line visible above the bar:', g.lastCo !== null && g.lastCo <= (barTop ?? g.vh) && g.lastCo > g.headerBottom ? 'PASS' : 'FAIL ' + g.lastCo + ' bar ' + barTop);
log('total in the bar:', (await page.getByRole('region', { name: 'Change order actions' }).getByText('$795.81').count()) === 1 ? 'PASS' : 'FAIL');
if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Review & send' }).dispatchEvent('click');
await page.waitForTimeout(900);
const sheetTop = await page.evaluate(() => { const h = [...document.querySelectorAll('div')].find(d => d.offsetParent && d.textContent.trim().startsWith('Review change order')); return h ? Math.round(h.getBoundingClientRect().top) : null; });
log('review sheet opens on screen:', sheetTop !== null && sheetTop >= 0 && sheetTop < 120 ? 'PASS' : 'FAIL ' + sheetTop);
const panelTop = () => page.evaluate(() => { const p = [...document.querySelectorAll('div')].find(d => d.style.position === 'fixed' && /auto|hidden/.test(d.style.overflowY) && d.style.zIndex === '1200'); return p ? p.scrollTop : -1; });
const before = await panelTop();
await page.mouse.move(195, 600); await page.mouse.wheel(0, 600); await page.waitForTimeout(500);
const after = await panelTop();
log('page behind the sheet does not scroll:', before === after ? 'PASS' : `FAIL ${before} -> ${after}`);
if (process.env.SHOT3) await page.screenshot({ path: process.env.SHOT3 });
await page.getByRole('button', { name: 'Close' }).last().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Done for now' }).click();
await page.waitForTimeout(1500);
g = await geo();
log('after done', JSON.stringify(g));
log('lands on the change orders card:', g.card !== null && g.card >= g.headerBottom - 5 && g.card < g.vh - 120 ? 'PASS' : 'FAIL');
if (process.env.SHOT4) await page.screenshot({ path: process.env.SHOT4 });
await browser.close();

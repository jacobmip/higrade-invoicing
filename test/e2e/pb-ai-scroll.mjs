// Price Book and the invoice AI chat on a phone (v1.57.4): where they open on a
// scrolled invoice, with a fake keyboard, and whether scrolling them drags the
// invoice behind. PASS lines are the checks. Run like co-scroll.mjs.
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
db.invoice_items = Array.from({ length: 18 }, (_, k) => ({ id:'a'+k, invoice_id:'INV1300', name: k ? 'Line '+k : 'Water heater', description:'Some details for line '+k, qty:1, price:100+k, unit:'ea', taxable:true, sort_order:k }));
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
  // Fake keyboard: window.__kb(px) shrinks the visual viewport like iOS does.
  let kb = 0; const vv = new EventTarget();
  Object.defineProperties(vv, { height: { get: () => innerHeight - kb }, width: { get: () => innerWidth }, offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 } });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  window.__kb = (px) => { kb = px; vv.dispatchEvent(new Event('resize')); };
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

const VH = 844, KB = 340;
const panel = () => page.evaluate(() => { const p = [...document.querySelectorAll('div')].find(d => d.style.position === 'fixed' && d.style.zIndex === '1200'); return p ? Math.round(p.scrollTop) : -1; });
const toBottom = () => page.evaluate(() => { const p = [...document.querySelectorAll('div')].find(d => d.style.position === 'fixed' && d.style.zIndex === '1200'); p.scrollTop = 1e6; });
const headerBottom = () => page.evaluate(() => { const s = [...document.querySelectorAll('div')].find(d => d.style.position === 'sticky' && d.style.top === '0px' && d.textContent.includes('INV1300')); return s ? Math.round(s.getBoundingClientRect().bottom) : 0; });
let fails = 0; const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name, extra); };

await page.goto(BASE + '/');
await page.waitForTimeout(2500);
await page.getByText('INV1300').first().click({ force: true });
await page.waitForTimeout(2500);

// ── Price Book on a scrolled invoice ──
await toBottom(); await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Price Book' }).dispatchEvent('click');
await page.waitForTimeout(600);
const sheet = () => page.evaluate(() => { const i = document.querySelector('input[placeholder="Search items…"]'); let s = i; while (s && !(s.style.borderRadius || '').startsWith('18px')) s = s.parentElement; const ov = s?.parentElement; const r = s?.getBoundingClientRect(), o = ov?.getBoundingClientRect(); return s ? { top: Math.round(r.top), bottom: Math.round(r.bottom), ovTop: Math.round(o.top), ovBottom: Math.round(o.bottom), inBody: ov.parentElement === document.body } : null; });
let s1 = await sheet();
check('price book: sheet sits on the bottom of the screen and covers it', s1 && s1.ovTop === 0 && Math.abs(s1.bottom - VH) <= 2 && s1.top > 0, JSON.stringify(s1));
await page.evaluate(k => window.__kb(k), KB); await page.waitForTimeout(400);
s1 = await sheet();
check('price book: with the keyboard up the sheet sits above it', s1 && s1.bottom <= VH - KB + 2 && s1.top >= 0, JSON.stringify(s1));
await page.evaluate(() => window.__kb(0)); await page.waitForTimeout(300);
let p0 = await panel();
await page.mouse.move(195, 700); for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -800); await page.waitForTimeout(150); }
await page.waitForTimeout(400);
check('price book: scrolling its list does not move the invoice', (await panel()) === p0, `${p0} -> ${await panel()}`);
p0 = await panel();
await page.mouse.move(195, 20); await page.mouse.wheel(0, -800); await page.waitForTimeout(400);
check('price book: scrolling the dimmed backdrop does not move the invoice', (await panel()) === p0, `${p0} -> ${await panel()}`);
await page.getByRole('button', { name: 'Add Angle stop replacement' }).dispatchEvent('click');
await page.waitForTimeout(700);
check('price book: adding a line still works', await page.getByText('Angle stop replacement').count() > 0);

// ── Invoice AI chat ──
await page.evaluate(() => { const p = [...document.querySelectorAll('div')].find(d => d.style.position === 'fixed' && d.style.zIndex === '1200'); p.scrollTop = 0; });
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'AI', exact: true }).dispatchEvent('click');
await page.waitForTimeout(100);
await page.evaluate(k => window.__kb(k), KB);
await page.waitForTimeout(1200);
const inp = () => page.evaluate(() => { const e = document.querySelector('[aria-label="Job description"]'); const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), focused: document.activeElement === e }; });
let a = await inp(); const hb = await headerBottom();
check('ai chat: typing box just above the keyboard', a.bottom <= VH - KB && a.bottom >= VH - KB - 90 && a.top > hb, JSON.stringify({ ...a, hb }));
const msgsTop = await page.evaluate(() => { const e = document.querySelector('[aria-label="Job description"]'); let p = e; while (p && !p.querySelector(':scope > [style*="absolute"]')) p = p.parentElement; return p ? Math.round(p.getBoundingClientRect().top) : null; });
check('ai chat: top of the chat box is not hidden under the header', msgsTop !== null && msgsTop >= hb - 2, JSON.stringify({ msgsTop, hb }));
p0 = await panel();
const box = await page.evaluate(() => { const e = document.querySelector('[aria-label="Job description"]'); let p = e; while (p && !p.querySelector(':scope > [style*="absolute"]')) p = p.parentElement; const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60 }; });
await page.mouse.move(box.x, box.y); for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(150); }
await page.waitForTimeout(400);
check('ai chat: scrolling the messages does not move the invoice', (await panel()) === p0, `${p0} -> ${await panel()}`);
await page.evaluate(() => window.__kb(0)); await page.waitForTimeout(300);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);

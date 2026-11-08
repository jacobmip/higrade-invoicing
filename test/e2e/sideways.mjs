// Sideways overflow audit (v1.57.3): on each main screen at phone width, nothing may be
// scrollable sideways (except deliberate horizontal strips) and nothing may be scrolled sideways.
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



const audit = (label) => page.evaluate((label) => {
  const out = [];
  const doc = document.scrollingElement;
  if (doc.scrollWidth > doc.clientWidth + 1) out.push({ el: 'document', sw: doc.scrollWidth, cw: doc.clientWidth });
  for (const e of document.querySelectorAll('*')) {
    if (!e.offsetParent && e !== document.body) continue;
    const cs = getComputedStyle(e);
    const canX = /(auto|scroll)/.test(cs.overflowX);
    if (e.scrollLeft > 0) out.push({ el: 'SCROLLED', sl: e.scrollLeft, style: (e.getAttribute('style') || '').slice(0, 90) });
    if (canX && e.scrollWidth > e.clientWidth + 1) out.push({ el: e.tagName, sw: e.scrollWidth, cw: e.clientWidth, ox: cs.overflowX, style: (e.getAttribute('style') || '').slice(0, 90), txt: e.textContent.trim().slice(0, 40) });
  }
  return { label, out };
}, label);
const show = async (label) => { const r = await audit(label); log(label, r.out.length ? 'ISSUES ' + JSON.stringify(r.out) : 'clean'); };
const listTrack = () => page.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.offsetParent && d.style.scrollSnapType); return el ? { sl: Math.round(el.scrollLeft), w: el.clientWidth } : null; });
const aligned = (t) => t && t.w > 0 && Math.abs(t.sl - Math.round(t.sl / t.w) * t.w) <= 1;
await page.goto(BASE + '/');
await page.waitForTimeout(2500);
await show('invoice list');
// Native snapping is switched off on the track for these checks: Chromium
// always finishes a snap, iOS Safari sometimes does not, so only the app's own
// guard (useSnapCarousel) may fix the position.
// 1. A swipe that stops between two tabs: it must settle exactly on a tab.
await page.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.offsetParent && d.style.scrollSnapType); el.style.scrollSnapType = 'none'; el.scrollLeft = el.clientWidth * 1.4; el.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(900);
let t = await listTrack();
log('list settles on a tab after a half swipe:', aligned(t) ? 'PASS' : 'FAIL ' + JSON.stringify(t));
// 1b. Stopped a little off the tab it is already on (no tab change to trigger a re-scroll).
await page.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.offsetParent && d.style.scrollSnapType); el.scrollLeft = el.clientWidth * 1.2; el.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(900);
t = await listTrack();
log('list squares up when left slightly off its own tab:', aligned(t) && Math.round(t.sl / t.w) === 1 ? 'PASS' : 'FAIL ' + JSON.stringify(t));
// 2. The screen width changes (rotation, split view): stays on its tab.
await page.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.offsetParent && d.style.scrollSnapType); el.style.scrollSnapType = 'none'; el.scrollLeft = el.clientWidth * 2; el.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(700);
await page.setViewportSize({ width: 430, height: 844 });
await page.waitForTimeout(700);
t = await listTrack();
log('list stays on its tab after a width change:', aligned(t) && Math.round(t.sl / t.w) === 2 ? 'PASS' : 'FAIL ' + JSON.stringify(t));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
t = await listTrack();
log('and back:', aligned(t) && Math.round(t.sl / t.w) === 2 ? 'PASS' : 'FAIL ' + JSON.stringify(t));
// 4. Tapping a tab three over (native snap back on, as on a phone): lands on it.
await page.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.offsetParent && d.style.scrollSnapType); el.style.scrollSnapType = 'x mandatory'; });
await page.getByRole('button', { name: 'all', exact: true }).first().dispatchEvent('click', {}, { timeout: 3000 }).catch(()=>{});
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'paid', exact: true }).first().dispatchEvent('click', {}, { timeout: 3000 }).catch(()=>{});
await page.waitForTimeout(1500);
t = await listTrack();
log('tapping Paid from All lands on Paid:', aligned(t) && Math.round(t.sl / t.w) === 3 ? 'PASS' : 'FAIL ' + JSON.stringify(t));
await page.getByText('All', { exact: true }).first().dispatchEvent('click').catch(()=>{});
await page.waitForTimeout(800);
await page.getByText('Estimates', { exact: false }).first().click().catch(()=>{}); await page.waitForTimeout(700); await show('estimates list');
await page.evaluate(() => { const el = [...document.querySelectorAll('div')].find(d => d.offsetParent && d.style.scrollSnapType); el.style.scrollSnapType = 'none'; el.scrollLeft = el.clientWidth * 0.6; el.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(900);
t = await listTrack();
log('estimates settle on a tab after a half swipe:', aligned(t) ? 'PASS' : 'FAIL ' + JSON.stringify(t));
await page.getByText('Invoices', { exact: false }).first().click().catch(()=>{}); await page.waitForTimeout(700);
await page.getByText('INV1300').first().click({ force: true }); await page.waitForTimeout(2500);
await show('invoice edit');
// 3. Invoice tabs after a width change: the Edit tab must still fill the screen.
const editLeft = () => page.evaluate(() => { const e = [...document.querySelectorAll('span')].find(s => s.offsetParent && s.textContent.trim() === 'Line Items'); return e ? Math.round(e.getBoundingClientRect().left) : null; });
const l0 = await editLeft();
await page.setViewportSize({ width: 430, height: 844 }); await page.waitForTimeout(800);
const l1 = await editLeft();
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800);
const l2 = await editLeft();
log('invoice Edit tab stays lined up through width changes:', l0 !== null && l0 === l2 && l1 !== null && l1 >= 0 && l1 < 60 ? 'PASS' : `FAIL ${l0} ${l1} ${l2}`);
await browser.close();

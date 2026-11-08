// The invoice AI chat and the Price Book with the keyboard up, the many ways a
// phone reports it (v1.57.5): slow, late, Safari panning the page, the app's
// webview shrinking; from several invoice scroll positions. PASS lines are the checks. Run like co-scroll.mjs.
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
  // Fake keyboard. window.__kb(px, { off, silent }) shrinks the visual viewport
  // like iOS does; off pans it (Safari scrolling the page to the caret), silent
  // changes it without firing an event (a late report). window.scrollTo(0, 0)
  // undoes the pan, as it does in Safari.
  let kb = 0, off = 0; const vv = new EventTarget();
  Object.defineProperties(vv, { height: { get: () => innerHeight - kb }, width: { get: () => innerWidth }, offsetTop: { get: () => off }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 } });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  window.__kb = (px, o = {}) => { kb = px; off = o.off || 0; if (!o.silent) { vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')); } };
  const st = window.scrollTo.bind(window);
  window.scrollTo = (...a) => { const y = typeof a[0] === 'object' ? a[0].top : a[1]; if (!y && off) { off = 0; vv.dispatchEvent(new Event('scroll')); } return st(...a); };
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
const panelEl = 'document.querySelector("[data-form-panel]") || [...document.querySelectorAll("div")].find(d => d.style.position === "fixed" && d.style.zIndex === "1200")';
const setPanel = (y) => page.evaluate(`(${panelEl}).scrollTop = ${y}`);
const panelMax = () => page.evaluate(`(() => { const p = ${panelEl}; return p.scrollHeight - p.clientHeight; })()`);
const headerBottom = () => page.evaluate(() => { const s = [...document.querySelectorAll('div')].find(d => d.style.position === 'sticky' && d.style.top === '0px' && d.textContent.includes('INV1300')); return s ? Math.round(s.getBoundingClientRect().bottom) : 0; });
let fails = 0; const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name, extra); };

await page.goto(BASE + '/');
await page.waitForTimeout(2500);
await page.getByText('INV1300').first().click({ force: true });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'AI', exact: true }).dispatchEvent('click');
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[aria-label="Job description"]').blur());
const chatState = () => page.evaluate(() => {
  const e = document.querySelector('[aria-label="Job description"]'); let p = e; while (p && !p.querySelector(':scope > [style*="absolute"]')) p = p.parentElement;
  const vv = window.visualViewport; const r = e.getBoundingClientRect(), pr = p.getBoundingClientRect();
  return { inTop: Math.round(r.top), inBottom: Math.round(r.bottom), chatTop: Math.round(pr.top), chatBottom: Math.round(pr.bottom), vTop: vv.offsetTop, vBottom: vv.offsetTop + vv.height, focused: document.activeElement === e };
});
const MAX = await panelMax();
// Keyboard styles: how the keyboard's arrival is reported.
const styles = {
  normal:  async () => { await page.evaluate(k => window.__kb(k), KB); },
  slow:    async () => { await page.evaluate(() => window.__kb(120)); await page.waitForTimeout(150); await page.evaluate(k => window.__kb(k), KB); },
  late:    async () => { await page.waitForTimeout(500); await page.evaluate(k => window.__kb(k, { silent: true }), KB); },
  pan:     async () => { await page.evaluate(k => window.__kb(k, { off: 180 }), KB); },
  webview: async () => { await page.setViewportSize({ width: 390, height: VH - KB }); },
};
for (const [style, kbUp] of Object.entries(styles)) {
  for (const start of [0, Math.round(MAX / 2), MAX]) {
    await setPanel(start); await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('[aria-label="Job description"]').focus());
    await kbUp();
    await page.waitForTimeout(1300);
    const s = await chatState(); const hb = await headerBottom();
    const visTop = Math.max(hb, s.vTop);
    const ok = s.focused && s.inBottom <= s.vBottom && s.inBottom >= s.vBottom - 90 && s.chatTop >= visTop - 2 && s.chatBottom - s.chatTop >= 200;
    check(`ai chat [${style}, from ${start}]: whole chat between header and keyboard`, ok, JSON.stringify({ ...s, hb }));
    // Keyboard down: chat back to full size.
    await page.evaluate(() => document.querySelector('[aria-label="Job description"]').blur());
    if (style === 'webview') await page.setViewportSize({ width: 390, height: VH });
    await page.evaluate(() => window.__kb(0)); await page.waitForTimeout(400);
    const h = await page.evaluate(() => { const e = document.querySelector('[aria-label="Job description"]'); let p = e; while (p && !p.querySelector(':scope > [style*="absolute"]')) p = p.parentElement; return Math.round(p.getBoundingClientRect().height); });
    check(`ai chat [${style}, from ${start}]: full size again after the keyboard goes`, h >= 395, h);
  }
}
await page.getByRole('button', { name: 'AI', exact: true }).dispatchEvent('click');
await page.waitForTimeout(300);

// ── Price Book: the top stays put whatever the search finds ──
const sheet = () => page.evaluate(() => { const i = document.querySelector('input[placeholder="Search items…"]'); let s = i; while (s && !(s.style.borderRadius || '').startsWith('18px')) s = s.parentElement; const vv = window.visualViewport; return s ? { top: Math.round(s.getBoundingClientRect().top), bottom: Math.round(s.getBoundingClientRect().bottom), inTop: Math.round(i.getBoundingClientRect().top), vTop: vv.offsetTop, vBottom: vv.offsetTop + vv.height } : null; });
for (const [style, kbUp] of Object.entries(styles)) {
  await setPanel(MAX); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Price Book' }).dispatchEvent('click');
  await page.waitForTimeout(400);
  const full = await sheet();
  check(`price book [${style}]: opens tall, search box near the top`, full && full.top < VH * 0.3 && Math.abs(full.bottom - VH) <= 2, JSON.stringify(full));
  await kbUp(); await page.waitForTimeout(1300);
  const up = await sheet();
  check(`price book [${style}]: keyboard up, sheet fills the space above it`, up && up.bottom <= up.vBottom + 2 && up.bottom >= up.vBottom - 2 && up.inTop >= up.vTop && up.top < up.vTop + (up.vBottom - up.vTop) * 0.3, JSON.stringify(up));
  await page.locator('input[placeholder="Search items…"]').fill('zzzz');
  await page.waitForTimeout(300);
  const none = await sheet();
  check(`price book [${style}]: no results, the top does not drop`, none && Math.abs(none.top - up.top) <= 2, JSON.stringify(none));
  await page.locator('input[placeholder="Search items…"]').fill('angle');
  await page.waitForTimeout(300);
  const one = await sheet();
  check(`price book [${style}]: one result, the top does not drop`, one && Math.abs(one.top - up.top) <= 2, JSON.stringify(one));
  if (style === 'webview') await page.setViewportSize({ width: 390, height: VH });
  await page.evaluate(() => window.__kb(0)); await page.waitForTimeout(300);
  await page.mouse.click(195, 10); await page.waitForTimeout(400);
}
log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);

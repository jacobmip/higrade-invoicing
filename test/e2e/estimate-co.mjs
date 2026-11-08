// Change orders on the estimate and the job dates (v1.58.0), in the built app
// against a fake Supabase. EST1300 converted into INV1300; CO1 approved, CO2
// awaiting approval. PASS lines are the checks. Run like change-order.mjs.
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
db.invoices = [
  { id:'EST1300', type:'estimate', client_name:'Test Client', date:'2026-11-01', status:'converted', converted_to_id:'INV1300', signed_at:'2026-11-03T20:00:00Z', owner_id:JAKE, assigned_tech_id:JAKE, tax:4.712, discount:0, notes:'', view_token:'tE', visits:null, updated_at: now, created_at: now, deleted_at:null },
  { id:'INV1300', type:'invoice', client_name:'Test Client', date:'2026-11-03', due_date:'2026-11-03', status:'outstanding', converted_to_id:null, owner_id:JAKE, assigned_tech_id:JAKE, tax:4.712, discount:0, notes:'', view_token:'t2', visits:[{ id:'v1', start:'2026-11-05T09:00', minutes:120, kind:'job' }], updated_at: now, created_at: now, deleted_at:null },
  { id:'EST1301', type:'estimate', client_name:'Test Client', date:'2026-11-07', status:'draft', converted_to_id:null, owner_id:JAKE, assigned_tech_id:JAKE, tax:4.712, discount:0, notes:'', view_token:'tF', visits:null, updated_at: now, created_at: now, deleted_at:null },
];
db.invoice_items = [
  { id:'e1', invoice_id:'EST1300', name:'Water heater', description:'40 gal', qty:1, price:1800, unit:'ea', taxable:true, sort_order:0 },
  { id:'i1', invoice_id:'INV1300', name:'Water heater', description:'40 gal', qty:1, price:1800, unit:'ea', taxable:true, sort_order:0 },
  { id:'i2', invoice_id:'INV1300', name:'Add shutoff valve', description:'Change order #1, approved Nov 6 - 3/4 inch', qty:1, price:150, unit:'ea', taxable:true, sort_order:1 },
  { id:'f1', invoice_id:'EST1301', name:'Drain clear', description:'', qty:1, price:250, unit:'ea', taxable:true, sort_order:0 },
];
db.invoice_events = [{ id:'ev1', invoice_id:'EST1300', kind:'sent', created_at:'2026-11-02T01:00:00Z' }];
db.clients = [{ id:'c1', name:'Test Client', phone:'8085551234', email:'pat@example.com', addresses:[] }];
const aiPrompts = [];
db.saved_items = [{ id: 's1', name: 'Angle stop replacement', price: 95, category: 'Valves', owner_id: JAKE, taxable: true }];
db.job_photos = [{ id: 'jp1', invoice_id: 'INV1300', url: 'https://cwhgcxxszyvevjpbnnkc.supabase.co/storage/v1/object/public/job-photos/INV1300/old.jpg', type: 'before', created_at: now }];
const uploads = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFTEMZQkAmb8/wbgYdQcAAAAASUVORK5CYII=', 'base64');
const fs = await import('node:fs'); fs.writeFileSync('/tmp/claude-0/test-photo.png', PNG);
db.change_orders = [{ id:'co1', invoice_id:'INV1300', seq:1, status:'approved', view_token:'tok_aaaaaaaaaaaaaaaa', items:[{ name:'Add shutoff valve', desc:'3/4 inch', qty:1, price:150 }], approved_at:'2026-11-06T22:00:00Z', approved_via:'signature', approved_name:'Pat Customer', applied_at:'2026-11-06T22:00:01Z' }, { id:'co2', invoice_id:'INV1300', seq:2, status:'sent', view_token:'tok_bbbbbbbbbbbbbbbb', items:[{ name:'Pressure valve', qty:1, price:300 }], sent_at:'2026-11-07T22:00:00Z', sent_email:'pat@example.com' }];
const patches = [];
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
    if (url.pathname === '/api/public-invoice' && url.searchParams.get('token') === 'tE') {
      const inv = db.invoices[0]; return json({ invoice: { ...inv, due_date: null }, items: db.invoice_items.filter(i => i.invoice_id === 'EST1300'), payments: [], photos: [], dates: { sentAt: '2026-11-02T01:00:00Z', signedAt: inv.signed_at, jobStartedOn: null, jobCompletedOn: null }, changeOrders: [db.change_orders[0]], coJobId: 'INV1300' });
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
  if (m === 'PATCH' && table === 'invoices') { const b = JSON.parse(req.postData() || '{}'); patches.push({ q: url.search, b }); if (SCENARIO === 'nomigration' && ('job_completed_on' in b || 'job_started_on' in b)) return json({ code: '42703', message: 'column "job_completed_on" of relation "invoices" does not exist' }, 400); const row = db.invoices.find(r => 'eq.' + r.id === url.searchParams.get('id')); if (row) Object.assign(row, b); return json([]); }
  log('WRITE', m, table, url.search.slice(0,80));
  return route.fulfill({ status: 204, body: '' });
});


let fails = 0; const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name, extra); };
const text = () => page.evaluate(() => document.body.innerText);
const open = async (id) => {
  await page.goto(BASE + '/'); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: id.startsWith('EST') ? /^Estimates/ : /^Invoices/ }).first().click().catch(() => {}); await page.waitForTimeout(800);
  await page.getByText(id).first().click({ force: true }); await page.waitForTimeout(2500);
};
const tab = async (name) => { await page.getByRole('button', { name, exact: true }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };

if (SCENARIO === 'send' || SCENARIO === 'estimate') {
  // ── The converted estimate ──
  await open('EST1300');
  let tx = await text();
  check('estimate: change orders card, shared with INV1300', /Shared with INV1300/.test(tx) && /INV1300-CO1/.test(tx) && /INV1300-CO2/.test(tx));
  check('estimate: Sent and Approved dates', /Sent 11\/01\/2026/.test(tx) && /Approved 11\/03\/2026/.test(tx), (tx.match(/Sent [^\n]*/) || [''])[0]);
  // New change order from the estimate, with a Price Book line.
  await page.getByRole('button', { name: '+ Change order' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Price Book' }).dispatchEvent('click'); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Add Angle stop replacement' }).dispatchEvent('click'); await page.waitForTimeout(2500);
  // (The fake database ignores order=, so the seq it hands out is not checked here.)
  const co3 = db.change_orders.find(c => c.status === 'draft' && (c.items || []).some(i => i.name === 'Angle stop replacement'));
  check('estimate: new change order saved on INV1300 as a draft', co3 && co3.invoice_id === 'INV1300', JSON.stringify(co3 && { inv: co3.invoice_id, seq: co3.seq }));
  check('estimate: its own lines untouched', !saves.some(s => s.id === 'EST1300' && s.items.some(i => /Angle stop/.test(i))) && db.invoice_items.filter(i => i.invoice_id === 'EST1300').length === 1, JSON.stringify(saves.filter(s => s.id === 'EST1300').map(s => s.items)));
  await page.getByRole('button', { name: 'Done for now' }).click().catch(() => {}); await page.waitForTimeout(1000);
  // Preview: approved change order as an add-on, with the job total.
  await tab('Preview');
  tx = await text();
  check('estimate preview: approved CO1 listed with its lines', /Approved change orders/i.test(tx) && /INV1300-CO1/.test(tx) && /Add shutoff valve/.test(tx) && /Approved Nov 6 by Pat Customer/.test(tx));
  // 1800 + 4.712% = 1884.82; CO1 150 + 7.07 = 157.07; job 2041.89
  check('estimate preview: original, change orders and job total', /Original estimate\s*\$1,884\.82/.test(tx) && /\$157\.07/.test(tx) && /JOB TOTAL\s*\$2,041\.89/.test(tx), (tx.match(/JOB TOTAL[^\n]*\n?[^\n]*/) || [''])[0]);
  check('estimate preview: CO2 awaiting approval, not in the total', /CO2 · \$314\.14 · awaiting/.test(tx));
  check('estimate preview: Sent and Approved in the date strip', /SENT\s*11\/01\/2026/i.test(tx) && /APPROVED\s*11\/03\/2026/i.test(tx));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false });
}

if (SCENARIO === 'send' || SCENARIO === 'invoice' || SCENARIO === 'nomigration') {
  // ── The invoice: job dates ──
  await open('INV1300');
  let tx = await text();
  check('invoice: job date fields, start falls back to the first visit', await page.getByLabel('Job started').count() === 1 && /Blank shows the first visit, 11\/05\/2026/.test(tx));
  await page.getByLabel('Job completed').fill('2026-11-08'); await page.waitForTimeout(800);
  const p = patches.find(x => 'job_completed_on' in x.b);
  check('invoice: Job completed saved on its own', p && p.b.job_completed_on === '2026-11-08' && /INV1300/.test(p.q), JSON.stringify(p));
  if (SCENARIO === 'nomigration') {
    tx = await text();
    check('before migration 112: says so, nothing breaks', /Job dates need database update 112/.test(tx));
  } else {
    await tab('Preview');
    tx = await text();
    check('invoice preview: Job started (first visit) and Job completed', /JOB STARTED\s*11\/05\/2026/i.test(tx) && /JOB COMPLETED\s*11\/08\/2026/i.test(tx));
    check('invoice preview: no estimate add-on section', !/Original estimate/.test(tx));
  }
}

if (SCENARIO === 'send' || SCENARIO === 'draftest') {
  // ── An estimate not yet approved: no change orders ──
  await open('EST1301');
  const tx = await text();
  check('unapproved estimate: no change orders card', !/\+ Change order/.test(tx) && !/Shared with/.test(tx));
}

if (SCENARIO === 'send' || SCENARIO === 'customer') {
  // ── The customer's link for the estimate ──
  await page.goto(BASE + '/v/tE'); await page.waitForTimeout(2500);
  const tx = await text();
  check('customer estimate page: approved CO1 and job total', /INV1300-CO1/.test(tx) && /JOB TOTAL\s*\$2,041\.89/.test(tx) && !/CO2/.test(tx));
  check('customer estimate page: Sent and Approved dates', /SENT\s*11\/01\/2026/i.test(tx) && /APPROVED\s*11\/03\/2026/i.test(tx));
}
log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);

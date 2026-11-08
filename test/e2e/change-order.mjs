// Change orders (v1.53.0), driven in the built app against a fake Supabase.
//   SCENARIO=send     create a change order on INV1300 and text it
//   SCENARIO=landed   approved while the app was open: its lines reach the form and the save
//   SCENARIO=page     the customer's /co/<token> page: sign and approve
//   SCENARIO=email    the editor sends by email (client's email prefilled)
//   SCENARIO=ai       the invoice AI chat writes a change order and emails + texts it
//   SCENARIO=photos   add a new photo and pick a job photo on a change order
//   SCENARIO=aiphoto  the AI chat makes a change order from a message with a photo attached
//   SCENARIO=aisms    invoice chat text: a draft first; edited text is what gets sent
//   SCENARIO=aicancel invoice chat text: Cancel sends nothing
//   SCENARIO=aiemail  invoice chat "email the invoice" opens the send screen, sends nothing
//   SCENARIO=globalsms header AI text: a draft first, sent on Send
//   SCENARIO=mode     change-order mode on the invoice: Price Book line goes on the change order, Review & send, Send
//   SCENARIO=modeai   change-order mode: the invoice AI's add_items lands on the change order, not the invoice
//   SCENARIO=ghost    the invoice AI says it "drafted up" a change order with no action: caught and retried
//   SCENARIO=globalco header AI draft_change_order: draft card, sent only on Send
//   SCENARIO=aiplain  a plain answer in the invoice AI chat shows (was a crash before v1.54.0)
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

if (SCENARIO === 'page') {
  await page.goto(BASE + '/co/tok_aaaaaaaaaaaaaaaaaaaa');
  await page.waitForTimeout(2000);
  log('page shows total:', (await page.getByText('$157.07').count()) > 0 ? 'PASS' : 'FAIL');
  log('page shows the photo:', (await page.locator('img[alt="Photo of the work"]').count()) === 1 ? 'PASS' : 'FAIL');
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
  const sends = () => apiCalls.filter(c => c.path === '/api/sms-inbound' && c.body && (c.body.op === 'send_change_order' || (!c.body.op && c.body.body)));
  // Build a change order on the invoice from the Price Book, then open Review & send.
  const buildAndReview = async () => {
    await page.getByRole('button', { name: '+ Change order' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Price Book' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Add Angle stop replacement' }).click();
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Review & send' }).click();
    await page.waitForTimeout(800);
  };
  if (SCENARIO === 'send' || SCENARIO === 'email') {
    await buildAndReview();
    await page.getByRole('button', { name: 'Preview email and text' }).click();
    await page.waitForTimeout(1500);
    log('contact prefilled:', (await page.getByPlaceholder('customer@email.com').last().inputValue()) === 'pat@example.com' && (await page.getByPlaceholder('(808) 555-1234').last().inputValue()) === '8085551234' ? 'PASS' : 'FAIL');
    if (SCENARIO === 'send') await page.getByLabel('Email', { exact: true }).last().uncheck();
    else await page.getByLabel('Text', { exact: true }).last().uncheck();
    if (process.env.SHOT_EDITOR) await page.screenshot({ path: process.env.SHOT_EDITOR });
    await page.getByRole('button', { name: 'Send', exact: true }).last().click();
    await page.waitForTimeout(1500);
    const call = apiCalls.find(c => c.body?.op === 'send_change_order');
    if (SCENARIO === 'send') log('texted only:', call && call.body.to === '8085551234' && !call.body.email ? 'PASS' : 'FAIL ' + JSON.stringify(call?.body));
    else log('emailed only:', call && call.body.email === 'pat@example.com' && !call.body.to ? 'PASS' : 'FAIL ' + JSON.stringify(call?.body));
    log('result shown:', (await page.getByText(SCENARIO === 'send' ? /texted to 8085551234/ : /emailed to pat@example.com/).count()) > 0 ? 'PASS' : 'FAIL');
  }
  if (SCENARIO === 'photos') {
    await buildAndReview();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add photos', exact: true }).first().click()]);
    await chooser.setFiles('/tmp/claude-0/test-photo.png');
    await page.waitForTimeout(2000);
    log('new photo uploaded and filed as a job photo:', uploads.length === 1 && db.job_photos.some(p => /Change order 1/.test(p.caption || '')) ? 'PASS' : 'FAIL ' + JSON.stringify(uploads));
    await page.getByRole('button', { name: 'From job photos' }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Pick job photo' }).first().click();
    await page.getByRole('button', { name: 'Add 1 photo' }).click();
    await page.waitForTimeout(400);
    if (process.env.SHOT_EDITOR) await page.screenshot({ path: process.env.SHOT_EDITOR });
    await page.getByRole('button', { name: 'Preview email and text' }).click();
    await page.waitForTimeout(1500);
    const co = db.change_orders[0];
    log('change order saved with both photos:', co && co.photos.length === 2 && co.photos.some(p => /old\.jpg$/.test(p.url) && p.job_photo_id === 'jp1') && co.photos.some(p => /\/co1_/.test(p.url)) ? 'PASS' : 'FAIL ' + JSON.stringify(co?.photos));
  }
  if (SCENARIO === 'mode' || SCENARIO === 'modeai') {
    const whBefore = await page.getByText('Water heater', { exact: true }).count();
    await page.getByRole('button', { name: '+ Change order' }).click();
    await page.waitForTimeout(1000);
    const whAfter = await page.getByText('Water heater', { exact: true }).count();
    log('mode on, invoice lines hidden:', (await page.getByText('Building change order 1').count()) > 0 && whAfter === whBefore - 1 ? 'PASS' : 'FAIL ' + whBefore + '->' + whAfter);
    if (SCENARIO === 'mode') {
      await page.getByRole('button', { name: 'Price Book' }).click();
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: 'Add Angle stop replacement' }).click();
      await page.waitForTimeout(2000);
      const co = db.change_orders[0];
      log('price book line saved on the change order:', co && co.items.length === 1 && co.items[0].name === 'Angle stop replacement' && co.items[0].price === 95 ? 'PASS' : 'FAIL ' + JSON.stringify(co));
      log('invoice untouched:', !saves.some(x => x.items.some(i => /Angle stop/.test(i))) ? 'PASS' : 'FAIL');
      if (process.env.SHOT_MODE) { await page.getByText('Building change order 1').scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.SHOT_MODE }); }
      await page.getByRole('button', { name: 'Review & send' }).click();
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Preview email and text' }).click();
      await page.waitForTimeout(1500);
      log('preview shown, nothing sent:', (await page.getByText('Draft, not sent yet').count()) > 0 && !apiCalls.some(c => c.body?.op === 'send_change_order') ? 'PASS' : 'FAIL');
      await page.getByRole('button', { name: 'Send', exact: true }).last().click();
      await page.waitForTimeout(1500);
      log('sent on tap:', apiCalls.some(c => c.body?.op === 'send_change_order' && c.body.change_order_id === co.id) ? 'PASS' : 'FAIL');
      log('sheet shows the result:', (await page.getByText(/emailed to|texted to/).count()) > 0 ? 'PASS' : 'FAIL');
      await page.getByRole('button', { name: 'Back to the invoice' }).click();
      await page.waitForTimeout(800);
      const bc = await page.getByText('Building change order').count(), wh = await page.getByText('Water heater', { exact: true }).count();
      if (process.env.SHOT_EDITOR) await page.screenshot({ path: process.env.SHOT_EDITOR });
      log('mode off after send, invoice lines back:', bc === 0 && wh === whBefore ? 'PASS' : 'FAIL ' + bc + ' ' + wh + '/' + whBefore);
    } else {
      await page.getByRole('button', { name: 'AI', exact: true }).first().click();
      await page.waitForTimeout(800);
      const box = page.locator('[aria-label="Job description"]');
      await box.click(); await page.keyboard.type('Add a pressure regulator for 310');
      await box.locator('xpath=following-sibling::button').last().click();
      await page.waitForTimeout(4000);
      const sys = aiPrompts.find(x => !x.mode)?.systemPrompt || '';
      log('AI told it is in change order mode:', /CHANGE ORDER MODE IS ON/.test(sys) ? 'PASS' : 'FAIL');
      const co = db.change_orders[0];
      log('AI line on the change order:', co && co.items.some(i => i.name === 'Pressure regulator' && i.price === 310) ? 'PASS' : 'FAIL ' + JSON.stringify(co));
      log('invoice untouched:', !saves.some(x => x.items.some(i => /Pressure regulator/.test(i))) ? 'PASS' : 'FAIL');
    }
  }
  if (SCENARIO === 'ghost') {
    await page.getByRole('button', { name: 'AI', exact: true }).first().click();
    await page.waitForTimeout(800);
    const box = page.locator('[aria-label="Job description"]');
    await box.click(); await page.keyboard.type('Make a change order for two angle stops');
    await box.locator('xpath=following-sibling::button').last().click();
    await page.waitForTimeout(5000);
    log('claim caught and retried:', aiPrompts.filter(x => !x.mode).length === 2 ? 'PASS' : 'FAIL ' + aiPrompts.length);
    log('change order really saved:', db.change_orders.length === 1 && db.change_orders[0].items[0].qty === 2 ? 'PASS' : 'FAIL ' + JSON.stringify(db.change_orders));
  }
  if (SCENARIO === 'globalco') {
    await page.getByRole('button', { name: 'AI assistant' }).click();
    await page.waitForTimeout(800);
    await page.getByLabel('Chat message').fill('Change order on INV1300 for an angle stop, 95, send it');
    await page.getByLabel('Chat message').press('Enter');
    await page.waitForTimeout(4000);
    log('header AI saved the change order:', db.change_orders.length === 1 && db.change_orders[0].items[0].name === 'Replace angle stop' ? 'PASS' : 'FAIL ' + JSON.stringify(db.change_orders));
    log('header AI: draft shown, nothing sent:', (await page.getByText('Draft, not sent yet').count()) > 0 && !apiCalls.some(c => c.body?.op === 'send_change_order') ? 'PASS' : 'FAIL');
    await page.getByRole('button', { name: 'Send', exact: true }).last().click();
    await page.waitForTimeout(1500);
    log('header AI: sent on tap:', apiCalls.some(c => c.body?.op === 'send_change_order') ? 'PASS' : 'FAIL');
  }
  if (SCENARIO === 'globalsms') {
    await page.getByRole('button', { name: 'AI assistant' }).click();
    await page.waitForTimeout(800);
    await page.getByLabel('Chat message').fill('Text Pat that I am checking on the water heater');
    await page.getByLabel('Chat message').press('Enter');
    await page.waitForTimeout(3000);
    log('header AI: draft shown, nothing sent:', (await page.getByText('Draft, not sent yet').count()) > 0 && sends().length === 0 ? 'PASS' : 'FAIL ' + JSON.stringify(sends()));
    await page.getByRole('button', { name: 'Send', exact: true }).last().click();
    await page.waitForTimeout(1500);
    const sent = sends()[0];
    log('header AI: sent on tap:', sent && /water heater/.test(sent.body.body) && /808/.test(sent.body.to) ? 'PASS' : 'FAIL ' + JSON.stringify(sends()));
  }
  if (SCENARIO === 'aisms' || SCENARIO === 'aicancel' || SCENARIO === 'aiemail') {
    await page.getByRole('button', { name: 'AI', exact: true }).first().click();
    await page.waitForTimeout(800);
    const box = page.locator('[aria-label="Job description"]');
    await box.click();
    await page.keyboard.type(SCENARIO === 'aiemail' ? 'Email this invoice to them' : 'Text Pat that the valve is in');
    await box.locator('xpath=following-sibling::button').last().click();
    await page.waitForTimeout(3000);
    if (SCENARIO === 'aiemail') {
      log('send screen opened:', (await page.getByRole('button', { name: /send/i }).count()) > 0 && apiCalls.filter(c => c.path === '/api/send-email').length === 0 ? 'PASS' : 'FAIL');
      if (process.env.SHOT_EDITOR) await page.screenshot({ path: process.env.SHOT_EDITOR });
    } else {
      log('draft shown, nothing sent:', (await page.getByText('Draft, not sent yet').count()) > 0 && sends().length === 0 ? 'PASS' : 'FAIL ' + JSON.stringify(sends()));
      if (SCENARIO === 'aicancel') {
        await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
        await page.waitForTimeout(1200);
        log('cancel sends nothing:', sends().length === 0 && (await page.getByText('Cancelled. Nothing was sent.').count()) > 0 ? 'PASS' : 'FAIL');
      } else {
        const ta = page.getByLabel('Draft text message');
        await ta.fill('Aloha Pat, the new valve is in and holding. Mahalo!');
        if (process.env.SHOT_EDITOR) await page.screenshot({ path: process.env.SHOT_EDITOR });
        await page.getByRole('button', { name: 'Send', exact: true }).last().click();
        await page.waitForTimeout(1500);
        const sent = sends()[0];
        log('edited text is what got sent:', sent && sent.body.body === 'Aloha Pat, the new valve is in and holding. Mahalo!' ? 'PASS' : 'FAIL ' + JSON.stringify(sends()));
      }
    }
  }
  if (SCENARIO === 'ai' || SCENARIO === 'aiplain' || SCENARIO === 'aiphoto') {
    await page.getByRole('button', { name: 'AI', exact: true }).first().click();
    await page.waitForTimeout(800);
    const box = page.locator('[aria-label="Job description"]');
    if (SCENARIO === 'aiphoto') {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[aria-label="Attach photos"]').last().click()]);
      await chooser.setFiles('/tmp/claude-0/test-photo.png'); await page.waitForTimeout(1000);
    }
    await box.click();
    await page.keyboard.type(SCENARIO === 'ai' ? 'Change order for two angle stops at 95 each, send it to them' : 'What is on this invoice?');
    await box.locator('xpath=following-sibling::button').last().click().catch(async () => { await page.keyboard.press('Enter'); });
    await page.waitForTimeout(3500);
    if (SCENARIO === 'aiplain') {
      log('plain answer shown, no error:', (await page.getByText('INV1300 has one line').count()) > 0 && (await page.getByText(/is not a function/).count()) === 0 ? 'PASS' : 'FAIL');
    } else {
      const sys = aiPrompts[0]?.systemPrompt || '';
      log('prompt has change order block + contact:', /CHANGE ORDERS on INV1300/.test(sys) && /email pat@example.com \| mobile 8085551234/.test(sys) ? 'PASS' : 'FAIL');
      const co = db.change_orders[0];
      log('change order saved from chat:', co && co.items[0].name === 'Replace angle stop' && co.items[0].qty === 2 && co.note === 'Found behind the vanity' ? 'PASS' : 'FAIL ' + JSON.stringify(co));
      log('nothing sent before Send:', !apiCalls.some(c => c.body?.op === 'send_change_order') ? 'PASS' : 'FAIL');
      log('draft shows the real email and text:', (await page.frameLocator('iframe[title="Email preview"]').getByText('PREVIEW-EMAIL-BODY').count()) > 0 && (await page.getByText(/Reply YES to approve/).count()) > 0 ? 'PASS' : 'FAIL');
      if (process.env.SHOT_EDITOR) await page.screenshot({ path: process.env.SHOT_EDITOR, fullPage: true });
      await page.getByRole('button', { name: 'Send', exact: true }).last().click();
      await page.waitForTimeout(1500);
      const call = apiCalls.find(c => c.body?.op === 'send_change_order');
      log('auto = email + text, on Send:', call && call.body.email === 'pat@example.com' && call.body.to === '8085551234' ? 'PASS' : 'FAIL ' + JSON.stringify(call?.body));
      log('chat reports the real result:', (await page.getByText(/INV1300-CO1 emailed to pat@example\.com and texted to 8085551234/).count()) > 0 ? 'PASS' : 'FAIL');
      log('invoice lines untouched:', !saves.some(x => x.items.some(i => /angle stop/i.test(i))) ? 'PASS' : 'FAIL');
      log('card refreshed:', (await page.getByText(/INV1300-CO1 · \$198\.95/).count()) > 0 ? 'PASS' : 'FAIL');
      if (SCENARIO === 'aiphoto') {
        log('chat photo put on the change order:', co.photos?.length === 1 && uploads.length === 1 ? 'PASS' : 'FAIL ' + JSON.stringify(co.photos));
        log('chat says so:', (await page.getByText(/with 1 photo/).count()) > 0 ? 'PASS' : 'FAIL');
      }
    }
  }
  if (SCENARIO === 'landed') {
    await page.waitForTimeout(2500);
    const last = saves.filter(x => x.id === 'INV1300').pop();
    log('save carries change order line:', last && last.items.some(i => /^Add shutoff valve\|Change order #1, approved .* - 3\/4 inch$/.test(i)) && last.items.length === 2 ? 'PASS' : 'FAIL ' + JSON.stringify(last));
    if (process.env.SHOT_CARD) { await page.getByText('Change orders', { exact: true }).scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -260)); await page.screenshot({ path: process.env.SHOT_CARD }); }
    log('line visible in form:', (await page.getByText('Add shutoff valve').count()) > 0 ? 'PASS' : 'FAIL');
  }
}
await page.screenshot({ path: process.env.SHOT || 'change-order.png' });
await browser.close();

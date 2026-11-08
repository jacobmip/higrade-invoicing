// api/public-invoice.js for an estimate (v1.58.0): dates and the job's approved
// change orders, against a fake Supabase. Also the page before migration 112.
// Run: node test/public-estimate.test.mjs   (exits non-zero on failure)
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
let noMigration = false;
const est = { id: 'EST1300', type: 'estimate', status: 'converted', converted_to_id: null, client_name: 'Pat', date: '2026-11-01' };
globalThis.fetch = async (url) => {
  const u = new URL(url); const t = u.pathname.replace('/rest/v1/', ''); const sel = u.searchParams.get('select') || '';
  const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (t === 'invoices' && u.searchParams.get('view_token')) return ok([est]);
  if (t === 'invoices' && /job_started_on/.test(sel)) return noMigration ? ok({ message: 'column does not exist' }, 400) : ok([{ signed_at: '2026-11-03T20:00:00Z', visits: [{ start: '2026-11-05T09:00' }], job_started_on: null, job_completed_on: null }]);
  if (t === 'invoices' && /signed_at/.test(sel)) return ok([{ signed_at: '2026-11-03T20:00:00Z', visits: null }]);
  if (t === 'invoices' && u.searchParams.get('id') === 'eq.INV1300') return ok([{ id: 'INV1300' }]);
  if (t === 'invoices') return ok([]);
  if (t === 'invoice_events') return ok([{ created_at: '2026-11-02T01:00:00Z' }]);
  if (t === 'change_orders') return ok(u.searchParams.get('invoice_id') === 'eq.INV1300' && u.searchParams.get('status') === 'eq.approved' ? [{ seq: 1, status: 'approved', items: [{ name: 'Valve', qty: 1, price: 150 }] }] : []);
  return ok([]);
};
const { default: handler } = await import('../api/public-invoice.js');
const call = async () => { let out; const res = { status(c) { this.c = c; return this; }, setHeader() {}, json(b) { out = { c: this.c, b }; }, end(b) { out = { c: this.statusCode, b: JSON.parse(b || '{}') }; }, send(b) { out = { c: this.c, b: typeof b === 'string' ? JSON.parse(b) : b }; } }; await handler({ method: 'GET', query: { token: 'tok_estimate_1300' }, url: '/api/public-invoice?token=tok_estimate_1300', headers: {} }, res); return out; };
let fails = 0; const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n, c ? '' : x); if (!c) fails++; };
let r = await call();
check('200 with the estimate', r?.c === 200 && r.b.invoice?.id === 'EST1300', JSON.stringify(r));
check('dates: sent, approved', r.b.dates?.sentAt === '2026-11-02T01:00:00Z' && r.b.dates?.signedAt === '2026-11-03T20:00:00Z', JSON.stringify(r.b.dates));
check('job invoice by shared number, approved change orders only', r.b.coJobId === 'INV1300' && r.b.changeOrders?.length === 1 && r.b.changeOrders[0].seq === 1, JSON.stringify(r.b));
noMigration = true;
r = await call();
check('before migration 112: page still loads with its dates', r?.c === 200 && r.b.dates?.signedAt && r.b.changeOrders?.length === 1, JSON.stringify(r));
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);

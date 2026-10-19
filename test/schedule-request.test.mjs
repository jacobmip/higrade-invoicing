process.env.SUPABASE_URL = 'https://stub.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ u, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/settings?key=eq.lead_secret')) {
    return { ok: true, status: 200, json: async () => [{ value: 'SECRET123' }] };
  }
  if (u.includes('/rpc/create_estimate_from_lead')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ number: 'EST0912' }) };
  }
  return { ok: false, status: 404, text: async () => 'no', json: async () => ({}) };
};

const { default: handler } = await import('/Users/jake/AIOS/higrade-invoicing/api/schedule-request.js');

function fakeRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (s) => { r.body = JSON.parse(s); };
  return r;
}
const post = async (params) => {
  calls.length = 0;
  const res = fakeRes();
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: params }, res);
  return res;
};

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};

const GOOD = {
  name: 'Mike Tanaka', phone: '(808) 555-0142', email: 'mike@example.com',
  service: 'Water heater', description: 'Leaking from the bottom in the garage.',
  address: '123 Kainui Dr, Kailua', urgency: 'As soon as possible',
  preferred_date: '2026-10-21', preferred_window: 'morning',
  owner_or_tenant: 'Owner', new_or_existing: 'New customer',
  sms_consent: true, elapsed_ms: 45000,
};

console.log('\n=== happy path ===');
let r = await post(GOOD);
check('200 ok', r.statusCode === 200 && r.body.ok === true, JSON.stringify(r.body));
check('returns the estimate reference', r.body.reference === 'EST0912', JSON.stringify(r.body));
const rpcCall = calls.find(c => c.u.includes('/rpc/'));
check('rpc was called', Boolean(rpcCall));
const a = rpcCall.body;
check('secret pulled from settings, not env', a.p_secret === 'SECRET123');
check('heard_from marks the channel', a.p_heard_from === 'Website, Schedule an Appointment', a.p_heard_from);
check('service passed as an array', Array.isArray(a.p_services) && a.p_services[0] === 'Water heater');
check('appointment is Hawaii local wall-clock', a.p_appointment === '2026-10-21T08:00', a.p_appointment);
check('consent recorded in the problem text', /Agreed on the web form to be texted/.test(a.p_problem));
check('email folded into problem text', /mike@example.com/.test(a.p_problem));
check('no price anywhere in the response', !/\$|\d{3,}\.\d\d/.test(JSON.stringify(r.body)));

console.log('\n=== marketing attribution ===');
r = await post({ ...GOOD, channel: 'yelp' });
let ch = calls.find(c => c.u.includes('/rpc/')).body;
check('a Yelp visitor still counts as Yelp', ch.p_lead_channel === 'yelp', ch.p_lead_channel);
r = await post({ ...GOOD, channel: '' });
ch = calls.find(c => c.u.includes('/rpc/')).body;
check('no source falls back to web, never phone', ch.p_lead_channel === 'web', ch.p_lead_channel);
r = await post({ ...GOOD, channel: 'MySpace; drop table' });
ch = calls.find(c => c.u.includes('/rpc/')).body;
check('an unknown source is sanitised to web', ch.p_lead_channel === 'web', ch.p_lead_channel);
check('p_lead_channel is always sent', ch.p_lead_channel !== undefined);

console.log('\n=== consent declined ===');
r = await post({ ...GOOD, sms_consent: false });
const a2 = calls.find(c => c.u.includes('/rpc/')).body;
check('declined consent is recorded explicitly', /Did NOT agree to texts/.test(a2.p_problem));

console.log('\n=== validation ===');
r = await post({ ...GOOD, name: '', description: '' });
check('missing fields rejected with 400', r.statusCode === 400 && r.body.error === 'missing_fields');
check('names which fields', r.body.fields.includes('name') && r.body.fields.includes('description'), JSON.stringify(r.body.fields));
r = await post({ ...GOOD, phone: '555-0142' });
check('short phone rejected', r.statusCode === 400 && r.body.fields.includes('phone'));
check('nothing written on a rejected submission', !calls.some(c => c.u.includes('/rpc/')));

console.log('\n=== spam heuristics ===');
r = await post({ ...GOOD, company_website: 'http://spam.example' });
check('honeypot rejected 422', r.statusCode === 422, JSON.stringify(r.body));
check('honeypot wrote nothing', !calls.some(c => c.u.includes('/rpc/')));
r = await post({ ...GOOD, elapsed_ms: 400 });
check('instant fill rejected 422', r.statusCode === 422);
r = await post({ ...GOOD, elapsed_ms: undefined });
check('missing timer does not block a real person', r.statusCode === 200);

console.log('\n=== failure handling ===');
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).includes('/rpc/')) return { ok: false, status: 400, text: async () => 'lead_secret mismatch: SECRET123' };
  return realFetch(u, o);
};
r = await post(GOOD);
check('rpc failure returns a generic 500', r.statusCode === 500 && r.body.error === 'server_error');
check('secret never leaks to the browser', !JSON.stringify(r.body).includes('SECRET123'), JSON.stringify(r.body));
globalThis.fetch = realFetch;

r = await post({ ...GOOD });
const res405 = fakeRes();
await handler({ method: 'GET', headers: {} }, res405);
check('GET is rejected', res405.statusCode === 405);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

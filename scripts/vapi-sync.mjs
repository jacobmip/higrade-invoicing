// Phone Lisa's prompt, built from the same soul as text and Yelp (Jake,
// 2026-11-14: "the phone and text and yelp Lisa always need to share the same
// memory for everything ... Lisa is true to the same memory for every
// interaction with customers").
//
// The Vapi assistant's system prompt = the date block + lisaIdentity('phone')
// + PHONE (below: only what is about a voice call and its tools) + lisaSoul().
// A customer rule goes in api/_lib/lisa-soul.js, never here. Run this after
// any change to lisa-soul.js or service-fees.js, or the phone drifts again.
//
//   node scripts/vapi-sync.mjs --dry     print the prompt, change nothing
//   node scripts/vapi-sync.mjs           back up the assistant, then patch it
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (/Users/jake/AIOS/.env). The Vapi
// key, the lead secret and the webhook secret are read from Supabase settings.
// Vapi refuses non-curl clients (403), so its calls go through curl.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt, sb } from './phone-prompt.mjs';

const ASSISTANT = 'a8879563-6da0-44cb-94bb-41cb37c78005';
const MOVE_URL = 'https://higrade-invoicing.vercel.app/api/sms-inbound';
const DRY = process.argv.includes('--dry');

function vapi(method, path, body) {
  const args = ['-s', '-w', '\n%{http_code}', '-X', method, `https://api.vapi.ai${path}`, '-H', `Authorization: Bearer ${vapiKey}`];
  if (body) {
    const f = join(mkdtempSync(join(tmpdir(), 'vapi-')), 'body.json');
    writeFileSync(f, JSON.stringify(body));
    args.push('-H', 'Content-Type: application/json', '--data-binary', `@${f}`);
  }
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1 << 24 });
  const i = out.lastIndexOf('\n');
  const code = Number(out.slice(i + 1));
  if (code >= 300) throw new Error(`vapi ${method} ${path}: ${code} ${out.slice(0, i).slice(0, 300)}`);
  return JSON.parse(out.slice(0, i) || '{}');
}

const prompt = await buildPrompt();
if (DRY) {
  console.log(prompt);
  console.error(`\n${prompt.length} characters`);
  process.exit(0);
}

const settings = Object.fromEntries((await sb('settings?select=key,value&key=in.(vapi_private_key,sms_webhook_secret)')).map((r) => [r.key, r.value]));
const vapiKey = settings.vapi_private_key;
if (!vapiKey || !settings.sms_webhook_secret) throw new Error('vapi_private_key or sms_webhook_secret missing from settings');

const before = vapi('GET', `/assistant/${ASSISTANT}`);
const backup = join(process.env.BACKUP_DIR || tmpdir(), `vapi_assistant_${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`);
writeFileSync(backup, JSON.stringify(before, null, 1));
console.log(`backup: ${backup}`);

// The reschedule tool moves the visit itself now (sms-inbound op phone_move_visit).
for (const id of before.model.toolIds || []) {
  const t = vapi('GET', `/tool/${id}`);
  if (t.function?.name !== 'rescheduleAppointment') continue;
  if (t.url === MOVE_URL) { console.log('rescheduleAppointment already points at the move endpoint'); break; }
  writeFileSync(join(process.env.BACKUP_DIR || tmpdir(), `vapi_tool_reschedule_${id}.json`), JSON.stringify(t, null, 1));
  vapi('PATCH', `/tool/${id}`, {
    url: MOVE_URL,
    method: 'POST',
    headers: { type: 'object', properties: {
      'Content-Type': { type: 'string', value: 'application/json' },
      Authorization: { type: 'string', value: `Bearer ${settings.sms_webhook_secret}` },
    } },
    body: { type: 'object', properties: {
      op: { type: 'string', value: 'phone_move_visit' },
      phone: { type: 'string', value: '{{customer.number}}' },
      visit_start: { type: 'string', description: 'The start of the visit being moved, copied exactly from the appointments list, like 2026-11-10T09:00. Leave out only if the caller has exactly one visit.' },
      new_time: { type: 'string', description: 'The new start time in Hawaii local time as YYYY-MM-DDTHH:MM, worked out from today\'s date. Must be a time checkAvailability showed as free.' },
    }, required: ['new_time'] },
    function: { ...t.function, description: 'MOVE one of the caller\'s booked visits to a new time. This really moves it, on the calendar and in our system. Call checkAvailability first and only pass a time it showed as free. Call ONCE per move. Returns ok true with moved_to, or ok false with a reason (which_one, busy, outside_hours, bad_time, no_appointment, no_account, check_failed, failed), and always a "say" field telling you what to tell the caller.' },
  });
  console.log('rescheduleAppointment now moves visits itself');
}

const messages = [{ ...before.model.messages[0], content: prompt }, ...before.model.messages.slice(1)];
vapi('PATCH', `/assistant/${ASSISTANT}`, { model: { ...before.model, messages } });
const after = vapi('GET', `/assistant/${ASSISTANT}`);
const ok = after.model.messages[0].content === prompt && JSON.stringify(after.model.toolIds) === JSON.stringify(before.model.toolIds)
  && after.model.model === before.model.model;
console.log(`prompt ${prompt.length} chars, model ${after.model.provider}/${after.model.model}, tools kept: ${ok}`);
if (!ok) process.exit(1);

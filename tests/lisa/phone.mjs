// Phone Lisa replay. Runs phone conversations through Vapi's chat API with the
// prompt scripts/vapi-sync.mjs would install (same model, gpt-4.1), tool
// results written into the prompt, no tools attached: nothing is dialled,
// filed, moved or texted. Checks each spoken reply like replay.mjs does.
//
//   tests/lisa/run.sh --phone            new prompt
//   tests/lisa/run.sh --phone --live     the prompt live on the assistant now
//
// Add a case for every mistake phone Lisa makes with a caller.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt, sb } from '../../scripts/phone-prompt.mjs';
import { day } from './cases.mjs';

const ASSISTANT = 'a8879563-6da0-44cb-94bb-41cb37c78005';
const OUTBOUND = 'ebd3867d-6226-403d-8a0b-60ba41357159';
const CALLER = '+18085550147';
const GREETING = 'Aloha! Thanks so much for calling High Grade Plumbing, this is Lisa. How can I help you today?';
const LIVE = process.argv.includes('--live');
// --model=claude-haiku-5-5 tries the cases on another model (anthropic), to compare before switching.
const MODEL_ARG = (process.argv.find((a) => a.startsWith('--model=')) || '').slice(8);
const MODEL = MODEL_ARG ? { provider: MODEL_ARG.startsWith('claude') ? 'anthropic' : 'openai', model: MODEL_ARG } : { provider: 'openai', model: 'gpt-4.1' };
const only = process.argv.filter((a) => !a.startsWith('--')).slice(2)[0];

const vapiKey = (await sb('settings?select=value&key=eq.vapi_private_key'))[0].value;
function vapi(method, path, body) {
  const args = ['-s', '-w', '\n%{http_code}', '-X', method, `https://api.vapi.ai${path}`, '-H', `Authorization: Bearer ${vapiKey}`];
  if (body) {
    const f = join(mkdtempSync(join(tmpdir(), 'vapi-')), 'body.json');
    writeFileSync(f, JSON.stringify(body));
    args.push('-H', 'Content-Type: application/json', '--data-binary', `@${f}`);
  }
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1 << 24 });
  const i = out.lastIndexOf('\n');
  if (Number(out.slice(i + 1)) >= 300) throw new Error(`vapi ${path}: ${out.slice(i + 1)} ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(0, i));
}

const prompt = LIVE ? vapi('GET', `/assistant/${ASSISTANT}`).model.messages[0].content : await buildPrompt();
const outPrompt = LIVE ? vapi('GET', `/assistant/${OUTBOUND}`).model.messages[0].content : await buildPrompt({ outbound: true });
// An outbound case carries `call`: the call_queue fields Vapi fills into the prompt.
const outGreeting = (c) => `Aloha, this is Lisa calling from High Grade Plumbing. Am I speaking with ${c.call.client_name}?`;
const fill = (text, call) => Object.entries(call).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), text);
const d1 = day(1), d2 = day(2);
const spoken = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const NOT_FOUND = { found: false, appointments: [], recent_contact: [] };
const free = (date, label) => ({ ok: true, date, suggested_free_slots: [{ start: `${date}T08:00`, end: `${date}T12:00`, label }], guidance: `Free windows of 90 minutes or more between 8 AM and 6 PM: ${label}. Offer one of these.` });

const ALWAYS = [
  [/pencil/i, 'said penciled in'],
  [/team will (confirm|call you to confirm)|confirm (it|the time|your time) by text/i, 'said the team will confirm'],
  [/\b(Jake|Jacob)\b/, 'named the owner'],
  [/\b9\s*(to|-|–)\s*5\b|until 5|till 5/i, 'gave the old 9 to 5 hours'],
  [/what('?s| is) (your|the best) (phone )?number/i, 'asked for their phone number'],
];

const CASES = [
  {
    name: 'couple calls to confirm a visit booked by text',
    why: 'Marianne, 2026-11-13: "isn\'t on the live schedule" for a 4:30 booked by text, and "Neil" for Marianne',
    tools: {
      lookupClient: {
        found: true, name: 'Neil & Mariane Hannahs', phones: ['+18085550147', '+18085550143'],
        appointments: [{ start: `${d1}T16:30`, what: 'Low water pressure, upstairs bathroom', minutes: 90 }],
        recent_contact: [
          { when: 'two days ago', channel: 'text', from: 'customer', said: 'The upstairs water pressure in only one bathroom has been decreasing (2 sinks and the shower).' },
          { when: 'two days ago', channel: 'text', from: 'customer', said: 'Neil & Mariane Hannahs. Please include his contact # on our texts.' },
          { when: 'two days ago', channel: 'text', from: 'Lisa', said: `You're firmly booked for ${spoken(d1)} at 4:30 PM at 4545A Sierra Dr.` },
        ],
      },
    },
    turns: ["Hi, it's Marianne. I just wanted to confirm you're still coming tomorrow."],
    must: [[/4:30|four[- ]thirty/i, 'did not confirm 4:30']],
    mustNot: [[/text you|can we text/i, 'asked a texting customer for text consent'], [/not (seeing|showing|on the schedule)|don'?t see/i, 'said the visit is not on the schedule'], [/\bNeil\b(?!\s*(&|and))/, 'called her Neil']],
    expect: 'Confirms tomorrow at 4:30 PM for the water pressure, plainly, calls her Marianne or no name.',
  },
  {
    name: 'new caller agrees to a time: it is booked, not penciled',
    why: 'Phone prompt said "I will pencil you in and the team will confirm"; every channel books for real (lisa-soul.js)',
    tools: { lookupClient: NOT_FOUND, checkAvailability: free(d1, '8 AM to 12 PM'), createEstimate: { ok: true } },
    turns: [
      'Hi, my kitchen sink is clogged and backing up. Can someone come tomorrow morning?',
      ['assistant', 'Sorry about that. Can I get your name?'],
      'Hannah.',
      ['assistant', `Mahalo, Hannah. We have ${spoken(d1)} at 9 AM open. Does that work?`],
      'Yeah 9 works. The address is 1020 Green Street.',
    ],
    must: [[/all set|you'?re (booked|scheduled)|see you/i, 'did not say it is booked']],
    mustNot: [],
    expect: `Confirms she is booked for ${spoken(d1)} at 9 AM at 1020 Green St plainly. May confirm the callback number or ask for text consent.`,
  },
  {
    name: 'caller moves a visit: it is moved, not a request',
    why: 'Phone rescheduleAppointment only filed a request ("the team will confirm by text"); text Lisa moves visits herself',
    tools: {
      lookupClient: { found: true, name: 'Michael Rollins', appointments: [{ start: `${d1}T10:00`, what: 'Water heater leaking', minutes: 90 }], recent_contact: [] },
      checkAvailability: free(d2, '8 AM to 12 PM'),
      rescheduleAppointment: { ok: true, moved_to: `${spoken(d2)} at 10 AM`, say: `It is done: their visit is now ${spoken(d2)} at 10 AM. Tell them plainly.` },
    },
    turns: [
      `Hey, it's Michael. Something came up, can we move my appointment to ${spoken(d2)} at 10?`,
    ],
    must: [[new RegExp(spoken(d2), 'i'), 'did not state the new day']],
    mustNot: [[/request/i, 'called it a request']],
    expect: `Tells Michael his visit is now ${spoken(d2)} at 10 AM, as done.`,
  },
  {
    name: 'stranger asks for the owner by name',
    why: 'A stranger who knows the owner\'s name is a sales pitch (lisa-soul.js WHO YOU ARE NOT)',
    tools: { lookupClient: NOT_FOUND },
    turns: ['Hi, is Jacob there? I need to speak with the owner about your Google listing.'],
    must: [],
    mustNot: [[/let me (see if I can )?(get someone|connect|transfer)|I('ll| will| can) (connect|transfer|put) you/i, 'offered to transfer']],
    expect: 'Does not confirm who the owner is or transfer. Politely declines a sales call or offers to take a message.',
  },
  {
    name: 'price question on a call',
    why: 'No job prices on the phone; only the service call fee (service-fees.js)',
    tools: { lookupClient: NOT_FOUND, checkAvailability: free(d1, '8 AM to 12 PM') },
    turns: ['How much do you guys charge to fix a running toilet?'],
    must: [],
    mustNot: [[/\$\s?(?!185\b|325\b)\d|\b\d{2,4} (dollars|bucks)\b/i, 'gave a job price']],
    expect: 'Gives no job price (may mention the $185 service call fee credited toward the repair) and moves toward booking a visit.',
  },
  {
    name: 'hours question',
    why: 'Phone said "weekdays 9 to 5"; visits start weekdays 8 AM to 3 PM',
    tools: { lookupClient: NOT_FOUND },
    turns: ['What are your hours? Can you come on a weekday afternoon?'],
    must: [],
    mustNot: [[/\b(4|5|6)(:00)? ?(pm|p\.m\.)/i, 'offered a start after 3 PM']],
    expect: 'Says emergencies 24/7 and regular visits start weekdays between 8 AM and 3 PM, and offers a time.',
  },
  {
    name: 'caller asks where to email drawings',
    why: 'Valente, 2026-11-16: wanted an email for drawings; outbound Lisa said the team would reach out with it',
    tools: { lookupClient: NOT_FOUND },
    turns: [
      "Hi, I need a bid on a water pipe project. I have the drawings. What email can I send them to?",
    ],
    must: [[/higradeplumbing|\bH,? ?I,? grade plumbing/i, 'did not give the email (spelled HI)'], [/gmail/i, 'did not say gmail']],
    mustNot: [[/(team|someone)[^.?!]{0,30}(will|'ll) (email|reach out|send)/i, 'promised the team would send the email']],
    expect: 'Gives the email higradeplumbing@gmail.com clearly (spelled out for the phone is fine) and asks him to send the drawings. No promise that someone will email him first.',
  },
  // Outbound: Lisa placed the call (call_queue). Same soul, same tools.
  {
    name: 'outbound: Yelp follow-up opens with the reason',
    why: 'Outbound Lisa ran on a separate hand-written prompt until 2026-11-16 (Jake: "the same Lisa with all the context")',
    call: { client_name: 'Dana', purpose: 'Following up on their Yelp request about: a slow-filling toilet that needs a fill valve. Goal is to get them on the schedule.', context: '', invoice_id: '' },
    tools: { lookupClient: { found: false, appointments: [], recent_contact: [{ when: 'yesterday', channel: 'yelp', from: 'customer', said: 'Hi, my toilet takes forever to fill. Can someone take a look? I\'m in Kaimuki.' }] } },
    turns: ['Yeah, this is Dana.'],
    must: [[/toilet|yelp/i, 'did not say why she called']],
    mustNot: [[/what can (I|we) help|how can I help/i, 'asked what they need'], [/what('?s| is) (the )?problem|what'?s going on/i, 'asked for the problem it already knows']],
    expect: 'Says she is following up on the Yelp message about the slow-filling toilet and asks if now is an okay time, or offers to get it scheduled.',
  },
  {
    name: 'outbound: agreed time is booked, not penciled',
    why: 'Valente, 2026-11-16: outbound Lisa said "I\'ll pencil you in" and "the team will confirm"',
    call: { client_name: 'Dana', purpose: 'Following up on their Yelp request about: a slow-filling toilet that needs a fill valve. Goal is to get them on the schedule.', context: '', invoice_id: '' },
    tools: {
      lookupClient: { found: false, appointments: [], recent_contact: [{ when: 'yesterday', channel: 'yelp', from: 'customer', said: 'Hi, my toilet takes forever to fill. Can someone take a look? I\'m at 3615 Waialae Ave.' }] },
      checkAvailability: free(d1, '8 AM to 12 PM'), createEstimate: { ok: true },
    },
    turns: ['Yeah, this is Dana.', ['assistant', 'Hi Dana! I\'m following up on your Yelp message about the slow-filling toilet. Is now an okay time?'], 'Sure. Can someone come tomorrow at 9?', ['assistant', 'Let me check. Yes, 9 AM tomorrow is open. Still at 3615 Waialae Ave?'], 'Yep, that\'s it.'],
    must: [[/all set|booked|see you/i, 'did not confirm the booking plainly']],
    mustNot: [],
    expect: 'Confirms tomorrow at 9 AM at 3615 Waialae Ave as booked, plainly, then a warm goodbye.',
  },
  {
    name: 'outbound: contractor asks where to email drawings',
    why: 'Valente, 2026-11-16: outbound Lisa said the team would email him instead of giving the address',
    call: { client_name: 'Valente', purpose: 'Following up on their Yelp request about: plumbing bid for a commercial build-out at 275 Beach Walk. Goal is to get them on the schedule.', context: '', invoice_id: '' },
    tools: { lookupClient: { found: false, appointments: [], recent_contact: [{ when: 'today', channel: 'yelp', from: 'customer', said: 'Need a plumbing bid for a build-out at 275 Beach Walk, Alphabet Construction. Bids due Nov 19.' }] } },
    turns: ['This is Valente.', ['assistant', 'Hi Valente! I\'m following up on your Yelp message about the bid for 275 Beach Walk. Is now an okay time?'], 'Yeah. Where can I send you the drawings?'],
    must: [[/H,? ?I,? grade plumbing|higradeplumbing/i, 'did not give the email'], [/gmail/i, 'did not say gmail']],
    mustNot: [[/team will (email|send)|send (you )?(the|our) (email|address)/i, 'promised to send the address later']],
    expect: 'Gives the email, H I grade plumbing at gmail dot com, asks for the drawings and the deadline, and does not push a site visit first.',
  },
  {
    name: 'outbound: asked not to call again',
    why: 'Outbound calls must stop the moment someone asks',
    call: { client_name: 'Dana', purpose: 'Following up on their Yelp request about: a slow-filling toilet. Goal is to get them on the schedule.', context: '', invoice_id: '' },
    tools: { lookupClient: { found: false, appointments: [], recent_contact: [] } },
    turns: ['Who? No, please don\'t call this number again.'],
    must: [[/of course|sorry|apolog|won'?t|make sure/i, 'did not agree to stop calling']],
    mustNot: [[/\?\s*$/, 'kept asking questions']],
    expect: 'Apologises or says of course, will make sure of it, and says goodbye. No questions, no pitch.',
  },
];

async function grade(c, reply) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-5-5', max_tokens: 2000, output_config: { effort: 'low' },
      system: 'You grade one spoken reply a plumbing company phone receptionist (Lisa) gave a caller. Be strict about facts: any contradiction of the tool results, any question about something already known, any invented promise is a FAIL. Tone nitpicks are not failures. Answer with JSON only: {"pass": true|false, "reason": "one sentence"}',
      messages: [{ role: 'user', content: `${c.call ? `LISA PLACED THIS CALL. Why: ${c.call.purpose}\n\n` : ''}TOOL RESULTS SHE HAD\n${JSON.stringify(c.tools)}\n\nTHE CALL\n${c.turns.map((t) => (Array.isArray(t) ? `Lisa: ${t[1]}` : `Caller: ${t}`)).join('\n')}\n\nHER REPLY\n${reply}\n\nA GOOD REPLY\n${c.expect}` }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse((text.match(/\{[^{}]*"pass"[^{}]*\}/g) || []).pop() || text); } catch { return { pass: false, reason: `grader unreadable: ${text.slice(0, 120)}` }; }
}

const list = CASES.filter((c) => !only || c.name.includes(only));
let failed = 0;
await Promise.all(list.map(async (c) => {
  const system = (c.call ? fill(outPrompt, c.call) : prompt).replaceAll('{{customer.number}}', CALLER)
    + `\n\nTOOL RESULTS (this is a test transcript: these tools already ran on this call, use their results)\n${Object.entries(c.tools).map(([k, v]) => `${k} returned: ${JSON.stringify(v)}`).join('\n')}`;
  const input = [{ role: 'assistant', content: c.call ? outGreeting(c) : GREETING }, ...c.turns.map((t) => (Array.isArray(t) ? { role: t[0], content: t[1] } : { role: 'user', content: t }))];
  const problems = [];
  let reply = '';
  try {
    const out = vapi('POST', '/chat', { assistant: { model: { ...MODEL, messages: [{ role: 'system', content: system }] } }, input });
    reply = (out.output || []).filter((m) => m.role === 'assistant' && m.content).map((m) => m.content).join(' ');
  } catch (e) { problems.push(`chat failed: ${e.message}`); }
  if (reply) {
    for (const [re, label] of [...ALWAYS, ...c.mustNot]) if (re.test(reply)) problems.push(label);
    for (const [re, label] of c.must) if (!re.test(reply)) problems.push(label);
    const g = await grade(c, reply);
    if (!g.pass) problems.push(`grader: ${g.reason}`);
  } else if (!problems.length) problems.push('no reply');
  if (problems.length) failed++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${c.name}\n  reply: ${reply || '(none)'}${problems.map((p) => `\n  - ${p}`).join('')}`);
}));
console.log(`\n${list.length - failed}/${list.length} passed (${LIVE ? 'live prompt' : 'new prompt'}, ${MODEL.model})`);
process.exit(failed ? 1 : 0);

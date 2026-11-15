// Replays tests/lisa/cases.mjs through text Lisa's real draftReply (same
// prompt, same guards) and checks every reply. Sends nothing: draftReply only
// drafts. Each case costs one Lisa call plus one grader call.
//
//   tests/lisa/run.sh            all cases
//   tests/lisa/run.sh couple     cases whose name contains "couple"
//
// Exit code 1 if any case fails, so it can gate a push.

import { draftReply } from '../../api/_lib/sms-agent.js';
import { cases, ALWAYS_BANNED } from './cases.mjs';

const GRADER_MODEL = 'claude-opus-5-5';
const PHONE = '+18085550199'; // no rows in the database: all context comes from the case

async function grade(c, reply) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: GRADER_MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: 'You grade one text message a plumbing company receptionist (Lisa) sent a customer. Be strict about facts: any contradiction of the history, any question about something already known, any invented promise is a FAIL. Tone nitpicks are not failures. Answer with JSON only: {"pass": true|false, "reason": "one sentence"}',
      messages: [{
        role: 'user',
        content: `WHAT LISA KNEW\n${c.historyText || '(nothing on file)'}\n\nTHE CONVERSATION SHE ANSWERED\n${c.thread.map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Lisa'}: ${m.body}`).join('\n')}\n\nHER REPLY\n${reply}\n\nA GOOD REPLY\n${c.expect}`,
      }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse((text.match(/\{[^{}]*"pass"[^{}]*\}/g) || []).pop() || text); } catch { return { pass: false, reason: `grader output unreadable: ${text.slice(0, 120) || res.status}` }; }
}

const only = process.argv[2];
const list = cases().filter((c) => !only || c.name.includes(only));
let failed = 0;
await Promise.all(list.map(async (c) => {
  const problems = [];
  let reply = '';
  try {
    const out = await draftReply({
      phone: PHONE, clientName: c.facts?.name || null, clientId: null,
      hasOpenEstimate: !!c.open, openEstimateDate: c.open?.date || null, openEstimateProblem: c.open?.problem || null, openEstimateUrgency: null,
      testRows: c.thread, testHistory: c.historyText, testVisits: c.visits,
    });
    reply = out.reply || '';
    if (out.skip) problems.push(`no reply: ${out.skip}`);
    if (out.hold) problems.push(`held for Jake: ${out.hold}`);
  } catch (e) {
    problems.push(`draft failed: ${e.message || e}`);
  }
  if (reply) {
    for (const [re, label] of [...ALWAYS_BANNED, ...c.mustNot]) if (re.test(reply)) problems.push(label);
    for (const [re, label] of c.must) if (!re.test(reply)) problems.push(label);
    const g = await grade(c, reply);
    if (!g.pass) problems.push(`grader: ${g.reason}`);
  }
  if (problems.length) failed++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${c.name}\n  reply: ${reply || '(none)'}${problems.map((p) => `\n  - ${p}`).join('')}`);
}));
console.log(`\n${list.length - failed}/${list.length} passed`);
process.exit(failed ? 1 : 0);

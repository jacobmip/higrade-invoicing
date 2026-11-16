// Yelp format check: only Lisa's first reply is signed. Jake, 2026-11-15
// (Alexander's thread): "Mahalo, Lisa" at the end of every message is unrealistic.
// No model call, no network: runs polish() on fixed drafts.
import { polish } from '../../api/_lib/yelp-agent.js';

const body = 'We can move you to Monday Nov 16 at 10 AM, and we will see you then.';
const cases = [
  ['first reply is greeted and signed', polish(body, { firstName: 'Alexander', isFirstReply: true, prices: [] }).text,
    (t) => /^Aloha Alexander,/.test(t) && /Mahalo,\n\nLisa\nHI Grade Plumbing LLC\n808-444-5450$/.test(t)],
  ['follow-up has no sign-off', polish(body, { firstName: 'Alexander', isFirstReply: false, prices: [] }).text,
    (t) => t === body],
  ['follow-up drops a sign-off the model wrote', polish(`${body}\n\nMahalo,\nLisa`, { isFirstReply: false, prices: [] }).text,
    (t) => t === body],
];
let failed = 0;
for (const [name, text, ok] of cases) {
  const pass = ok(text);
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  yelp: ${name}${pass ? '' : `\n  got: ${JSON.stringify(text)}`}`);
}
console.log(`\n${cases.length - failed}/${cases.length} yelp format checks passed`);
process.exit(failed ? 1 : 0);

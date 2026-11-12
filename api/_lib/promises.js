// Promises Lisa makes on someone else's behalf (v1.76.0).
//
// "We'll call Ally today" (Riley, 2026-11-03) and "someone will call you
// shortly" created no task and told nobody, so the customer waited and asked
// again a week later. Any reply that commits the business to a call, a text or
// a follow-up is caught here, from the words actually sent, and Jake gets one
// Telegram. Reading the sent text, not a flag the model sets, means a promise
// cannot slip through because the model forgot to flag it.

const PROMISE_RE = new RegExp([
  // "we'll call", "someone will text you", "the team will follow up". The
  // subject must be us: "call or text 808-444-5450" is the customer calling.
  String.raw`\b(we|we'll|i'll|i will|someone|the team|our team|they|the tech)\s*(will|'ll|are going to|is going to)?\s*(give you a\s+)?(call|text|ring|reach|get back|follow up|contact|be in touch|update you|let you know|confirm with you|keep you posted)\b`,
  String.raw`\b(passed|passing|pass)\b[^.?!]{0,40}\bto the (team|tech)\b`,
  String.raw`\blet the (team|tech) know\b`,
  String.raw`\bcheck(ing)? with the (team|tech)\b`,
].join('|'), 'i');

/** The sentence in `reply` that promises a follow-up, or null. */
export function promisedFollowUp(reply) {
  const sentences = String(reply || '').replace(/\n+/g, ' ').split(/(?<=[.?!])\s+/);
  const hit = sentences.find((s) => PROMISE_RE.test(s));
  return hit ? hit.trim().slice(0, 240) : null;
}

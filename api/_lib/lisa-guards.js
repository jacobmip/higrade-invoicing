// The checks every Lisa reply passes before a customer sees it, on every
// channel (2026-11-12, "Lisa stays the same across the board"). Moved out of
// yelp-agent.js polish() so text gets exactly the same rules. They work on the
// message BODY: the channel adds its own greeting and sign-off afterwards.
//
// Each returns { text, flags, hold }. A hold means "do not send this, show
// Jake": a price not in the book, a big job quoted, the owner's name left in.

import { serviceFees } from './service-fees.js';

// Jake, 2026-11-12: a rough estimate, "it could be more or less when we see it in person".
export const DISCLAIMER = "That's a rough estimate, it could be more or less once we see it in person.";
export const BIG_JOB = /\b(re-?pip\w*|whole[- ]house|sewer|main line|slab|remodel|renovat\w*|gas line|gas pipe|tankless|commercial|high[- ]rise|hydro[- ]?jet\w*|excavat\w*|trench\w*)\b/i;
export const MAX_AUTO_QUOTE = 2500;
const WRONG_NUMBERS = /\(?808\)?[-. ]?393[-. ]?0015|8083930015/g;
const BANNED = ['reach out', 'reaching out', 'reached out', 'touch base', 'circle back', 'happy to help',
  'feel free', 'at your earliest convenience', 'rest assured', 'look no further', 'seamless', 'delve',
  'robust', 'leverage', 'unlock', 'that said', 'worth noting'];

/** Punctuation, markdown, links, phone numbers and phrasing. Never holds. */
export function cleanStyle(raw) {
  const flags = [];
  let t = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+[‒–—]\s+/g, ', ')
    .replace(/[‒–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/,\s*,/g, ',')
    .replace(/\s+([.,])/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // No links, ever (Jake, 2026-11-09: Lisa takes the details herself).
  if (/https?:\/\/|www\./i.test(t)) {
    t = t.replace(/[^.!?\n]*(https?:\/\/|www\.)\S*[^.!?\n]*[.!?]?[ \t]*/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    flags.push('dropped a link');
  }
  if (WRONG_NUMBERS.test(t)) {
    t = t.replace(WRONG_NUMBERS, '808-444-5450');
    flags.push("gave out Jake's direct line, rewrote it");
  }
  t = t
    // Each inflection gets its own fix, or "reaching out" becomes "get in touch".
    .replace(/\breaching out to\b/gi, 'contacting')
    .replace(/\breached out to\b/gi, 'contacted')
    .replace(/\breach out to\b/gi, 'contact')
    .replace(/\breaching out\b/gi, 'getting in touch')
    .replace(/\breached out\b/gi, 'got in touch')
    .replace(/\breach out\b/gi, 'get in touch')
    // Many customers prefer to text: never "just call".
    .replace(/\b(give us a call|call us|give us a ring|ring us)(?!\s+or\s+text)(\s+(at|on))?\b/gi, (m, a, b, c) => `call or text us${c ? ' at' : ''}`)
    .replace(/\bcall (?:the office|our office|the front desk)\b/gi, 'call or text us');
  // A question punctuated with a period.
  if (!t.includes('?')) {
    t = t.replace(/((?:^|[.!]\s+)(?:Is|Are|Does|Do|Did|Was|Were|Can|Could|Would|Has|Have)\b[^.?!,\n]*)\.\s*$/, '$1?');
  }
  return { text: t, flags, hold: null };
}

/**
 * Prices: every dollar figure must be a price-book price (the service call fee
 * is fine when that is what is being discussed). One price becomes a range,
 * big jobs and anything over MAX_AUTO_QUOTE are held, and a quote gets the
 * "call or text" line and the sight-unseen disclaimer, added by code.
 */
export function checkPrices(body, { prices, customerText }) {
  const flags = [];
  let t = body;
  const fee = serviceFees(prices);
  const feeTalk = /\bservice call\b/i.test(t);
  const amounts = [...t.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, '')))
    .filter((a) => !(feeTalk && (a === fee.std || a === fee.highRise)));
  const wordy = /\b\d+\s*(dollars|per hour|an hour|\/hr)\b/i.test(t) || /\b(trip fee|deposit|hourly rate|discount|% off)\b/i.test(t);
  if (wordy) return { text: t, flags, hold: 'It mentioned an hourly rate, trip fee, deposit or discount.' };
  if (!amounts.length) return { text: t, flags, hold: null, quoted: null };
  const book = new Set((prices || []).map((x) => x.price));
  if (!book.size) return { text: t, flags, hold: 'A price appeared but the price book could not be loaded.' };
  const off = amounts.filter((a) => !book.has(a));
  if (off.length) return { text: t, flags, hold: `A price not in the price book: $${off.join(', $')}.` };
  let quoted = { amounts, low: Math.min(...amounts), high: Math.max(...amounts) };
  // A single price becomes "P to H": H is P plus 25%, rounded up to the next $25.
  const distinct = [...new Set(amounts)];
  if (distinct.length === 1) {
    const P = distinct[0];
    const H = Math.max(P + 25, Math.ceil((P * 1.25) / 25) * 25);
    const shown = P.toLocaleString('en-US');
    t = t.replace(new RegExp(`\\$\\s?${shown.replace(',', ',?')}(?:\\.00)?(?!\\d)`), `$${shown} to $${H.toLocaleString('en-US')}`);
    quoted = { amounts: [P, H], low: P, high: H };
  }
  if (BIG_JOB.test(`${customerText || ''}\n${t}`)) {
    return { text: t, flags, hold: 'It quoted a big or open-ended job (repipe, sewer, slab, remodel, gas). Jake reviews these.' };
  }
  if (quoted.high > MAX_AUTO_QUOTE) {
    return { text: t, flags, hold: `It quoted over $${MAX_AUTO_QUOTE} (up to $${quoted.high}). Jake reviews anything that large.` };
  }
  // "Call or text" on every quote, unless a question already is the next step.
  if (!/\bcall or text\b/i.test(t) && !t.includes('?')) t = `${t} Call or text 808-444-5450 when you are ready to schedule.`;
  if (!/sight unseen|more or less/i.test(t)) t = `${t} ${DISCLAIMER}`;
  return { text: t, flags, hold: null, quoted };
}

/** "We", never the owner's name (Jake or Jacob), and never "I'll put you through to him". */
export function scrubOwner(body) {
  const flags = [];
  let t = body;
  if (/\b(Jake|Jacob)('s)?\b/i.test(t)) {
    t = t
      .replace(/\bhave (Jake|Jacob)\b/gi, 'have someone').replace(/\b(Jake|Jacob) will\b/gi, 'Someone from our team will')
      .replace(/\b(Jake|Jacob) can\b/gi, 'We can').replace(/\b(Jake|Jacob)'ll\b/gi, "We'll")
      .replace(/\b(Jake|Jacob) is\b/gi, 'Someone is').replace(/\b(point|send|get|give|put) (Jake|Jacob)\b/gi, '$1 us')
      .replace(/\bto (Jake|Jacob)\b/gi, 'to us').replace(/\bwith (Jake|Jacob)\b/gi, 'with us')
      .replace(/\b(Jake|Jacob)'s\b/gi, 'our').replace(/\b(Jake|Jacob),/gi, 'we,');
    if (/\b(Jake|Jacob)('s)?\b/i.test(t)) return { text: t, flags, hold: "The owner's name survived scrubbing." };
    flags.push('named the owner, rewrote it');
  }
  if (/\b(transfer|put you through|connect you)\b[\s\S]{0,40}\b(jake|jacob|owner)\b/i.test(t)) {
    return { text: t, flags, hold: 'It offered to put the customer through to the owner.' };
  }
  return { text: t, flags, hold: null };
}

/** Soft flags for the log, never holds. */
export function styleFlags(body) {
  const flags = [];
  const hits = BANNED.filter((p) => body.toLowerCase().includes(p));
  if (hits.length) flags.push('AI-flavored phrasing: ' + hits.join(', '));
  if ((body.match(/\?/g) || []).length > 1) flags.push('more than one question');
  if (/\bnot something we can (patch|fix|repair)|(tank|unit|heater|pipe|valve)\b[^.\n]{0,30}\b(is|are) (failing|bad|dead|shot|done)/i.test(body)) {
    flags.push('stated a cause as fact');
  }
  return flags;
}

/** All of the above in order, on a message body. */
export function guardBody(body, { prices, customerText }) {
  const a = cleanStyle(body);
  const b = checkPrices(a.text, { prices, customerText });
  if (b.hold) return { text: b.text, flags: [...a.flags, ...b.flags], hold: b.hold };
  const c = scrubOwner(b.text);
  return {
    text: c.text,
    flags: [...a.flags, ...b.flags, ...c.flags, ...styleFlags(c.text)],
    hold: c.hold,
    quoted: b.quoted || null,
  };
}

// Lisa answers texts, and tries to end up with an appointment.
//
// Why this exists: on 2026-10-26 at 20:32 a woman called Lianne texted the
// business line about a dead garbage disposal and a slow kitchen drain. It was
// logged, Jake was emailed, and nobody replied. She is still not a client and
// has no estimate. That is the whole business case. A text that sits unanswered
// is the same lost job as a Yelp message that sits unanswered, and the Yelp
// ledger already has one of those on record.
//
// The goal of a reply is NOT to be helpful in the abstract. It is to get to a
// booked visit at a known address, because that is the only thing that turns a
// text into money. Everything in the prompt below is bent toward that.
//
// Shape: the model gets the whole thread and returns JSON, one short reply plus
// whatever facts it has managed to pin down. When it has enough, this files the
// lead through the same create_estimate_from_lead() that Lisa's phone calls use,
// so an SMS booking lands on the calendar exactly like a phone booking.
//
// Raw fetch rather than the Anthropic SDK, matching api/ai.js and
// api/ai-estimator.js, which is also all this file needs.

import { fixFiledAddress, splitAddress, clientFieldsFrom } from './address-split.js';
import { otherChannelsBlock } from './client-history.js';
import { rpc, getSetting, sendTwilioSms } from './sms.js';
import { checkAppointment, speakSlot } from './availability-check.js';
import { telegramNotify } from './convert-estimate.js';
import { promisedFollowUp } from './promises.js';
import { serviceFees, serviceFeeRule } from './service-fees.js';
import { verifyAddress, addressQuestion, sameAddress, clientAddressFields } from './address-verify.js';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
// A reply that loses a job costs vastly more than the model does. At roughly
// 1.5K tokens in and 150 out this is under a cent a message.
const MODEL = 'claude-opus-5-5';
// Same origin the webhook is served from; see api/sms-inbound.js.
const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';

// Twilio handles STOP itself for a registered A2P campaign, but it only blocks
// the SEND. Generating a reply to someone who just opted out is both pointless
// and the kind of thing that gets a campaign reviewed, so stop earlier.
const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt-out)\b/i;
const HELP = /^\s*help\b/i;
const HELP_REPLY =
  'HI Grade Plumbing LLC, Oahu. Call or text 808-444-5450 for plumbing service. ' +
  'Reply STOP to opt out.';

// A loop between two autoresponders is the failure mode that burns money and
// credibility at the same time. Hard ceiling per thread.
const MAX_REPLIES_PER_THREAD = 12;
// Meant to block autoresponder loops, not a real person answering. A human
// replying 15-45 seconds after our text is normal, so keep this short.
const MIN_SECONDS_BETWEEN_REPLIES = 15;

function supabaseUrl() {
  return process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
}
function supabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
}

// create_estimate_from_lead validates against 'lead_secret', NOT 'sms_webhook_secret'.
// The two are different values. Using the wrong one causes every filing attempt to fail
// with FORBIDDEN inside the RPC, silently caught by the caller's try/catch. That is
// exactly why Jennifer's toilet emergency produced a reply ("You got it, see you at 4!")
// but no estimate, no client, and no calendar event.
async function leadSecret() {
  return process.env.LEAD_SECRET || (await getSetting('lead_secret'));
}

async function select(path) {
  const k = supabaseKey();
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    headers: { apikey: k, Authorization: `Bearer ${k}` },
  });
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

function hawaiiNow() {
  // The database runs UTC and every date Lisa says out loud is Hawaii time.
  // This is the same ten-hour correction migration 048 had to learn the hard way.
  const d = new Date(Date.now() - 10 * 3600 * 1000);
  return {
    iso: d.toISOString().slice(0, 10),
    pretty: d.toISOString().replace('T', ' ').slice(0, 16),
    weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()],
  };
}

function firstNameOf(name) {
  if (!name) return name;
  if (/\b(LLC|Inc|Corp|Construction|Contracting|Services|Co\.|Company)\b/i.test(name)) return name;
  return name.trim().split(/\s+/)[0];
}

// v1.76.0: openEstimateDate / Problem / Urgency were read here but never
// passed in. Every draft threw "openEstimateProblem is not defined" from
// v1.50.0 (2026-11-03) on, so text Lisa answered nobody for eight days.
function systemPrompt({ now, clientName, hasOpenEstimate, openEstimateDate, openEstimateProblem, openEstimateUrgency, catalog, fees = serviceFees([]), history = '' }) {
  return `You are Lisa, the front desk at HI Grade Plumbing LLC, a licensed plumbing company on Oahu, Hawaii. You are answering a TEXT MESSAGE. You are the same Lisa who answers the phone and replies on Yelp.

Right now it is ${now.weekday}, ${now.pretty} in Hawaii. Today's date is ${now.iso}. Work out every date from that and never guess a year.
${history ? `
${history}
` : ''}
YOUR ONE GOAL
Get to a booked visit at a known address. A text thread that ends without an appointment and an address is a failure, however pleasant it was. Everything below serves that.

To book a visit you need, in this order of importance:
1. What is wrong, in enough detail to send the right person with the right parts
2. The service address, including unit number — required before scheduling
3. A day and rough time that works for them
4. Their name

You usually already have their number, because they texted you.

HOW TO GET THERE
- ASK ONE THING PER MESSAGE. Two questions in one text gets one answer, usually the easier one. This is the single most important rule here.
- Lead toward the visit early. Once you understand roughly what is wrong, ask for the service address. Then once you have the address, offer day options.
- Good move: "We can take a look at that. What's the service address?" Then once you have it: "What day works better for you, tomorrow or Thursday?"
- ALWAYS confirm the service address before booking any appointment. Even for returning clients — addresses change, and the team cannot show up without it. If the address is not confirmed in this thread, ask for it before agreeing to a time.
- When they give you a day and time AND you already have the address, book it and confirm the day and time ("You're all set for Thursday at 9 AM."). It is a confirmed booking: never say the team will confirm. The system checks the calendar first and replaces your reply if the time is taken.
- If the customer is sharing contact information — email address, phone number, or address — without proposing a time, do NOT set appointment and do NOT propose a schedule. Just acknowledge the info warmly and move the conversation forward naturally.
- If they are vague or unsure about the problem, that is normal and it is not a reason to keep digging. Being unsure is a reason to come look. Say so: that is exactly what a visit is for.
- If they go quiet mid-thread, your next message should make it trivially easy to say yes to a time.

HOW YOU WRITE
- Short. One or two sentences, under 300 characters. This is a text, not an email.
- Warm, local, plain. Contractions. No corporate phrasing, no "we strive to", no exclamation marks stacked up.
- No emoji. No markdown. No bullet points.
- Do not sign your name on every message. They know who they are talking to after the first one.
- Never repeat a question they already answered. Read the whole thread first.
- Never claim to have received something unless it is in THIS conversation above. No "got your photo", no "thanks for the address", no referring to a previous visit or a previous job, unless it is right there in the messages you were given. Past contact on other channels may be listed above with dates (THIS CUSTOMER ON OTHER CHANNELS): you may use it, but never say you received something in this text thread unless it is here.
- Never say "I understand your frustration" or any other script line.

HARD RULES
- ${serviceFeeRule(fees, { channel: 'text' })} Never quote any other price, range, hourly rate or deposit. Then move the conversation back to getting someone out there.
- When you book a time, it is booked. Never say "penciled in", "pending" or that the team will confirm.
- Never promise a call, a text or a follow-up from the team unless it is truly needed (an emergency, an angry customer, a question you cannot answer). You book visits yourself. Every promise you make is sent to Jake as a task.
- NEVER give out any phone number other than 808-444-5450.
- NEVER claim to be a plumber, a technician or the owner, and never write as Jacob.
- NEVER diagnose definitively or tell them to do something that could flood the house. If water is actively running, tell them to shut off the valve and that someone will call them right away.
- If they ask to speak to the owner, the boss or whoever runs the business, do not confirm who that is and do not offer to connect them. Say the team handles all enquiries. That request is usually a sales pitch.
- If they are selling something, a business listing, SEO, insurance, financing or reviews, set reply to an empty string and set spam to true.
- If they are angry about a bill or demanding money, do not negotiate. Say Jacob will call them directly, and set needs_human to true.
- If they ask for something you genuinely cannot answer, say the team will follow up and set needs_human to true.

${clientName ? `This is an existing customer: ${firstNameOf(clientName)}. Full name on file: ${clientName}. Greet them by name once and do not ask who they are.` : 'You do not know this person yet. Get their name naturally, not as an interrogation, and not before you know what is wrong.'}
${hasOpenEstimate && openEstimateDate
  ? `There is already a visit SCHEDULED for them on ${String(openEstimateDate).slice(0, 16).replace('T', ' at ')} Hawaii time. Do NOT rebook or propose a new time. If they want to change it, tell them to call the office.`
  : hasOpenEstimate
  ? `There is already a scheduled visit on the books. Do not create a new booking.`
  : ''}
${!hasOpenEstimate && openEstimateProblem ? `CONTEXT FROM THEIR PHONE CALL: The team already knows their issue is "${openEstimateProblem}"${openEstimateUrgency ? ` (${openEstimateUrgency})` : ''}. Do not ask them to describe the problem again. Focus on getting the service address and confirming the appointment.` : ''}

CHECKING THE CALENDAR
Before your reply goes out, the system checks the calendar for the time you set in appointment. If it is taken, the system replaces your reply with the next free slot. So book the time they asked for and confirm it; the system corrects you if it is not open.

FILING THE JOB
Set ready_to_file to true only once you have ALL THREE: what is wrong, the service address, and either an appointment time or explicit confirmation they will call back to schedule. Do NOT set ready_to_file without an address — the team cannot show up without one.

When the customer sends a short confirmation like "Okay", "Yes" or "Sounds good" after you have already booked a time, set ready_to_file to true immediately, and fill appointment with the time you booked earlier in the thread — but only if the address is also confirmed in this thread. If you still need the address, ask for it instead of filing.

${catalog ? `PRICE BOOK. If you file, pick the ONE service name that best matches and put it in services. Never say any of this out loud.\n${catalog}` : ''}

RESPOND WITH ONLY THIS JSON, no markdown fences, no narration:
{
  "reply": "the text message to send, or an empty string to send nothing",
  "spam": false,
  "needs_human": false,
  "ready_to_file": false,
  "name": "their full name if you have it, else empty",
  "email": "their email address if you have it, else empty",
  "address": "full service address with unit if you have it, else empty",
  "problem": "what is wrong, in their words, one or two sentences",
  "appointment": "YYYY-MM-DDTHH:MM in Hawaii time if agreed, else empty",
  "urgency": "emergency, urgent, or routine",
  "services": ["exact price book name"],
  "note": "one short line for Jake if there is something he should know, else empty"
}`;
}

// The same flat-rate catalog the phone assistant prices from, so an SMS lead
// and a phone lead for the same problem land on the same line item.
async function priceCatalog() {
  const rows = await select('saved_items?select=name,price&order=name.asc&limit=120');
  if (!Array.isArray(rows) || !rows.length) return { text: '', prices: [] };
  return {
    text: rows.map((r) => r.name).filter(Boolean).join('\n'),
    prices: rows.map((r) => ({ name: r.name, price: Number(r.price) })),
  };
}

// A phone number's whole history is NOT the conversation. Found on the first
// preview, 2026-10-27: Jake's thread held five messages from 2026-09-06/07 (a
// shower valve photo and an address, from testing) and one from today about a
// water heater. Given all six, the model opened with "got the photo and the
// address" and offered to file the lead against the September address. Every
// word of that was true of September and wrong about today.
//
// So a thread ends at a gap. More than CONVERSATION_GAP_HOURS of silence means
// whatever came before was a different conversation and is not context for this
// one. Also capped at 14 days, because a reply that references a fortnight-old
// detail reads as creepy even when it is correct.
const CONVERSATION_GAP_HOURS = 12;
const THREAD_MAX_AGE_DAYS = 14;

async function thread(phone) {
  const since = new Date(Date.now() - THREAD_MAX_AGE_DAYS * 86400 * 1000).toISOString();
  const rows = await select(
    `client_messages?phone_number=eq.${encodeURIComponent(phone)}` +
    `&created_at=gte.${encodeURIComponent(since)}` +
    '&select=direction,body,created_at,media&order=created_at.asc&limit=40'
  );
  if (!Array.isArray(rows) || !rows.length) return [];

  // Walk back from the newest message and stop at the first big gap.
  let start = rows.length - 1;
  for (let i = rows.length - 1; i > 0; i--) {
    const gap = (new Date(rows[i].created_at) - new Date(rows[i - 1].created_at)) / 3600000;
    if (gap > CONVERSATION_GAP_HOURS) break;
    start = i - 1;
  }
  // What came before the gap is not the conversation, but it is context:
  // Zoe asked about an ice maker box, got estimate EST1209, and 21 hours later
  // "When are you available to come and install it?" got "What is it you'd
  // like us to install?" (2026-11-12). It rides along as background.
  const out = rows.slice(start);
  out.earlier = rows.slice(Math.max(0, start - 12), start);
  return out;
}

// Estimates already sent to this phone (last 60 days, not deleted): number,
// date, status and scope, so "when can you install it?" has an "it".
async function sentEstimatesBlock(phone) {
  const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
  if (last10.length !== 10) return '';
  try {
    const since = new Date(Date.now() - 60 * 86400e3).toISOString();
    const ests = await select(`invoices?client_info->>phone=ilike.${encodeURIComponent(fuzzyPhone(last10))}`
      + `&type=eq.estimate&deleted_at=is.null&status=in.(sent,pending,approved)&created_at=gte.${encodeURIComponent(since)}`
      + '&select=id,date,status,gcal_date,notes&order=created_at.desc&limit=3');
    if (!Array.isArray(ests) || !ests.length) return '';
    const ids = ests.map((e) => e.id).join(',');
    const items = await select(`invoice_items?invoice_id=in.(${encodeURIComponent(ids)})&select=invoice_id,name,description,qty&order=sort_order`);
    const lines = ests.map((e) => {
      const its = (Array.isArray(items) ? items : []).filter((i) => i.invoice_id === e.id)
        .map((i) => `${Number(i.qty) > 1 ? `${i.qty} x ` : ''}${i.name}${i.description ? ` (${String(i.description).replace(/\s*\n\s*/g, '; ').slice(0, 220)})` : ''}`);
      const signed = e.status === 'approved';
      return `- ${e.id}, sent ${e.date}, ${signed ? 'APPROVED' : 'not approved yet'}${e.gcal_date ? `, scheduled ${String(e.gcal_date).slice(0, 16).replace('T', ' at ')}` : ', not scheduled'}: ${its.join('; ') || 'no line items'}${e.notes ? `. Notes on it: ${String(e.notes).slice(0, 200)}` : ''}`;
    });
    return `ESTIMATES ALREADY SENT TO THIS CUSTOMER (the link to each is in the thread):
${lines.join('\n')}
When they say "it", "the job" or "the install", they mean this work. Never ask what they want done when an estimate above covers it.
If they want to schedule work from an estimate that is not approved yet: thank them, say the estimate needs their approval at the link first (it only takes a tap), and that Jacob will reach out to set a time once it is approved. If it is approved: say Jacob will reach out to get it on the calendar. Either way do NOT set appointment, do NOT offer specific times, and set needs_human to true so Jacob books it on that estimate.`;
  } catch { return ''; }
}

function earlierBlock(rows) {
  const e = (rows?.earlier || []).filter((r) => String(r.body || '').trim() && r.body !== '(no text)');
  if (!e.length) return '';
  return `EARLIER IN THIS TEXT THREAD (before a long break; background only, the conversation below is what you are answering):
${e.map((r) => `${r.direction === 'inbound' ? 'Customer' : 'Us'} (${String(r.created_at).slice(0, 10)}): ${String(r.body).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}`;
}

function asMessages(rows) {
  // Their texts are the user turns, ours are the assistant turns. Consecutive
  // same-role messages are legal and the API merges them.
  return rows
    .filter((r) => String(r.body || '').trim() && r.body !== '(no text)')
    .map((r) => ({
      role: r.direction === 'inbound' ? 'user' : 'assistant',
      content: String(r.body),
    }));
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

/**
 * Decide what Lisa would say next in a thread, without sending anything.
 * Exported so the preview path and the live path share one prompt.
 */
export async function draftReply({ phone, clientName, hasOpenEstimate, openEstimateDate, openEstimateProblem, openEstimateUrgency }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const rows = await thread(phone);
  const messages = asMessages(rows);
  if (!messages.length) return { skip: 'nothing in the thread to answer' };
  if (messages[messages.length - 1].role !== 'user') {
    return { skip: 'the last word in this thread is already ours' };
  }

  const { text: catalog, prices } = await priceCatalog();
  const res = await fetch(ANTHROPIC, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: systemPrompt({
        now: hawaiiNow(),
        clientName,
        hasOpenEstimate,
        openEstimateDate,
        openEstimateProblem,
        openEstimateUrgency,
        catalog,
        fees: serviceFees(prices),
        // Yelp, calls and emails for this number (migration 122). Texts are
        // excluded: the thread above already is the text conversation.
        history: [
          await otherChannelsBlock({ phone, exclude: 'text' }),
          earlierBlock(rows),
          await sentEstimatesBlock(phone),
        ].filter(Boolean).join('\n\n'),
      }),
      messages,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);

  // stop_reason has to be checked before reading content.
  if (json.stop_reason === 'refusal') return { skip: 'model declined this one' };
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = parseJson(text);
  if (!out) return { skip: 'could not parse the model output', raw: text.slice(0, 300) };

  out.reply = String(out.reply || '').trim();
  // A text over a segment and a half reads as a wall on a phone. The prompt
  // asks for under 300; this is the backstop, cut at a sentence end.
  if (out.reply.length > 320) {
    const cut = out.reply.slice(0, 320);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    out.reply = (stop > 160 ? cut.slice(0, stop + 1) : cut).trim();
  }
  out.usage = json.usage;

  // Never book a time the calendar has not cleared. The suggested slot is
  // offered in the reply only, not written to `appointment`: the customer has
  // not agreed to it yet, and the next turn can book it once they say yes.
  // Every address is looked up before it is recorded or booked (v1.78.0).
  // Verified: the clean Google form replaces what they typed. Close or not
  // found: the reply becomes the question, and nothing is filed this turn. A
  // suggestion we already put to them in this thread counts as confirmed once
  // the model still carries it, so a condo Google only half-matches does not
  // get asked about forever.
  out.address = String(out.address || '').trim();
  if (out.address) {
    const asked = rows.filter((r) => r.direction === 'outbound')
      .map((r) => (String(r.body || '').match(/is the service address (.+?)\?/i) || [])[1]).filter(Boolean);
    const confirmed = asked.find((a) => sameAddress(a, out.address));
    const v = confirmed ? { status: 'verified', formatted: confirmed } : await verifyAddress(out.address);
    out.address_check = v.status;
    if (v.status === 'verified') {
      out.address = v.formatted;
      if (v.line1) out.address_parts = { line1: v.line1, line2: v.unit || '', city: v.city || '', zip: v.zip || '' };
    } else if (v.status === 'error') {
      console.error('[sms-agent] address lookup failed, keeping it as typed:', v.reason);
      out.note = `${out.note ? `${out.note} ` : ''}Address not verified (lookup failed): ${out.address}`;
    } else {
      console.log('[sms-agent] address', v.status, v.reason || '', JSON.stringify(out.address));
      out.reply = addressQuestion(v, out.address);
      out.address = '';
      out.appointment = '';
      out.ready_to_file = false;
    }
  }

  out.appointment = String(out.appointment || '').trim();
  // A customer with a visit already on the books is never re-booked from a
  // text (the prompt tells them to call to change it). Without this, their
  // "thanks" echoed their own time back and the calendar check, finding their
  // own visit there, overwrote the reply with "We're booked up Tuesday"
  // (Michael, 2026-11-03: "Lisa, you lying AI"). Same fix as Yelp, v1.73.1.
  if (out.appointment && hasOpenEstimate) out.appointment = '';
  // Their own visit is never "taken" (Neil, 2026-11-12: booked for 3 PM, his
  // next text got "That time's taken, we have 4:30", and the 4:30 went out as
  // "firmly booked" while the calendar still said 3). Any outstanding job for
  // this phone at that start time is theirs, whatever client record it is on.
  if (out.appointment) {
    const own = await ownVisits(phone);
    if (own.some((t) => t === out.appointment.slice(0, 16))) out.appointment = '';
  }
  if (out.appointment) {
    const chk = await checkAppointment(out.appointment);
    out.availability = chk.status;
    if (chk.status === 'busy') {
      console.log('[sms-agent] requested time busy', out.appointment);
      const blockedDay = out.appointment ? speakSlot(out.appointment.length === 10
        ? out.appointment + 'T12:00' : out.appointment).split(' at ')[0] : null;
      const nextSlot = chk.next ? speakSlot(chk.next.start) : null;
      const nextDay = nextSlot ? nextSlot.split(' at ')[0] : null;
      const sameDay = blockedDay && nextDay && blockedDay === nextDay;
      out.appointment = '';
      out.reply = nextSlot
        ? (sameDay
          ? `That time's taken — we do have ${nextSlot} open. Does that work for you?`
          : `We're booked up ${blockedDay || 'that window'} — we do have ${nextSlot} open. Does that work for you?`)
        : `We're booked up ${blockedDay || 'that day'}. What other day works for you?`;
    } else if (chk.status === 'error') {
      console.error('[sms-agent] availability check failed, not booking:', chk.detail);
      out.appointment = '';
      out.reply = 'I could not confirm that time just yet. What day and time window is best for a callback from our team to lock it in?';
    }
    // Filing needs the problem plus an appointment or an address.
    if (!out.appointment && !String(out.address || '').trim()) out.ready_to_file = false;
  }
  // A booked visit is the only time Lisa may state. A reply naming any other
  // clock time is replaced with the real one.
  if (hasOpenEstimate && openEstimateDate) {
    const booked = speakSlot(String(openEstimateDate).slice(0, 16));
    const bookedTime = booked.split(' at ')[1].replace(/\s+/g, '').toLowerCase();
    const said = (out.reply.match(/\b\d{1,2}(?::\d{2})?\s?(?:AM|PM)\b/gi) || []).map((x) => x.replace(/\s+/g, '').toLowerCase());
    if (said.some((x) => x !== bookedTime)) {
      console.log('[sms-agent] reply named a time other than the booked visit, replaced', said, booked);
      out.reply = `You're set for ${booked}. If you need to change it, give us a call at 808-444-5450. Mahalo!`;
      out.appointment = '';
    }
  }
  return out;
}

/** Start times ('YYYY-MM-DDTHH:MM') of outstanding visits for this phone. */
async function ownVisits(phone) {
  const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
  if (last10.length !== 10) return [];
  try {
    const rows = await select(`invoices?client_info->>phone=ilike.${encodeURIComponent(fuzzyPhone(last10))}`
      + '&deleted_at=is.null&status=eq.outstanding&gcal_date=not.is.null&select=gcal_date&limit=10');
    return (Array.isArray(rows) ? rows : []).map((r) => String(r.gcal_date).slice(0, 16));
  } catch { return []; }
}

// "8083833200" -> "*808*383*3200*", so "(808) 383-3200" and "+18083833200" both match.
const fuzzyPhone = (d) => `*${d.slice(0, 3)}*${d.slice(3, 6)}*${d.slice(6)}*`;

/**
 * The live path: called from the inbound webhook after the message is logged.
 * Returns a short description of what it did, for the log line.
 */
export async function autoReply({ phone, body, clientName, clientId, secret }) {
  if (String(await getSetting('sms_autoreply_enabled') || '').toLowerCase() !== 'true') {
    return 'autoreply off';
  }
  if (clientId) {
    const [c] = await select(`clients?id=eq.${encodeURIComponent(clientId)}&select=lisa_autoreply`);
    if (c && c.lisa_autoreply === false) return 'lisa autoreply disabled for this client';
  }
  if (OPT_OUT.test(body || '')) return 'opt-out, not replying';
  if (HELP.test(body || '')) {
    await sendTwilioSms({ to: phone, body: HELP_REPLY });
    await logOutbound({ secret, phone, body: HELP_REPLY });
    return 'sent HELP reply';
  }

  const rows = await thread(phone);
  const ours = rows.filter((r) => r.direction === 'outbound');
  if (ours.length >= MAX_REPLIES_PER_THREAD) return `thread cap reached (${ours.length})`;
  const last = rows[rows.length - 1];
  const lastOurs = ours[ours.length - 1];
  // Short customer confirmations (Okay, Yes, Sounds good, etc.) should never
  // be blocked by the cooldown: they are the customer agreeing to the booking.
  const isConfirmation = /^(ok|okay|yes|yep|yeah|sure|sounds good|great|perfect|works|confirmed|got it|see you( (then|tomorrow|wednesday|thursday|friday|saturday|sunday|monday|tuesday|\w+day))?|that works|that's fine|that's good|thank|mahalo|aloha|👍|✓)[\s!.]*$/i.test((body || '').trim());
  // Only bypass when our last text actually penciled in a time.
  const hasAppointmentPenciled = /pencil|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s*(am|pm)/i.test(lastOurs?.body || '');
  if (isConfirmation && hasAppointmentPenciled) {
    // bypass cooldown, fall through to draftReply, which sets ready_to_file
  } else if (lastOurs && (Date.now() - new Date(lastOurs.created_at).getTime()) / 1000 < MIN_SECONDS_BETWEEN_REPLIES) {
    return 'we only just texted them';
  }
  if (last && last.direction === 'outbound') return 'last word is already ours';

  // An open job means the conversation belongs to that job, not to a new lead.
  // Split into two states: has a visit scheduled vs open but unscheduled.
  // Unscheduled: Lisa should collect address + time and update the existing job.
  // Scheduled: Lisa should not rebook — just confirm the date.
  let hasOpenEstimate = false;
  let openEstimateId = null;
  let openEstimateScheduled = false;
  let openEstimateDate = null;
  let openEstimateProblem = null;
  let openEstimateUrgency = null;
  if (clientId) {
    const open = await select(
      `invoices?client_id=eq.${clientId}&deleted_at=is.null&status=eq.outstanding&select=id,gcal_date,visits,internal_notes,urgency&order=created_at.desc&limit=1`
    );
    if (Array.isArray(open) && open.length > 0) {
      hasOpenEstimate = true;
      openEstimateId = open[0].id;
      const hasVisit = open[0].gcal_date ||
        (Array.isArray(open[0].visits) && open[0].visits.length > 0);
      openEstimateScheduled = !!hasVisit;
      openEstimateDate = open[0].gcal_date ||
        (Array.isArray(open[0].visits) && open[0].visits[0]?.start) || null;
      // Pull problem/urgency from the estimate so the SMS agent knows what
      // was collected on the phone call and doesn't re-ask.
      openEstimateProblem = String(open[0].internal_notes || '').trim() || null;
      openEstimateUrgency = String(open[0].urgency || '').trim() || null;
    }
  }

  // The thread's client record can differ from the job's (Neil had one from
  // October under another number) or not exist yet. Fall back to the phone on
  // the job, scheduled visits only.
  if (!openEstimateScheduled) {
    const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
    const byPhone = last10.length === 10 ? await select(
      `invoices?client_info->>phone=ilike.${encodeURIComponent(fuzzyPhone(last10))}&deleted_at=is.null&status=eq.outstanding`
      + '&gcal_date=not.is.null&select=id,gcal_date&order=created_at.desc&limit=1').catch(() => []) : [];
    if (Array.isArray(byPhone) && byPhone[0]) {
      hasOpenEstimate = true;
      openEstimateScheduled = true;
      openEstimateId = openEstimateId || byPhone[0].id;
      openEstimateDate = byPhone[0].gcal_date;
    }
  }

  const out = await draftReply({ phone, clientName, hasOpenEstimate: openEstimateScheduled, openEstimateDate, openEstimateProblem, openEstimateUrgency });
  if (out.skip) return out.skip;
  if (out.spam) return 'classified as spam, not replying';
  if (!out.reply) return 'model chose to say nothing';

  await sendTwilioSms({ to: phone, body: out.reply });
  await logOutbound({ secret, phone, body: out.reply });

  // needs_human used to reach only the log line. It, and any reply that
  // promises a call or a follow-up, is one Telegram to Jake (v1.76.0).
  const promise = promisedFollowUp(out.reply);
  if (out.needs_human || promise) {
    const who = out.name || clientName || phone;
    const theyWrote = String(body || '').slice(0, 200);
    await telegramNotify(
      (out.needs_human ? `Text from ${who} needs you.` : `Lisa promised ${who} a follow-up by text. Do it, or it is a broken promise.`) +
      (out.note ? `\n${String(out.note).slice(0, 300)}` : '') +
      (promise ? `\nShe said: "${promise}"` : '') +
      `\nThey wrote: "${theyWrote}"\n${phone}`,
    ).catch((e) => console.error('[sms-agent] telegram failed:', e.message || e));
  }

  // Progressive save: runs every turn, so a name given on turn 2 survives a hangup.
  await saveProgressiveData(phone, clientId, out);

  let filed = null;
  let estimatorDispatch = null;
  if (out.ready_to_file) {
    try {
      // Re-check for concurrent races (see comment below).
      let alreadyFiled = false;
      if (clientId) {
        const recheck = await select(
          `invoices?client_id=eq.${clientId}&deleted_at=is.null&status=eq.outstanding&select=id,gcal_date,visits&order=created_at.desc&limit=1`
        );
        if (Array.isArray(recheck) && recheck.length > 0) {
          const existing = recheck[0];
          const hasVisit = existing.gcal_date ||
            (Array.isArray(existing.visits) && existing.visits.length > 0);
          if (hasVisit) {
            // Already scheduled — don't create or update anything.
            alreadyFiled = true;
            console.log('[sms-agent] estimate already scheduled, skipping file');
          } else {
            // Unscheduled estimate exists — update it with address/appointment
            // instead of creating a duplicate.
            const patch = {};
            if (out.address) {
              patch.job_address = jobAddress(out);
            }
            if (out.appointment) patch.gcal_date = out.appointment;
            if (out.name) patch.client_name = out.name;
            if (Object.keys(patch).length) {
              const sbUrl = supabaseUrl();
              const sbKey = supabaseKey();
              await fetch(`${sbUrl}/rest/v1/invoices?id=eq.${encodeURIComponent(existing.id)}`, {
                method: 'PATCH',
                headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify(patch),
              });
            }
            filed = { estimate_id: existing.id };
            alreadyFiled = true;
            console.log('[sms-agent] updated existing unscheduled estimate', existing.id);
          }
        }
      }
      if (!alreadyFiled) {
        const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
        const since = new Date(Date.now() - 120000).toISOString();
        const recentByPhone = await select(
          `invoices?client_info->>phone=ilike.*${last10}&created_at=gte.${encodeURIComponent(since)}&deleted_at=is.null&status=eq.outstanding&select=id&limit=1`
        );
        if (Array.isArray(recentByPhone) && recentByPhone.length > 0) {
          console.log('[sms-agent] estimate filed concurrently by phone match, skipping');
          alreadyFiled = true;
        }
      }
      if (!alreadyFiled) {
      // settings.lead_secret, NOT settings.sms_webhook_secret. They are
      // different values. Passing the SMS webhook secret here causes a silent
      // FORBIDDEN failure inside the RPC every time.
      const lsecret = await leadSecret();
      filed = await rpc('create_estimate_from_lead', {
        p_secret: lsecret,
        p_name: out.name || clientName || 'Text lead - no name given',
        p_phone: phone,
        p_caller_id: phone,
        p_address: out.address || null,
        p_problem: out.problem || String(body).slice(0, 500),
        p_urgency: out.urgency || null,
        p_services: Array.isArray(out.services) && out.services.length ? out.services : null,
        p_appointment: out.appointment || null,
        p_heard_from: 'text message',
        p_lead_channel: 'sms',
      });
      // One-line address from the RPC -> street / unit / city / zip.
      if (filed?.estimate_id) await fixFiledAddress(filed.estimate_id);
      } // end else (not alreadyFiled)
    } catch (e) {
      // The reply already went out, which is the part the customer sees. A
      // failed file is Jake's email alert plus this log line, not a dropped lead.
      console.error('[sms-agent] file failed:', e.message || e);
    }
  }

  // After a successful filing: push to Google Calendar, then dispatch the
  // AI ballpark estimator. Both are best-effort; a failure here never undoes
  // the reply that already went out.
  if (filed?.estimate_id) {
    // trg_push_lead_appointment (migration 033) fires on INSERT for source='ai_lead'
    // and handles the calendar push via the Apps Script webhook. But that trigger
    // runs asynchronously through pg_net. push_invoice_to_calendar() is a
    // synchronous belt-and-suspenders: it creates the event immediately and writes
    // the gcal_event_id back into the visits array so the app can find and move it.
    // It is a no-op if the estimate already has a gcal_event_id, and (migration
    // 119) while another push for it is still in flight. Note pg_net is async:
    // this queues the push, it does not wait for the event id.
    try {
      await rpc('push_invoice_to_calendar', { p_id: filed.estimate_id });
      console.log('[sms-agent] calendar push ok', filed.estimate_id);
    } catch (e) {
      console.error('[sms-agent] calendar push failed (non-fatal):', e.message || e);
    }
  }

  // Web / SMS / Yelp leads get an AI ballpark, but only after Jake approves it
  // on Telegram (see ./lead-estimate.js). Dispatched to /api/ai-estimator so it
  // runs in its own invocation; the route answers 202 straight away. Never
  // allowed to fail the reply that already went out.
  if (filed?.estimate_id) {
    try {
      const r = await fetch(`${APP_URL}/api/ai-estimator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ task: 'lead_estimate', invoice_id: filed.estimate_id, problem: out.problem || '' }),
        signal: AbortSignal.timeout(3000),
      });
      estimatorDispatch = r.status;
    } catch (e) {
      estimatorDispatch = `failed: ${e.name || e.message}`;
      console.error('[sms-agent] estimator dispatch failed:', e.message || e);
    }
  }

  return `replied (${out.reply.length} chars)` +
    (filed ? `, filed ${filed.estimate_id || filed.id || 'lead'}` : '') +
    (estimatorDispatch ? `, estimator ${estimatorDispatch}` : '') +
    (out.needs_human ? ', FLAGGED FOR JAKE' : '');
}

/**
 * Save whatever the model pinned down this turn, without waiting for
 * ready_to_file. Every write is only-if-blank, so it can never overwrite
 * something Jake or the customer already set. Never throws: the reply has
 * already gone out.
 */
// The invoice's job_address from a verified lookup: street on line1, unit on
// line2, city and zip in their own fields (the app's address model). Falls back
// to the whole string on line1 when the lookup could not run.
function jobAddress(out) {
  const a = out.address_parts;
  return a
    ? { label: 'Service address', line1: a.line1, line2: a.line2 || '', line3: '', city: a.city || '', state: 'HI', zip: a.zip || '' }
    : { label: 'Service address', line1: out.address, line2: '', line3: '', city: '', state: 'HI', zip: '' };
}

async function saveProgressiveData(phone, clientId, out) {
  try {
    if (!clientId) return;
    const base = supabaseUrl();
    const key = supabaseKey();
    const read = { apikey: key, Authorization: `Bearer ${key}` };
    const write = { ...read, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const name = String(out.name || '').trim();
    const email = String(out.email || '').trim();
    const address = String(out.address || '').trim();
    const problem = String(out.problem || '').trim();

    // Update client record with any new info we just learned.
    const clientPatch = {};
    if (name) {
      const [c] = await select(`clients?id=eq.${clientId}&select=name,email`);
      const existing = (c?.name || '').trim();
      // Replace placeholder names, all-caps single-word names, or names that
      // are clearly less complete than what the customer just gave us.
      const looksIncomplete = !existing
        || /missed call|no name|text lead/i.test(existing)
        || (existing === existing.toUpperCase() && !existing.includes(' '))
        || (name.includes(' ') && !existing.includes(' '));
      if (looksIncomplete) clientPatch.name = name;
      if (email && !c?.email) clientPatch.email = email;
    } else if (email) {
      const [c] = await select(`clients?id=eq.${clientId}&select=email`);
      if (!c?.email) clientPatch.email = email;
    }
    if (address) {
      const [c] = await select(`clients?id=eq.${clientId}&select=address1`);
      if (!c?.address1) Object.assign(clientPatch, clientAddressFields(out.address_parts) || (splitAddress(address) && clientFieldsFrom(splitAddress(address))) || { address1: address });
    }
    if (Object.keys(clientPatch).length) {
      await fetch(`${base}/rest/v1/clients?id=eq.${clientId}`, {
        method: 'PATCH', headers: write, body: JSON.stringify(clientPatch),
      });
      console.log(`[sms-agent] progressive: updated client ${clientId}: ${Object.keys(clientPatch).join(', ')}`);
    }

    if (address || problem) {
      // Newest estimate for this client in the last 7 days. Estimates only, so
      // a real invoice is never touched.
      const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      const [inv] = await select(
        `invoices?client_id=eq.${clientId}&type=eq.estimate&deleted_at=is.null` +
        `&created_at=gte.${encodeURIComponent(cutoff)}&select=id,job_address,internal_notes&order=created_at.desc&limit=1`
      );
      if (inv) {
        const patch = {};
        if (address && !inv.job_address?.line1) {
          patch.job_address = jobAddress(out);
        }
        if (problem && !(inv.internal_notes || '').trim()) patch.internal_notes = problem;
        if (Object.keys(patch).length) {
          await fetch(`${base}/rest/v1/invoices?id=eq.${encodeURIComponent(inv.id)}`, {
            method: 'PATCH', headers: write, body: JSON.stringify(patch),
          });
          console.log(`[sms-agent] progressive: saved ${Object.keys(patch).join(', ')} to ${inv.id}`);
        }
      }
    }
  } catch (e) {
    console.error('[sms-agent] progressive save failed:', e.message || e);
  }
}

/**
 * Every outbound text goes in client_messages. Nothing was logging these, so
 * as of 2026-10-27 the stored threads showed only the customer's half, which
 * also meant this agent could not see what it had already said.
 */
export async function logOutbound({ secret, phone, body }) {
  try {
    await rpc('log_client_message', {
      p_secret: secret,
      p_phone: phone,
      p_direction: 'outbound',
      p_body: String(body),
      // Named explicitly on purpose. Leaving these off is what made every
      // outbound log fail with PGRST203 until migration 069; being explicit
      // keeps this working even if a second overload is ever added back.
      p_call_id: null,
      p_media: null,
    });
  } catch (e) {
    console.error('[sms-agent] logging our own message failed:', e.message || e);
  }
}

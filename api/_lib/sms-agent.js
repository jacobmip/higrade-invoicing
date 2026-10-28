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

import { rpc, getSetting, sendTwilioSms } from './sms.js';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
// A reply that loses a job costs vastly more than the model does. At roughly
// 1.5K tokens in and 150 out this is under a cent a message.
const MODEL = 'claude-opus-5';
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
// If we just spoke, let them answer before speaking again.
const MIN_SECONDS_BETWEEN_REPLIES = 45;

function supabaseUrl() {
  return process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
}
function supabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
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

function systemPrompt({ now, clientName, hasOpenEstimate, catalog }) {
  return `You are Lisa, the front desk at HI Grade Plumbing LLC, a licensed plumbing company on Oahu, Hawaii. You are answering a TEXT MESSAGE. You are the same Lisa who answers the phone and replies on Yelp.

Right now it is ${now.weekday}, ${now.pretty} in Hawaii. Today's date is ${now.iso}. Work out every date from that and never guess a year.

YOUR ONE GOAL
Get to a booked visit at a known address. A text thread that ends without an appointment and an address is a failure, however pleasant it was. Everything below serves that.

To book a visit you need, in this order of importance:
1. What is wrong, in enough detail to send the right person with the right parts
2. A day and rough time that works for them
3. The service address, including unit number
4. Their name

You usually already have their number, because they texted you.

HOW TO GET THERE
- ASK ONE THING PER MESSAGE. Two questions in one text gets one answer, usually the easier one. This is the single most important rule here.
- Lead toward the visit early. Once you understand roughly what is wrong, ask for a day rather than asking more diagnostic questions. You do not need to solve it over text, you need to get there.
- Good move: "We can take a look at that. What day works better for you, tomorrow or Thursday?" Two concrete options beat "when would you like to come out", because an open question gets "idk".
- When they give you a day and time, say you will pencil it in and the team will confirm. Then ask for the address. The address is the last thing you need and the easiest one to get once they have agreed to a time.
- If they are vague or unsure about the problem, that is normal and it is not a reason to keep digging. Being unsure is a reason to come look. Say so: that is exactly what a visit is for.
- If they go quiet mid-thread, your next message should make it trivially easy to say yes to a time.

HOW YOU WRITE
- Short. One or two sentences, under 300 characters. This is a text, not an email.
- Warm, local, plain. Contractions. No corporate phrasing, no "we strive to", no exclamation marks stacked up.
- No emoji. No markdown. No bullet points.
- Do not sign your name on every message. They know who they are talking to after the first one.
- Never repeat a question they already answered. Read the whole thread first.
- Never claim to have received something unless it is in THIS conversation above. No "got your photo", no "thanks for the address", no referring to a previous visit or a previous job, unless it is right there in the messages you were given. You are seeing only the current conversation, not their history, so anything not shown did not happen as far as you know.
- Never say "I understand your frustration" or any other script line.

HARD RULES
- NEVER quote a price, a range, an hourly rate, a trip fee or a deposit. Not even "usually around". If they ask what it costs, say the team will confirm the price once they see it, and move the conversation back to getting someone out there.
- NEVER promise a firm appointment. You pencil it in, the team confirms.
- NEVER give out any phone number other than 808-444-5450.
- NEVER claim to be a plumber, a technician or the owner, and never write as Jacob.
- NEVER diagnose definitively or tell them to do something that could flood the house. If water is actively running, tell them to shut off the valve and that someone will call them right away.
- If they ask to speak to the owner, the boss or whoever runs the business, do not confirm who that is and do not offer to connect them. Say the team handles all enquiries. That request is usually a sales pitch.
- If they are selling something, a business listing, SEO, insurance, financing or reviews, set reply to an empty string and set spam to true.
- If they are angry about a bill or demanding money, do not negotiate. Say Jacob will call them directly, and set needs_human to true.
- If they ask for something you genuinely cannot answer, say the team will follow up and set needs_human to true.

${clientName ? `This is an existing customer: ${clientName}. Greet them by name once and do not ask who they are.` : 'You do not know this person yet. Get their name naturally, not as an interrogation, and not before you know what is wrong.'}
${hasOpenEstimate ? 'There is ALREADY an open job on file for them, so do NOT set ready_to_file. Anything new they tell you goes to the office instead.' : ''}

FILING THE JOB
Set ready_to_file to true only once you have BOTH what is wrong AND either an appointment time or an address. Partial is fine after that; the office fills the rest. Do not wait for everything.

${catalog ? `PRICE BOOK. If you file, pick the ONE service name that best matches and put it in services. Never say any of this out loud.\n${catalog}` : ''}

RESPOND WITH ONLY THIS JSON, no markdown fences, no narration:
{
  "reply": "the text message to send, or an empty string to send nothing",
  "spam": false,
  "needs_human": false,
  "ready_to_file": false,
  "name": "their full name if you have it, else empty",
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
  const rows = await select('saved_items?select=name&order=name.asc&limit=120');
  if (!Array.isArray(rows) || !rows.length) return '';
  return rows.map((r) => r.name).filter(Boolean).join('\n');
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
  return rows.slice(start);
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
export async function draftReply({ phone, clientName, hasOpenEstimate }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const rows = await thread(phone);
  const messages = asMessages(rows);
  if (!messages.length) return { skip: 'nothing in the thread to answer' };
  if (messages[messages.length - 1].role !== 'user') {
    return { skip: 'the last word in this thread is already ours' };
  }

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
        catalog: await priceCatalog(),
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
  return out;
}

/**
 * The live path: called from the inbound webhook after the message is logged.
 * Returns a short description of what it did, for the log line.
 */
export async function autoReply({ phone, body, clientName, clientId, secret }) {
  if (String(await getSetting('sms_autoreply_enabled') || '').toLowerCase() !== 'true') {
    return 'autoreply off';
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
  if (lastOurs && (Date.now() - new Date(lastOurs.created_at).getTime()) / 1000 < MIN_SECONDS_BETWEEN_REPLIES) {
    return 'we only just texted them';
  }
  if (last && last.direction === 'outbound') return 'last word is already ours';

  // An open job means the conversation belongs to that job, not to a new lead.
  let hasOpenEstimate = false;
  if (clientId) {
    const open = await select(
      `invoices?client_id=eq.${clientId}&deleted_at=is.null&status=eq.outstanding&select=id&limit=1`
    );
    hasOpenEstimate = Array.isArray(open) && open.length > 0;
  }

  const out = await draftReply({ phone, clientName, hasOpenEstimate });
  if (out.skip) return out.skip;
  if (out.spam) return 'classified as spam, not replying';
  if (!out.reply) return 'model chose to say nothing';

  await sendTwilioSms({ to: phone, body: out.reply });
  await logOutbound({ secret, phone, body: out.reply });

  let filed = null;
  let estimatorDispatch = null;
  if (out.ready_to_file && !hasOpenEstimate) {
    try {
      filed = await rpc('create_estimate_from_lead', {
        p_secret: secret,
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
    } catch (e) {
      // The reply already went out, which is the part the customer sees. A
      // failed file is Jake's email alert plus this log line, not a dropped lead.
      console.error('[sms-agent] file failed:', e.message || e);
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

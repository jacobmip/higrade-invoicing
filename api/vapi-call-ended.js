// /api/vapi-call-ended
// Vapi's end-of-call-report webhook. This is the URL the Vapi Composer asked
// for as "the endpoint for a post call event".
//
// Sends the follow-up SMS asking the caller for their service address, email
// and photos, then logs it against the client record.
//
// A2P 10DLC STATUS: the send is gated behind settings.sms_outbound_enabled,
// which is 'false'. Verified against the Twilio API on 2026-08-24: zero brand
// registrations, zero messaging services, and the only message this account
// ever sent came back 'undelivered' with error 30034. Turning this on before
// A2P clears produces silent failures that look like success, because Twilio
// returns 201 and the carrier drops it afterwards.
//
// Flip settings.sms_outbound_enabled to 'true' once A2P is approved. No
// redeploy needed. Until then this route still returns 200 to Vapi and
// reports what it skipped, so the webhook can be wired up now.
//
// Security: Vapi lets you set custom headers on a server URL. Send
// x-webhook-secret matching SMS_WEBHOOK_SECRET, or append ?k=<secret>.

import {
  rpc, getSetting, readBody, fullUrl, webhookSecret, secretMatches, sendTwilioSms,
  alreadySentMessage, recordSmsSnapshot, supabaseUrl,
} from './_lib/sms.js';
import { recordCall, handleRecordingRequest } from './_lib/call-recording.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

// Same origin this route is served from. Hardcoded rather than derived from
// the request so a Vapi retry hitting a preview deployment still mails through
// production.
const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';

// Must match the registered A2P brand name and the campaign sample message
// EXACTLY. A sample that does not match what is actually sent is the most
// common reason a campaign gets rejected, and a mismatch found after approval
// means re-submitting.
//
// "HI Grade Plumbing", not "High Grade". The voice rule is the other way round
// on purpose: Lisa SAYS "High Grade" so callers hear the word "high" rather
// than the letters H-I, but everything WRITTEN uses the legal name. Every
// email path already did this; this constant was the only place that did not.
// This is the FIRST message a customer receives, sent after a call they
// placed. It carries STOP; carriers also expect HELP on an initial message, but
// Jake chose this wording (2026-10-28), and Twilio answers HELP on its own.
const KICKOFF =
  'Aloha! Mahalo for calling HI Grade Plumbing. To help us give you an accurate ' +
  'estimate, please send your service address and any photos or videos of the ' +
  'issue. Send us a photo and we can give you a free ballpark estimate right ' +
  'away. Reply STOP to opt out.';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// Vapi nests the payload differently across event shapes; check the documented
// spots rather than assuming one.
function extractDirection(p) {
  const m = p?.message || p || {};
  const type = m?.call?.type || p?.call?.type || null;
  const dir = m?.call?.direction || p?.call?.direction || null;
  return type === 'outboundPhoneCall' || dir === 'outbound' ? 'outbound' : 'inbound';
}

function extractCaller(p) {
  const m = p?.message || p || {};
  // Outbound: the customer is the party we dialled, always at call.customer.
  // Fallbacks below could land on our own number.
  if (extractDirection(p) === 'outbound') {
    const n = m?.call?.customer?.number || m?.customer?.number || p?.customer?.number;
    if (n) return n;
  }
  return (
    m?.customer?.number ||
    m?.call?.customer?.number ||
    p?.customer?.number ||
    m?.phoneNumber?.number ||
    null
  );
}

function extractCallId(p) {
  const m = p?.message || p || {};
  return m?.call?.id || m?.callId || p?.call?.id || null;
}

function extractType(p) {
  const m = p?.message || p || {};
  return m?.type || p?.type || null;
}

function extractTranscript(p) {
  const m = p?.message || p || {};
  return m?.artifact?.transcript || m?.transcript || m?.call?.transcript || null;
}

function extractSummary(p) {
  const m = p?.message || p || {};
  return m?.analysis?.summary || m?.summary || null;
}

// The caller's name, from the structured analysis on Lisa's assistant
// (analysisPlan.structuredDataPlan, field caller_name). Before 2026-10-27 the
// name was never passed to capture_abandoned_call, so every rescued lead was
// filed as 'Missed call - no name given' even after four minutes of spelling
// it out. Returns null rather than guessing: the SQL side keeps a known
// client's real name when none arrives.
function extractName(p) {
  const m = p?.message || p || {};
  const sd = m?.analysis?.structuredData || m?.call?.analysis?.structuredData;
  const n = typeof sd?.caller_name === 'string' ? sd.caller_name.trim() : '';
  if (!n || n.length > 80 || /^(unknown|not given|n\/a|none|null)$/i.test(n)) return null;
  return n;
}

// True when Lisa handed the caller to Jacob and the handoff was not cancelled.
// A cancelled or declined transfer returns the call to Lisa, who carries on and
// files the lead herself (result text seen so far: "Transfer cancelled."). The
// success result text has not been observed yet, so this keys on the tool call
// being present and not reporting cancellation, and errs towards the old label.
function extractTransferred(p) {
  const m = p?.message || p || {};
  const msgs = m?.artifact?.messages || m?.messages || m?.call?.messages || [];
  if (!Array.isArray(msgs)) return false;
  const attempted = msgs.some(x =>
    (x?.toolCalls || []).some(t => t?.function?.name === 'transferToJake'));
  if (!attempted) return false;
  const results = msgs.filter(x => x?.name === 'transferToJake' && x?.result != null);
  if (!results.length) return false;
  return !results.some(x => /cancel|fail|declin|no.?answer|busy|voicemail/i.test(String(x.result)));
}

function extractSeconds(p) {
  const m = p?.message || p || {};
  const started = m?.startedAt || m?.call?.startedAt;
  const ended   = m?.endedAt   || m?.call?.endedAt;
  if (started && ended) {
    const s = Math.round((new Date(ended) - new Date(started)) / 1000);
    if (Number.isFinite(s) && s > 0) return s;
  }
  const d = m?.durationSeconds ?? m?.call?.durationSeconds;
  return Number.isFinite(d) ? Math.round(d) : null;
}

// True when Lisa called createEstimate during the call.
function extractFiledEstimate(p) {
  const m = p?.message || p || {};
  const msgs = m?.artifact?.messages || m?.messages || m?.call?.messages || [];
  if (!Array.isArray(msgs)) return false;
  return msgs.some(x => (x?.toolCalls || []).some(t => t?.function?.name === 'createEstimate'));
}

// Decides from the transcript whether an outbound call earns the drip. The
// reason is logged and returned in the response; sms_drip_queue has no column
// for it and the schema is deliberately unchanged.
const OPT_OUT_TERMS = [
  "don't call", 'do not call', 'stop calling', 'leave me alone',
  'not interested', 'remove me', 'take me off', 'do not contact',
  'already have a plumber', 'already hired', 'found someone', 'got someone',
  'wrong number', 'stop texting', 'unsubscribe',
];

function shouldQueueDrip(message) {
  const endedReason = message?.endedReason || message?.call?.endedReason || '';
  const msgs = message?.artifact?.messages || [];

  // Never drip if an estimate was filed.
  if (extractFiledEstimate({ message })) return { drip: false, reason: 'estimate_filed' };

  const customerText = (Array.isArray(msgs) ? msgs : [])
    .filter(m => m?.role === 'user')
    .map(m => m.message || m.content || '')
    .join(' ')
    .toLowerCase();

  if (OPT_OUT_TERMS.some(t => customerText.includes(t))) {
    return { drip: false, reason: 'customer_opted_out' };
  }

  // Voicemail or no answer: they never heard anything, so always drip.
  if (['voicemail', 'no-answer', 'customer-did-not-answer'].includes(endedReason)) {
    return { drip: true, reason: 'voicemail_or_no_answer' };
  }

  // Under 5 meaningful words is an immediate hang-up or a wrong number.
  const wordCount = customerText.split(/\s+/).filter(w => w.length > 1).length;
  if (wordCount < 5) return { drip: false, reason: 'no_engagement' };

  return { drip: true, reason: 'engaged_no_booking' };
}

// Outbound: the party we dialled, with the "there" fallback the drip texts use.
function extractCustomerName(p) {
  const m = p?.message || p || {};
  const n = m?.call?.customer?.name;
  return typeof n === 'string' && n.trim() && n.trim().length <= 80 ? n.trim() : 'there';
}

const DRIP_PHONE = '808-444-5450';
const dripMessages = name => [
  `Aloha ${name}! This is Lisa from HI Grade Plumbing. Sorry we got cut off. If you still need help with your plumbing issue, just reply here or call ${DRIP_PHONE}. Mahalo! Reply STOP to opt out.`,
  `Hi ${name}, just checking in from HI Grade Plumbing. Plumbing problems can be stressful — we are here whenever you are ready. Reply here or call ${DRIP_PHONE}. Reply STOP to opt out.`,
  `Aloha ${name}, one last check-in from HI Grade Plumbing. If you still need a hand, reply or call ${DRIP_PHONE}. If you are all set, wishing you a great day! Reply STOP to opt out.`,
];

// Queues the given message indexes (1-3) at 0h / 24h / 48h. Returns null when
// a Vapi retry of the same report already started a drip for this call.
async function queueDrip({ to, callId, name, indexes }) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Server not configured');
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
  const table = `${supabaseUrl()}/rest/v1/sms_drip_queue`;

  if (callId) {
    const dup = await fetch(`${table}?call_id=eq.${encodeURIComponent(callId)}&select=id&limit=1`, { headers });
    const rows = dup.ok ? await dup.json().catch(() => []) : [];
    if (rows?.length) return null;
  }

  const msgs = dripMessages(name);
  const now = Date.now();
  const at = i => new Date(now + (i - 1) * 24 * 3600e3).toISOString();
  const ins = await fetch(table, {
    method: 'POST', headers,
    body: JSON.stringify(indexes.map(i => ({
      phone: to, call_id: callId, message_index: i, message: msgs[i - 1], scheduled_at: at(i),
    }))),
  });
  if (!ins.ok) throw new Error(`queue insert ${ins.status}: ${(await ins.text()).slice(0, 200)}`);
  return { queued: indexes.length };
}

// Outbound: message 1 now, messages 2 and 3 queued for 24h and 48h. With
// sms_outbound_enabled off, message 1 is skipped but 2 and 3 are still queued
// (the sender script re-checks the setting before each send).
async function startDrip({ to, callId, name, secret }) {
  const q = await queueDrip({ to, callId, name, indexes: [2, 3] });
  if (!q) return { skipped: 'drip already started for this call' };

  const enabled = String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true';
  if (!enabled) return { queued: 2, message1: 'skipped, sms_outbound_enabled is false' };

  const [m1] = dripMessages(name);
  const sent = await sendTwilioSms({ to, body: m1 });
  // Logged only after a successful handoff to Twilio.
  try {
    await rpc('log_client_message', {
      p_secret: secret, p_phone: to, p_direction: 'outbound', p_body: m1, p_call_id: callId,
    });
  } catch (e) {
    console.error('[vapi-call-ended] drip message 1 log failed:', e.message || e);
  }
  return { queued: 2, message1: 'sent', twilioSid: sent?.sid || null };
}

export default async function handler(req, res) {
  // The app asking for a call's recording, not Vapi. Lives on this route
  // because the project is at Vercel Hobby's 12-function cap; it is
  // authenticated by the admin's Supabase session, not the webhook secret.
  // See api/_lib/call-recording.js.
  if (req.method === 'GET') {
    const recording = new URL(fullUrl(req)).searchParams.get('recording');
    if (recording) return handleRecordingRequest(req, res, recording);
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let params;
  try {
    ({ params } = await readBody(req));
  } catch {
    return json(res, 400, { error: 'Invalid body' });
  }

  const expected = await webhookSecret();
  const provided =
    req.headers['x-webhook-secret'] ||
    req.headers['x-vapi-secret'] ||
    new URL(fullUrl(req)).searchParams.get('k');

  if (!secretMatches(provided, expected)) {
    console.warn('[vapi-call-ended] rejected: bad or missing secret');
    return json(res, 403, { error: 'forbidden' });
  }

  const eventType = extractType(params);
  // Vapi sends several event types to one URL. Only act on the final report.
  if (eventType && eventType !== 'end-of-call-report') {
    return json(res, 200, { ok: true, skipped: `ignored event type: ${eventType}` });
  }

  const to = extractCaller(params);
  const callId = extractCallId(params);
  const outbound = extractDirection(params) === 'outbound';

  if (!to) {
    console.warn('[vapi-call-ended] no caller number in payload');
    // Still keep the call id, so the recording is findable later.
    await recordCall({ callId, seconds: extractSeconds(params), direction: extractDirection(params), summary: extractSummary(params) });
    return json(res, 200, { ok: true, skipped: 'no caller number in payload' });
  }

  // ─── Safety net: never lose a caller who hung up ─────────────────────────
  // Lisa files the estimate at the END of the call, once she has everything,
  // which is what produces complete, correctly priced estimates. The cost is
  // that a hangup part-way through leaves no record at all. A live test on
  // 2026-08-25 ran 87 seconds and produced nothing: no estimate, no email, no
  // number to call back.
  //
  // capture_abandoned_call() no-ops when the call already filed a lead, so on
  // a normal completed call this does nothing. Runs before the SMS branch so
  // the lead is captured even while outbound texting is blocked by A2P.
  //
  // Never for an outbound call: we dialled the customer, so "no estimate was
  // filed" is expected and capturing would turn our own call into a fake
  // inbound lead and a duplicate estimate.
  let rescued = null;
  if (!outbound) try {
    rescued = await rpc('capture_abandoned_call', {
      p_secret: expected,
      p_caller_id: to,
      p_call_id: callId,
      p_transcript: extractTranscript(params),
      p_summary: extractSummary(params),
      p_name: extractName(params),
      p_transferred: extractTransferred(params),
    });
    if (rescued?.created) {
      console.log('[vapi-call-ended] abandoned call captured', {
        to, estimate: rescued.estimate_id,
      });
    }
  } catch (e) {
    console.error('[vapi-call-ended] abandoned-call capture failed:', e.message || e);
  }

  // Link the call to its estimate so the app can play the recording on it.
  // capture_abandoned_call returns estimate_id whether it filed one or found
  // the one Lisa filed during the call (migration 067).
  await recordCall({
    callId,
    invoiceId: rescued?.estimate_id || null,
    phone: to,
    seconds: extractSeconds(params),
    direction: extractDirection(params),
    summary: extractSummary(params),
  });

  // ─── Call archive email ──────────────────────────────────────────────────
  // Vapi keeps the recording and transcript on its own servers and nothing
  // linked them to the business. This mails the transcript after every call so
  // it is searchable in Gmail, readable on a phone, and reachable by the AIOS
  // assistant through the Gmail connection.
  //
  // The audio link goes to the Vapi dashboard rather than the raw recordingUrl:
  // recordings sit on Cloudflare R2 behind authentication, and fetching that
  // URL directly returns an Authorization error, so mailing it would ship a
  // dead link.
  try {
    const transcript = extractTranscript(params);
    const secs = extractSeconds(params);
    const recipients = String(await getSetting('lead_notify_to') || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    if (recipients.length) {
      const len = secs ? ` (${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s)` : '';
      await fetch(`${APP_URL}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipients,
          bccAdmin: false,
          template: 'call',
          subject: `Call record: ${to}${len}`,
          clientName: 'Caller',
          leadPhone: to,
          invoiceId: rescued?.estimate_id || null,
          transcript,
          summary: extractSummary(params),
          callId,
          callSeconds: secs,
          callUrl: callId ? `https://dashboard.vapi.ai/calls/${callId}` : null,
          // Opens the app's own player (?call=<id>), signed in as Jake.
          listenUrl: callId ? `${APP_URL}/?call=${encodeURIComponent(callId)}` : null,
        }),
      });
    }
  } catch (e) {
    // Never let the archive email affect the call outcome.
    console.error('[vapi-call-ended] call archive email failed:', e.message || e);
  }

  // The kickoff text is for new inbound leads only. An outbound call that
  // filed no estimate gets the 3-message drip instead.
  if (outbound) {
    const decision = shouldQueueDrip(params?.message || params || {});
    console.log('[vapi-call-ended] drip decision', { to, callId, drip: decision.drip, reason: decision.reason });
    if (!decision.drip) {
      return json(res, 200, { ok: true, skipped: `outbound call: no drip (${decision.reason})` });
    }
    try {
      const drip = await startDrip({ to, callId, name: extractCustomerName(params), secret: expected });
      return json(res, 200, { ok: true, drip, drip_reason: decision.reason });
    } catch (e) {
      console.error('[vapi-call-ended] drip failed:', e.message || e);
      // 200 on purpose, same reason as below: a Vapi retry would re-send.
      return json(res, 200, { ok: false, error: String(e.message || e) });
    }
  }

  // Inbound: the kickoff text is drip message 1. When it went out, only
  // messages 2 and 3 are queued; when it did not, all three are. Never throws.
  let kickoffSent = false;
  const inboundDrip = async () => {
    const decision = shouldQueueDrip(params?.message || params || {});
    console.log('[vapi-call-ended] inbound drip decision', { to, callId, drip: decision.drip, reason: decision.reason });
    if (!decision.drip) return { queued: 0, reason: decision.reason };
    try {
      const q = await queueDrip({
        to, callId, name: extractCustomerName(params),
        indexes: kickoffSent ? [2, 3] : [1, 2, 3],
      });
      return q ? { ...q, reason: decision.reason } : { skipped: 'drip already started for this call' };
    } catch (e) {
      console.error('[vapi-call-ended] inbound drip failed:', e.message || e);
      return { error: String(e.message || e) };
    }
  };

  const enabled = String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[vapi-call-ended] send skipped, sms_outbound_enabled is false', { to, callId });
    return json(res, 200, {
      ok: true,
      skipped: 'sms_outbound_enabled is false (A2P 10DLC not registered)',
      wouldHaveSentTo: to,
      leadCapture: rescued,
      drip: await inboundDrip(),
    });
  }

  try {
    if (await alreadySentMessage(to, KICKOFF)) {
      console.log('[vapi-call-ended] kickoff already sent, skipping', { to, callId });
      kickoffSent = true;
      return json(res, 200, { ok: true, skipped: 'kickoff already sent to this number', drip: await inboundDrip() });
    }
    const sent = await sendTwilioSms({ to, body: KICKOFF });
    kickoffSent = true;
    // Log only after a successful handoff to Twilio. Logging on intent would
    // put rows in the thread for messages that never went anywhere.
    const logged = await rpc('log_client_message', {
      p_secret: expected,
      p_phone: to,
      p_direction: 'outbound',
      p_body: KICKOFF,
      p_call_id: callId,
    });
    if (rescued?.estimate_id) {
      try { await recordSmsSnapshot(rescued.estimate_id, to, 'Kickoff text after call'); }
      catch (e) { console.error('[vapi-call-ended] sms_sent snapshot failed:', e.message || e); }
    }
    return json(res, 200, {
      ok: true,
      twilioSid: sent?.sid || null,
      twilioStatus: sent?.status || null,
      matchedClient: logged?.client_name || null,
      drip: await inboundDrip(),
    });
  } catch (e) {
    console.error('[vapi-call-ended] send/log failed:', e.message || e);
    // 200 on purpose: a non-2xx makes Vapi retry the report, and a retry would
    // re-send the SMS to the customer.
    return json(res, 200, { ok: false, error: String(e.message || e), drip: await inboundDrip() });
  }
}

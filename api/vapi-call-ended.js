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
  alreadySentMessage, recordSmsSnapshot,
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

  // The kickoff text is for new inbound leads only.
  if (outbound) {
    return json(res, 200, { ok: true, skipped: 'outbound call: no lead capture, no kickoff SMS' });
  }

  const enabled = String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[vapi-call-ended] send skipped, sms_outbound_enabled is false', { to, callId });
    return json(res, 200, {
      ok: true,
      skipped: 'sms_outbound_enabled is false (A2P 10DLC not registered)',
      wouldHaveSentTo: to,
      leadCapture: rescued,
    });
  }

  try {
    if (await alreadySentMessage(to, KICKOFF)) {
      console.log('[vapi-call-ended] kickoff already sent, skipping', { to, callId });
      return json(res, 200, { ok: true, skipped: 'kickoff already sent to this number' });
    }
    const sent = await sendTwilioSms({ to, body: KICKOFF });
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
    });
  } catch (e) {
    console.error('[vapi-call-ended] send/log failed:', e.message || e);
    // 200 on purpose: a non-2xx makes Vapi retry the report, and a retry would
    // re-send the SMS to the customer.
    return json(res, 200, { ok: false, error: String(e.message || e) });
  }
}

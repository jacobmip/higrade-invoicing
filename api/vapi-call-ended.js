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
} from './_lib/sms.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

const KICKOFF =
  'Mahalo for contacting High Grade Plumbing. Please reply with your service ' +
  'address, best email address, and any helpful photos of the plumbing issue ' +
  'so our team can assist you.';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// Vapi nests the payload differently across event shapes; check the documented
// spots rather than assuming one.
function extractCaller(p) {
  const m = p?.message || p || {};
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

export default async function handler(req, res) {
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

  if (!to) {
    console.warn('[vapi-call-ended] no caller number in payload');
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
  let rescued = null;
  try {
    rescued = await rpc('capture_abandoned_call', {
      p_secret: expected,
      p_caller_id: to,
      p_call_id: callId,
      p_transcript: extractTranscript(params),
      p_summary: extractSummary(params),
    });
    if (rescued?.created) {
      console.log('[vapi-call-ended] abandoned call captured', {
        to, estimate: rescued.estimate_id,
      });
    }
  } catch (e) {
    console.error('[vapi-call-ended] abandoned-call capture failed:', e.message || e);
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

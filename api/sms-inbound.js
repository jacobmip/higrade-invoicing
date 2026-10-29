// /api/sms-inbound
// Twilio's inbound-SMS webhook. Point the number's Messaging webhook here.
//
// This is the half of the SMS system that works TODAY. A2P 10DLC blocks
// application-to-person OUTBOUND messages to US numbers; a customer texting
// the business number is person-to-application and is not blocked. So Lisa
// can ask callers to text their service address and photos, and those land
// here even though we cannot text them first yet.
//
// Security: Twilio signs every request with X-Twilio-Signature, an HMAC-SHA1
// over the URL plus sorted params. Validated when TWILIO_AUTH_TOKEN is set.
// Without that, anyone who guessed this URL could inject fake customer
// messages into the client record, so an unsigned request is only accepted
// when a ?k=<secret> matching SMS_WEBHOOK_SECRET is present as a fallback.
//
// Responds with empty TwiML: Twilio requires a 200 with valid XML, and an
// empty <Response/> means "no auto-reply from TwiML". The reply, when there is
// one, goes out through the Twilio API instead so it can be logged in the
// thread and so a delivery failure is visible.
//
// A2P 10DLC cleared, so outbound works now and the comment that used to sit
// here (saying a reply "would be dropped by carriers anyway") is out of date.
// settings.sms_outbound_enabled is 'true' as of 2026-10-27.
//
// POST with `Authorization: Bearer <admin session>` and no Twilio signature is
// the Messages tab's reply box: `{ to, body }` sends one text and logs it. Same
// reason it lives here: the 12-function cap. The AI chat's send_sms uses the same
// call. The same send also accepts the webhook secret as the Bearer token (Lani
// on Telegram) and an optional invoice_id for an sms_sent snapshot. Its place_call sends `{ op: 'place_call', phone, name, about, context }`
// and queues an outbound call (see appPlaceCall).
//
// GET ?preview=<phone>&k=<secret> returns what Lisa WOULD reply to that
// thread, without sending anything. That is how a change to her prompt gets
// checked before a customer sees it. It lives on this route because the
// project is at Vercel Hobby's 12-function cap.

import {
  rpc, readBody, fullUrl, webhookSecret, secretMatches, validateTwilioSignature, twilioAuthToken,
  rehostTwilioMedia, getSetting, sendTwilioSms, supabaseUrl,
} from './_lib/sms.js';
import { telegramNotify } from './_lib/convert-estimate.js';
import { requireAdmin } from './_lib/call-recording.js';
import { autoReply, draftReply } from './_lib/sms-agent.js';
import { handleInfoReply } from './_lib/sms-reply-capture.js';
import { proposeInBackground } from './_lib/lead-estimate.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

// Same origin this route is served from; hardcoded so a Twilio retry hitting a
// preview deployment still mails through production.
const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';

function twiml(res, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/xml');
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response/>');
}

function deny(res, reason) {
  console.warn('[sms-inbound] rejected:', reason);
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain');
  res.end('forbidden');
}

function jsonOut(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function toE164(raw) {
  const s = String(raw || '').trim();
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return s.startsWith('+') && d.length >= 11 ? `+${d}` : '';
}

// `op: 'place_call'` from the AI chat: file one row in call_queue, the same row
// scripts/outbound_call.py queue writes. Nothing dials here. The runner
// (`outbound_call.py run --live`) only dials a queued row that is due, inside
// calling hours, with settings.outbound_calls_enabled on, and after Jake's
// APPROVE on Telegram, which the runner itself requests at dial time. The
// message sent from here is a heads-up only: it must NOT stamp approval_asked_at
// or ask for a reply, or the runner would see an approval "already pending" and
// refuse to dial.
async function appPlaceCall(res, user, params) {
  const phone = toE164(params.phone);
  const about = String(params.about || '').trim();
  if (!phone) return jsonOut(res, 400, { error: 'phone must be a US number' });
  if (!about) return jsonOut(res, 400, { error: 'about (the reason for the call) is required' });
  if (about.length > 600) return jsonOut(res, 400, { error: 'about is too long' });
  const name = String(params.name || '').trim() || null;
  const context = String(params.context || '').trim().slice(0, 1000) || null;
  const invoiceId = String(params.invoice_id || '').trim() || null;

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return jsonOut(res, 500, { error: 'Server not configured' });
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
  const base = `${supabaseUrl()}/rest/v1/call_queue`;

  // A model retry must not queue the same call twice.
  const dup = await fetch(
    `${base}?phone=eq.${encodeURIComponent(phone)}&status=in.(queued,calling)&purpose=eq.${encodeURIComponent(about)}&select=id&limit=1`,
    { headers });
  const dupRows = dup.ok ? await dup.json().catch(() => []) : [];
  let id = dupRows?.[0]?.id || null;
  let duplicate = !!id;
  if (!id) {
    const ins = await fetch(base, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        phone, client_name: name, purpose: about, context, invoice_id: invoiceId,
        queued_by: `app chat (${user.email || user.id})`,
      }),
    });
    const rows = await ins.json().catch(() => null);
    if (!ins.ok || !rows?.[0]?.id) {
      return jsonOut(res, 502, { error: `Could not queue the call: ${JSON.stringify(rows).slice(0, 200)}` });
    }
    id = rows[0].id;
  }

  const callsOn = String(await getSetting('outbound_calls_enabled') || 'false').toLowerCase() === 'true';
  let telegram = false;
  if (!duplicate) {
    telegram = await telegramNotify(
      `Call #${id} queued from the app chat\nTo: ${name || 'unknown'} (${phone})\nPurpose: ${about}\n` +
      (callsOn
        ? 'Lisa will ask you to APPROVE on Telegram right before she dials.'
        : 'outbound_calls_enabled is off, so it will not dial until that is switched on.'));
  }
  return jsonOut(res, 200, { ok: true, id, phone, duplicate, outbound_calls_enabled: callsOn, telegram_sent: telegram });
}

async function recordSmsSnapshot(invoiceId, to, note) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Server not configured');
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
  const base = `${supabaseUrl()}/rest/v1`;
  const id = encodeURIComponent(invoiceId);
  const inv = await fetch(`${base}/invoices?id=eq.${id}&select=*&limit=1`, { headers }).then(r => r.json());
  if (!inv?.[0]) throw new Error(`invoice ${invoiceId} not found`);
  const last = await fetch(
    `${base}/invoice_versions?invoice_id=eq.${id}&select=version_number&order=version_number.desc&limit=1`,
    { headers }).then(r => r.json());
  const version = (last?.[0]?.version_number || 0) + 1;
  const ins = await fetch(`${base}/invoice_versions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      invoice_id: invoiceId, version_number: version, snapshot: inv[0],
      sent_to: to, note, event_type: 'sms_sent', triggered_by_name: 'Lani', triggered_by_tier: 'admin',
    }),
  });
  if (!ins.ok) throw new Error(`insert ${ins.status}: ${(await ins.text()).slice(0, 200)}`);
  return version;
}

// Admin-only (session, or the webhook secret for texts). The sms_outbound_enabled gate applies here too, so the reply box
// cannot send while Jake has outbound switched off.
async function appSend(req, res) {
  try {
    // Two ways in: an admin session, or the webhook secret as the Bearer token
    // (Lani on Telegram; same pattern as gcal.js's delete op). The secret path
    // sends texts only: place_call stays session-only.
    const user = await requireAdmin(req);
    let viaSecret = false;
    if (!user) {
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      viaSecret = secretMatches(bearer, await webhookSecret());
      if (!viaSecret) return jsonOut(res, 403, { error: 'admin only' });
    }
    const { params } = await readBody(req);
    // Ballpark for a lead filed outside this route (the Yelp script). Secret or
    // session. Queues the work and answers; the proposal itself is gated by
    // proposeLeadEstimate (lead_channel, address, description, not yet asked).
    if (params.op === 'propose_estimate') {
      const invoiceId = String(params.invoice_id || '').trim();
      if (!invoiceId) return jsonOut(res, 400, { error: 'invoice_id is required' });
      await proposeInBackground({ invoiceId, problem: String(params.description || '') });
      return jsonOut(res, 200, { ok: true, queued: true });
    }
    if (params.op === 'place_call') {
      if (!user) return jsonOut(res, 403, { error: 'admin only' });
      return await appPlaceCall(res, user, params);
    }
    // The AI chat sends a bare 10-digit number; Twilio needs E.164. A value
    // already in E.164 (the reply box) passes through unchanged.
    const to = toE164(params.to) || String(params.to || '').trim();
    const body = String(params.body || '').trim();
    if (!to || !body) return jsonOut(res, 400, { error: 'to and body are required' });
    if (body.length > 1500) return jsonOut(res, 400, { error: 'message too long' });
    if (String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() !== 'true') {
      return jsonOut(res, 409, { error: 'Outbound texting is switched off (sms_outbound_enabled).' });
    }
    const sent = await sendTwilioSms({ to, body });
    // Logged after the send: the customer has it either way, and a failed log
    // is a missing bubble, not a lost message.
    let logged = null;
    try {
      logged = await rpc('log_client_message', {
        p_secret: await webhookSecret(), p_phone: to, p_direction: 'outbound',
        p_body: body, p_call_id: sent?.sid || null, p_media: null,
      });
    } catch (e) {
      console.error('[sms-inbound] logging app reply failed:', e.message || e);
    }
    // Optional: an sms_sent snapshot in that document's History. Same row shape
    // as db.recordInvoiceVersion; written with the service role since the secret
    // path has no user session. Failure here never undoes the send.
    let snapshot = null;
    const invoiceId = String(params.invoice_id || '').trim();
    if (invoiceId) {
      try { snapshot = await recordSmsSnapshot(invoiceId, to, viaSecret ? 'Text sent (Lani)' : 'Text sent'); }
      catch (e) { console.error('[sms-inbound] sms_sent snapshot failed:', e.message || e); }
    }
    return jsonOut(res, 200, { ok: true, sid: sent?.sid || null, message_id: logged?.message_id || null, snapshot });
  } catch (e) {
    console.error('[sms-inbound] app send failed:', e.message || e);
    return jsonOut(res, 500, { error: String(e.message || e) });
  }
}

// Stamp every unsent, unstopped drip row for this number as stopped. Matches on
// the last ten digits since the queue stores whatever format Vapi dialled.
async function stopDrip(phone) {
  const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (last10.length < 10 || !key) return;
  const r = await fetch(
    `${supabaseUrl()}/rest/v1/sms_drip_queue?phone=like.*${last10}&sent_at=is.null&stopped_at=is.null`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ stopped_at: new Date().toISOString(), stop_reason: 'customer_replied' }),
    });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export default async function handler(req, res) {
  // Dry run: what would Lisa say to this thread? Sends nothing, writes nothing.
  if (req.method === 'GET') {
    const url = new URL(fullUrl(req));
    const phone = url.searchParams.get('preview');
    if (!phone) {
      res.statusCode = 405;
      return res.end('Method not allowed');
    }
    if (!secretMatches(url.searchParams.get('k'), await webhookSecret())) {
      return deny(res, 'preview without a valid ?k= secret');
    }
    try {
      const out = await draftReply({
        phone,
        clientName: url.searchParams.get('name') || null,
        hasOpenEstimate: url.searchParams.get('open') === '1',
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: true, phone, draft: out }, null, 1));
    } catch (e) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  // The app's reply box. A Twilio webhook never carries a Bearer token.
  if (!req.headers['x-twilio-signature'] && /^Bearer /i.test(req.headers.authorization || '')) {
    return appSend(req, res);
  }

  let params;
  try {
    ({ params } = await readBody(req));
  } catch (e) {
    console.error('[sms-inbound] body read failed:', e);
    return twiml(res); // never make Twilio retry over a parse problem
  }

  const authToken = await twilioAuthToken();
  const signature = req.headers['x-twilio-signature'];

  let authed = false;
  if (authToken && signature) {
    authed = validateTwilioSignature({
      signature, url: fullUrl(req), params, authToken,
    });
    if (!authed) return deny(res, 'bad twilio signature');
  } else {
    // Fallback for before TWILIO_AUTH_TOKEN is set in Vercel env.
    const url = new URL(fullUrl(req));
    authed = secretMatches(url.searchParams.get('k'), await webhookSecret());
    if (!authed) return deny(res, 'no signature and no valid ?k= secret');
    console.warn('[sms-inbound] accepted via ?k= fallback; set TWILIO_AUTH_TOKEN for signature validation');
  }

  const from = params.From || params.from || '';
  const body = params.Body || params.body || '';
  const sid  = params.MessageSid || params.SmsSid || null;

  // A photo with no caption is the single most likely thing a customer sends
  // after being asked to text a picture of the problem, so an empty body is
  // only grounds for ignoring the message when there is no media either.
  // Rejecting on body alone silently discarded exactly the messages this
  // whole flow exists to collect.
  const mediaCount = parseInt(params.NumMedia || '0', 10) || 0;

  if (!from || (!String(body).trim() && mediaCount === 0)) {
    console.warn('[sms-inbound] no From, and no body or media; ignoring');
    return twiml(res);
  }

  // A reply ends any pending drip follow-up (sms_drip_queue, migration 101).
  // Before everything else, and never fatal to the message itself.
  try { await stopDrip(from); }
  catch (e) { console.error('[sms-inbound] stop drip failed:', e.message || e); }

  try {
    const secret = await webhookSecret();

    // Re-host any attachments before logging, so the stored row points at a URL
    // that will still work in six months.
    let media = [];
    try { media = await rehostTwilioMedia(params); }
    catch (e) { console.error('[sms-inbound] rehost threw:', e.message || e); }

    const result = await rpc('log_client_message', {
      p_secret: secret,
      p_phone: from,
      p_direction: 'inbound',
      p_body: String(body),
      p_call_id: sid,
      p_media: media.length ? media : null,
    });

    // Put texted photos on the job they belong to, not just in the thread.
    let attached = null;
    const goodMedia = media.filter(m => m.url && !m.failed);
    if (goodMedia.length && result?.client_id) {
      try {
        attached = await rpc('attach_media_to_recent_estimate', {
          p_secret: secret,
          p_client_id: result.client_id,
          p_media: goodMedia,
          p_caption: String(body).slice(0, 200) || null,
        });
      } catch (e) {
        console.error('[sms-inbound] attach to estimate failed:', e.message || e);
      }
    }

    // Tell Jake. Without this the message lands in a table nobody reads --
    // which is exactly what happened on 2026-09-07 when a customer texted
    // their address and it went nowhere anyone could see.
    try {
      const recipients = String(await getSetting('lead_notify_to') || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      if (recipients.length) {
        await fetch(`${APP_URL}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: recipients,
            bccAdmin: false,
            template: 'sms',
            subject: `Text from ${result?.client_name || from}`,
            clientName: result?.client_name || 'Unknown number',
            leadPhone: from,
            transcript: String(body),
            smsMedia: goodMedia,
            invoiceId: attached?.estimate_id || null,
          }),
        });
      }
    } catch (e) {
      console.error('[sms-inbound] alert email failed:', e.message || e);
    }

    // ─── Lisa answers ───────────────────────────────────────────────────
    // Last, deliberately. The message is already logged, the photo is already
    // on the job and Jake is already emailed, so a bad day for the model or
    // for Anthropic cannot cost us the message itself. Gated by
    // settings.sms_autoreply_enabled.
    let replied = 'not attempted';
    // A reply to our own "what's your service address / email?" text is handled
    // first; anything that does not match falls through to the agent.
    let captured = null;
    try {
      captured = await handleInfoReply({ phone: from, body: String(body), secret });
    } catch (e) {
      console.error('[sms-inbound] info-reply capture failed:', e.message || e);
    }
    try {
      replied = captured || await autoReply({
        phone: from,
        body: String(body),
        clientName: result?.client_name || null,
        clientId: result?.client_id || null,
        secret,
      });
    } catch (e) {
      replied = `failed: ${e.message || e}`;
      console.error('[sms-inbound] autoreply failed:', e.message || e);
    }

    console.log('[sms-inbound] logged', {
      from, matched: result?.matched, client: result?.client_name || null,
      media: media.length, attachedTo: attached?.estimate_id || null,
      replied,
    });
  } catch (e) {
    // Swallow: returning non-200 makes Twilio retry, and a retry storm would
    // duplicate the message once the underlying issue clears.
    console.error('[sms-inbound] log failed:', e.message || e);
  }

  return twiml(res);
}

// /api/schedule-request
// Backs the public "Schedule an Appointment" page at /schedule.
//
// This is the one website form that produces something actionable. The older
// Free Estimate and AI Estimate forms on higradeplumbing.com both end at an
// email, so nothing is matched to a client, nothing is priced, and Lisa has
// nothing to act on. This route hands the submission to the same
// create_estimate_from_lead() RPC that Lisa's phone calls use, so a web lead
// produces an identical priced draft estimate, a penciled appointment and the
// usual owner alert.
//
// NOTHING PRICED IS SENT TO THE CUSTOMER. The RPC creates a draft and alerts
// Jake; he reviews and sends. The customer sees a plain confirmation. That is
// deliberate: the price book can misread a job, and a wrong number going out
// under the business name is worse than a slower reply.
//
// POST /api/schedule-request   (same-origin JSON from /schedule)
// 200  { ok: true, reference }
// 400  { error: 'missing_fields', fields: [...] }
// 422  { error: 'rejected' }            spam heuristics
// 500  { error: 'server_error' }
//
// Classic Node (req, res) handler: returning a Web Response makes Vercel's
// nodejs runtime hang until timeout. Same note as api/public-invoice.js.

import {
  rpc, readBody, getSetting, sendTwilioSms, alreadySentMessage, recordSmsSnapshot,
} from './_lib/sms.js';
import { checkAppointment } from './_lib/availability-check.js';
import { proposeInBackground } from './_lib/lead-estimate.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

const MAX = { name: 120, phone: 40, email: 160, address: 300, description: 4000, service: 120 };

// Marketing sources the attribution reporting knows about. Mirrors
// higrade_channels() in the WordPress plugin; add a slug in both or the lead
// lands under 'web'. NOT the form name: this answers "which marketing paid",
// so a Yelp visitor who books here must still count as Yelp.
const CHANNELS = new Set([
  'yelp', 'google', 'facebook', 'nextdoor', 'truck', 'flyer', 'yard_sign', 'referral', 'web',
]);

function resolveChannel(claimed) {
  const slug = String(claimed ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
  return CHANNELS.has(slug) ? slug : 'web';
}
// Sent once after a web lead is filed. Same offer as the phone kickoff, worded
// for someone who filled in a form rather than called.
const WEB_FOLLOWUP =
  'Aloha! Mahalo for reaching out to HI Grade Plumbing. To help us prepare your ' +
  'estimate, please send your service address and any photos or videos of the ' +
  'issue - we can give you a free ballpark estimate from photos alone. ' +
  'Reply STOP to opt out.';

// Never throws: the lead is already filed and the customer has been promised a
// confirmation, so a text failure must not turn into a 500.
async function followUp({ phone, consented, estimateId, secret }) {
  try {
    if (digitsOnly(phone).length < 10) return console.log('[schedule-request] follow-up skipped: no phone');
    if (!consented) return console.log('[schedule-request] follow-up skipped: no text consent', { estimateId });
    const on = String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true';
    if (!on) return console.log('[schedule-request] follow-up skipped: sms_outbound_enabled is false', { estimateId });
    if (await alreadySentMessage(phone, WEB_FOLLOWUP)) {
      return console.log('[schedule-request] follow-up skipped: already sent', { estimateId });
    }
    await sendTwilioSms({ to: phone, body: WEB_FOLLOWUP });
    await rpc('log_client_message', {
      p_secret: secret, p_phone: phone, p_direction: 'outbound', p_body: WEB_FOLLOWUP, p_call_id: null,
    });
    if (estimateId) await recordSmsSnapshot(estimateId, phone, 'Follow-up text after web form');
  } catch (e) {
    console.error('[schedule-request] follow-up failed:', String(e?.message || e).split(secret).join('[lead_secret]'));
  }
}

async function estimateAfterResponse({ phone, consented, estimateId, description }) {
  try {
    if (!estimateId || digitsOnly(phone).length < 10 || !consented) return;
    const on = String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true';
    if (!on) return;
    await proposeInBackground({ invoiceId: estimateId, problem: description });
  } catch (e) {
    console.error('[schedule-request] estimator dispatch failed:', e?.message || e);
  }
}

// A bot fills a form in milliseconds. A person cannot.
const MIN_FILL_MS = 3000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const clean = (v, cap) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);

function digitsOnly(phone) {
  return String(phone ?? '').replace(/\D/g, '');
}

// Hawaii has no DST, so a fixed -10:00 is correct year round. The RPC wants a
// local wall-clock string, not UTC: gcal_date is TEXT and is read back as
// Hawaii time elsewhere in the app.
function hawaiiAppointment(dateStr, windowStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const hour = { morning: '08:00', midday: '11:00', afternoon: '13:00', evening: '16:00' }[windowStr]
    || '09:00';
  return `${dateStr}T${hour}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  let params;
  try {
    ({ params } = await readBody(req));
  } catch {
    return send(res, 400, { error: 'bad_body' });
  }

  // --- spam heuristics ------------------------------------------------------
  // A public endpoint that creates estimates and emails the owner is worth
  // protecting, and a honeypot plus a fill-time floor stops the cheap bots
  // without putting a captcha in front of a customer with a flooding bathroom.
  if (clean(params.company_website, 50)) return send(res, 422, { error: 'rejected' });
  const elapsed = Number(params.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {
    return send(res, 422, { error: 'rejected' });
  }

  const name = clean(params.name, MAX.name);
  const phone = clean(params.phone, MAX.phone);
  const service = clean(params.service, MAX.service);
  const description = clean(params.description, MAX.description);
  const address = clean(params.address, MAX.address);
  const email = clean(params.email, MAX.email);

  const missing = [];
  if (!name) missing.push('name');
  if (digitsOnly(phone).length < 10) missing.push('phone');
  if (!service) missing.push('service');
  if (!description) missing.push('description');
  if (missing.length) return send(res, 400, { error: 'missing_fields', fields: missing });

  const secret = await getSetting('lead_secret');
  if (!secret) {
    console.error('schedule-request: settings.lead_secret is missing');
    return send(res, 500, { error: 'server_error' });
  }

  // Everything the customer typed goes in the problem text. The RPC files it
  // as a priced line item plus internal_notes, and anything it cannot price
  // still reaches Jake in the alert rather than being dropped.
  const problem = [
    description,
    email ? `Email: ${email}` : '',
    clean(params.preferred_date, 40) ? `Preferred date: ${clean(params.preferred_date, 40)}` : '',
    clean(params.preferred_window, 40) ? `Preferred window: ${clean(params.preferred_window, 40)}` : '',
    params.sms_consent ? 'Agreed on the web form to be texted about this job.'
                       : 'Did NOT agree to texts. Call or email only.',
  ].filter(Boolean).join('\n');

  // Check the calendar before pencilling anything in. A busy or unreadable
  // calendar drops the time (the preferred date/window is still in the problem
  // text) and the lead is filed regardless; Jake schedules it by hand.
  let appointment = hawaiiAppointment(clean(params.preferred_date, 40), clean(params.preferred_window, 40));
  if (appointment) {
    const chk = await checkAppointment(appointment);
    if (chk.status === 'free') {
      console.log('[schedule-request] availability: free, keeping', appointment);
    } else {
      console.log(`[schedule-request] availability: ${chk.status}${chk.detail ? ` (${chk.detail})` : ''}, omitting ${appointment}`);
      appointment = null;
    }
  }

  const args = {
    p_secret: secret,
    p_name: name,
    p_phone: phone,
    p_address: address || null,
    p_problem: problem,
    p_urgency: clean(params.urgency, 60) || null,
    p_callback_window: clean(params.preferred_window, 60) || null,
    p_owner_or_tenant: clean(params.owner_or_tenant, 40) || null,
    p_new_or_existing: clean(params.new_or_existing, 40) || null,
    p_heard_from: 'Website, Schedule an Appointment',
    // Required. Omitting it makes the RPC default to 'phone' (migration 062),
    // which would file every web booking under the one channel the
    // attribution work exists to tell apart.
    p_lead_channel: resolveChannel(params.channel),
    p_services: service ? [service] : null,
    p_appointment: appointment,
  };

  try {
    const out = await rpc('create_estimate_from_lead', args);
    const reference = out?.number || out?.estimate_number || out?.doc_number || out?.estimate_id || null;
    await followUp({ phone, consented: !!params.sms_consent, estimateId: out?.estimate_id || null, secret });
    send(res, 200, { ok: true, reference });
    // After the response, so the form never waits on the model. Same gates as
    // the follow-up text: a phone, text consent and sms_outbound_enabled, since
    // an APPROVE ends in a text to this customer. Never throws.
    await estimateAfterResponse({ phone, consented: !!params.sms_consent, estimateId: out?.estimate_id || null, description });
    return;
  } catch (err) {
    // Never leak the RPC error to the browser: it can carry the secret-gate
    // message and internal column names. And scrub the secret before it
    // reaches the server log either, since the gate error quotes it back.
    const detail = String(err?.message || err).split(secret).join('[lead_secret]');
    console.error('schedule-request failed:', detail);
    return send(res, 500, { error: 'server_error' });
  }
}

// /api/_lib/sms.js — shared helpers for the SMS routes.
//
// Deliberately thin. All the matching and insert logic lives in the
// log_client_message() RPC (migration 034) so it is testable directly against
// the database instead of being duplicated across two serverless functions.
//
// Required env:
//   SUPABASE_URL                (falls back to the project URL below)
//   SUPABASE_SERVICE_ROLE_KEY   (RPC is SECURITY DEFINER but still needs a key)
//   TWILIO_ACCOUNT_SID          (outbound send + inbound signature validation)
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER          (defaults to the settings value if unset)
//   SMS_WEBHOOK_SECRET          (must equal settings.sms_webhook_secret)

import crypto from 'node:crypto';

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';

export function supabaseUrl() {
  return process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
}

function supabaseKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.VITE_SUPABASE_ANON_KEY
           || process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('Supabase key not configured');
  return key;
}

export async function rpc(fn, args) {
  const key = supabaseKey();
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} failed ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Settings live in the database so operational switches (like turning SMS on
// the day A2P 10DLC clears) are an UPDATE, not a redeploy.
export async function getSetting(key) {
  const k = supabaseKey();
  const res = await fetch(
    `${supabaseUrl()}/rest/v1/settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
    { headers: { apikey: k, Authorization: `Bearer ${k}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

// Secrets resolve from Vercel env first, then fall back to the settings table.
//
// The fallback exists because every value these routes need was already in
// settings (sms_webhook_secret, twilio_sid, twilio_token, notify_from) and the
// routes already hold working Supabase credentials — public-invoice.js proves
// that. Duplicating them into Vercel env bought nothing except a second place
// to keep in sync, and leaving them unset silently 403'd every inbound webhook.
//
// Env still wins where set, so a future deploy can override without a DB edit.
export async function webhookSecret() {
  return process.env.SMS_WEBHOOK_SECRET || (await getSetting('sms_webhook_secret'));
}

export async function twilioAuthToken() {
  return process.env.TWILIO_AUTH_TOKEN || (await getSetting('twilio_token'));
}

export async function twilioAccountSid() {
  return process.env.TWILIO_ACCOUNT_SID || (await getSetting('twilio_sid'));
}

// Constant-time compare so a wrong secret can't be brute-forced by timing.
export function secretMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Twilio ────────────────────────────────────────────────────────────────

// Validates X-Twilio-Signature: HMAC-SHA1 over the full request URL followed
// by every POST param sorted by key, then base64. This is what stops anyone
// who guesses the endpoint from injecting fake customer messages.
export function validateTwilioSignature({ signature, url, params, authToken }) {
  if (!signature || !authToken) return false;
  let data = url;
  for (const k of Object.keys(params || {}).sort()) {
    data += k + params[k];
  }
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function sendTwilioSms({ to, body, from }) {
  const sid = await twilioAccountSid();
  const token = await twilioAuthToken();
  if (!sid || !token) throw new Error('Twilio credentials not configured');

  const fromNumber = from || process.env.TWILIO_FROM_NUMBER || (await getSetting('notify_from'));
  if (!fromNumber) throw new Error('No Twilio from-number configured');

  const form = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
    },
    body: form.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio send failed ${res.status}: ${JSON.stringify(json)}`);

  // Twilio returning 201 does NOT mean delivered. Until A2P 10DLC is
  // registered, US carriers drop these with error 30034 after the fact.
  return json;
}

// True when this exact body has already gone out to this phone. The lead
// follow-ups (kickoff after a call, web form reply) must fire once, and a Vapi
// or form retry would otherwise text the customer twice. Matches on the last
// ten digits because client_messages.phone_number is stored in mixed formats.
// Keyed on the body, not on "any outbound row", so a returning customer who
// was once replied to by hand still gets the kickoff on a new lead.
export async function alreadySentMessage(phone, body) {
  const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return false;
  const k = supabaseKey();
  const q = `phone_number=ilike.${encodeURIComponent('%' + last10.split('').join('%'))}`
    + `&direction=eq.outbound&body=eq.${encodeURIComponent(body)}&select=id&limit=1`;
  const res = await fetch(`${supabaseUrl()}/rest/v1/client_messages?${q}`,
    { headers: { apikey: k, Authorization: `Bearer ${k}` } });
  // Fail closed: if the check cannot run, do not risk a duplicate text.
  if (!res.ok) throw new Error(`duplicate check failed ${res.status}`);
  return (await res.json()).length > 0;
}

// History-tab snapshot for a text sent from a route (same row shape as
// recordSmsSnapshot in sms-inbound.js).
export async function recordSmsSnapshot(invoiceId, to, note) {
  const key = supabaseKey();
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
  const base = `${supabaseUrl()}/rest/v1`;
  const id = encodeURIComponent(invoiceId);
  const inv = await fetch(`${base}/invoices?id=eq.${id}&select=*&limit=1`, { headers }).then(r => r.json());
  if (!inv?.[0]) throw new Error(`invoice ${invoiceId} not found`);
  const last = await fetch(
    `${base}/invoice_versions?invoice_id=eq.${id}&select=version_number&order=version_number.desc&limit=1`,
    { headers }).then(r => r.json());
  const ins = await fetch(`${base}/invoice_versions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      invoice_id: invoiceId, version_number: (last?.[0]?.version_number || 0) + 1, snapshot: inv[0],
      sent_to: to, note, event_type: 'sms_sent', triggered_by_name: 'Lisa', triggered_by_tier: 'admin',
    }),
  });
  if (!ins.ok) throw new Error(`snapshot insert ${ins.status}: ${(await ins.text()).slice(0, 200)}`);
}

// Read a urlencoded or JSON body off the classic Node request. Vercel's node
// runtime may or may not have parsed it already depending on content type, so
// handle both. public-invoice.js documents that returning a Web Response from
// this runtime hangs, which is why these routes use (req, res).
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return { params: req.body, raw: null };

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');

  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try { return { params: JSON.parse(raw), raw }; } catch { return { params: {}, raw }; }
  }
  const params = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  return { params, raw };
}

// Twilio delivers MMS attachments as MediaUrl0, MediaUrl1... on the webhook.
// Those URLs are auth-gated AND deleted after Twilio's retention window, so
// storing the link is worthless — it fails immediately for anyone without the
// account credentials, and rots even for those who have them. So fetch each
// one with Basic auth and re-upload to the public job-photos bucket that the
// app already serves images from.
// MIME subtype to file extension. The naive "subtype" rule stored iPhone video
// as .quicktime, which nothing recognises.
const EXT_BY_SUBTYPE = {
  quicktime: 'mov', '3gpp': '3gp', '3gpp2': '3g2', jpeg: 'jpg', 'x-m4v': 'm4v',
  mpeg: 'mpg', 'x-matroska': 'mkv', heic: 'heic', heif: 'heif',
};

function extFor(type) {
  const sub = (String(type).split('/')[1] || 'bin').split(';')[0].trim().toLowerCase();
  return EXT_BY_SUBTYPE[sub] || sub.replace(/[^a-z0-9]/g, '') || 'bin';
}

// Twilio's media URL is /Messages/MM.../Media/ME...; the last segment is the
// media sid, kept so a failed or soft item can be re-fetched later.
function mediaSidOf(url) {
  const m = String(url).match(/\/Media\/(ME[0-9a-f]+)/i);
  return m ? m[1] : null;
}

async function rehostOne({ url, type, path, auth, key }) {
  const res = await fetch(url, { headers: { Authorization: auth }, redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const up = await fetch(`${supabaseUrl()}/storage/v1/object/job-photos/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': type, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
  return bytes.length;
}

// Entries: { url, type, bytes, twilio_media_sid } on success, or
// { failed: true, twilio_url, type, twilio_media_sid } after two attempts, so a
// repair job can re-fetch it instead of the attachment vanishing from the thread.
// Items run in parallel: sequential fetches of several videos were the slowest
// part of a webhook that has 10 seconds on Hobby.
export async function rehostTwilioMedia(params) {
  const sid = await twilioAccountSid();
  const token = await twilioAuthToken();
  if (!sid || !token) return [];

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.warn('[sms] no service-role key; cannot re-host media');
    return [];
  }

  const count = parseInt(params.NumMedia || '0', 10);
  if (!Number.isFinite(count) || count < 1) return [];

  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const jobs = [];
  for (let i = 0; i < count && i < 10; i++) {
    const url = params[`MediaUrl${i}`];
    if (!url) continue;
    const type = params[`MediaContentType${i}`] || 'application/octet-stream';
    jobs.push({
      url, type, auth, key,
      path: `sms/${params.MessageSid || Date.now()}-${i}.${extFor(type)}`,
      mediaSid: mediaSidOf(url),
    });
  }

  return Promise.all(jobs.map(async (job) => {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const bytes = await rehostOne(job);
        return {
          url: `${supabaseUrl()}/storage/v1/object/public/job-photos/${job.path}`,
          type: job.type,
          bytes,
          twilio_media_sid: job.mediaSid,
        };
      } catch (e) {
        lastErr = e;
        console.error('[sms] media rehost attempt', attempt, job.path, e.message || e);
      }
    }
    console.error('[sms] media rehost gave up', job.path, lastErr?.message || lastErr);
    return { failed: true, twilio_url: job.url, type: job.type, twilio_media_sid: job.mediaSid };
  }));
}

export function fullUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.url}`;
}

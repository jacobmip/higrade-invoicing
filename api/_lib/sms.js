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

export function fullUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.url}`;
}

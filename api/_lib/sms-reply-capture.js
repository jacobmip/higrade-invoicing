// A customer's reply to "what's your email address?" (the booking
// confirmation text from vapi-call-ended.js) that is just an email: written to
// the newest estimate for that phone and the client, then confirmed. Anything
// else returns null and the caller falls through to Lisa. Address replies
// always go to Lisa since v1.81.7 (she verifies them and knows the booking).
//
// A helper, not a route: the project is at the 12-function cap.

import { getSetting, sendTwilioSms, supabaseUrl } from './sms.js';
import { logOutbound } from './sms-agent.js';

const WAIT_WINDOW_HOURS = 48;
const ESTIMATE_WINDOW_DAYS = 7;
const EMAIL_RE = /[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+/;
const NOT_INFO = /^\s*(yes|yeah|yep|yup|no|nope|nah|ok|okay|k|stop|stopall|unsubscribe|cancel|end|quit|help|thanks|thank you)\b[\s.!]*$/i;

function key() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
}
function headers(extra) {
  const k = key();
  return { apikey: k, Authorization: `Bearer ${k}`, ...(extra || {}) };
}
function last10Of(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}
// '%1%2%3...' matches however the number was stored (+1, dashes, parens).
function fuzzy(last10, wildcard) {
  return wildcard + last10.split('').join(wildcard) + wildcard;
}

// Whether our last text was waiting on an email.
function expectations(outboundBody) {
  const t = String(outboundBody || '').toLowerCase();
  return {
    email: /email address/.test(t),
  };
}

export function extractEmail(body) {
  const m = String(body || '').match(EMAIL_RE);
  return m ? m[0].replace(/[.]+$/, '').toLowerCase() : '';
}

// gcal_date is local Hawaii wall-clock text, YYYY-MM-DDTHH:MM; format from the
// text, never through a timezone-aware Date.
function prettySlot(gcalDate) {
  const m = String(gcalDate || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m.map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US',
    { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${day} at ${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

async function patch(path, obj) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(obj),
  });
  if (!r.ok) throw new Error(`PATCH ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function get(path) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { headers: headers() });
  if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}`);
  return r.json();
}

/**
 * Returns a short description of what it did, or null to fall through to the
 * normal agent. Throws only on a failed write, before anything was sent.
 */
export async function handleInfoReply({ phone, body, secret }) {
  const last10 = last10Of(phone);
  if (last10.length < 10) return null;

  const since = new Date(Date.now() - WAIT_WINDOW_HOURS * 3600e3).toISOString();
  const out = await get(
    `client_messages?phone_number=ilike.${encodeURIComponent(fuzzy(last10, '%'))}`
    + `&direction=eq.outbound&created_at=gte.${encodeURIComponent(since)}`
    + '&select=body,created_at&order=created_at.desc&limit=1');
  const want = expectations(out?.[0]?.body);
  if (!want.email) return null;

  // Email only. Address replies go to Lisa, who verifies them and knows the
  // whole conversation: this canned path saved "4545A Sierra Dr. Low water
  // pressure in upstairs bathroom faucets." as the street and answered a
  // booked customer "Our team will confirm your time" (Marianne, 2026-11-13).
  // And only when the reply is basically just the email: anything more is a
  // conversation, and Lisa answers it.
  const email = extractEmail(body);
  if (!email || String(body).trim().length > email.length + 25) return null;

  const estSince = new Date(Date.now() - ESTIMATE_WINDOW_DAYS * 86400e3).toISOString();
  const inv = (await get(
    `invoices?client_info->>phone=ilike.${encodeURIComponent(fuzzy(last10, '*'))}`
    + `&deleted_at=is.null&created_at=gte.${encodeURIComponent(estSince)}`
    + '&select=id,client_id,client_info,job_address,gcal_date&order=created_at.desc&limit=1'))?.[0];
  if (!inv) return null;

  const invPath = `invoices?id=eq.${encodeURIComponent(inv.id)}`;
  const clientPath = inv.client_id ? `clients?id=eq.${encodeURIComponent(inv.client_id)}` : null;

  await patch(invPath, { client_info: { ...(inv.client_info || {}), email }, updated_at: new Date().toISOString() });
  if (clientPath) await patch(clientPath, { email });

  const slot = prettySlot(inv.gcal_date);
  const reply = `Perfect, got it! We have your email as ${email}.`
    + (slot ? ` See you ${slot}.` : '') + ' Mahalo!';

  let sent = false;
  if (String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true') {
    await sendTwilioSms({ to: phone, body: reply });
    await logOutbound({ secret, phone, body: reply });
    sent = true;
  }
  return `captured email on ${inv.id}${sent ? ', confirmed' : ', outbound off, no confirmation'}`;
}

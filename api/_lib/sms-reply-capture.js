// A customer's reply to "Could you reply with your service address?" or
// "what's your email address?" (the booking confirmation text from
// vapi-call-ended.js).
//
// The reply arrives as a fresh inbound with no link to the estimate it belongs
// to, so the agent used to log it and say nothing. This looks at our most recent
// outbound text, and if we were waiting on an address or an email and the reply
// looks like one, writes it onto the newest open estimate for that phone, onto
// the client record, and confirms. Anything that does not match returns null and
// the caller falls through to the normal agent.
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

// What our last text was waiting on: 'address', 'email', or both.
function expectations(outboundBody) {
  const t = String(outboundBody || '').toLowerCase();
  return {
    address: /service address/.test(t),
    email: /email address/.test(t),
  };
}

// Basic heuristic: a house number plus some words. Not "yes", not a question,
// not a paragraph about the leak.
export function looksLikeAddress(body) {
  const t = String(body || '').trim();
  if (t.length < 6 || t.length > 150) return false;
  if (NOT_INFO.test(t) || t.includes('@') || t.includes('?')) return false;
  return /\d/.test(t) && (t.match(/[A-Za-z]{2,}/g) || []).length >= 2;
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
  if (!want.address && !want.email) return null;

  const email = want.email ? extractEmail(body) : '';
  const address = !email && want.address && looksLikeAddress(body) ? String(body).trim() : '';
  if (!email && !address) return null;

  const estSince = new Date(Date.now() - ESTIMATE_WINDOW_DAYS * 86400e3).toISOString();
  const inv = (await get(
    `invoices?client_info->>phone=ilike.${encodeURIComponent(fuzzy(last10, '*'))}`
    + `&deleted_at=is.null&created_at=gte.${encodeURIComponent(estSince)}`
    + '&select=id,client_id,client_info,job_address,gcal_date&order=created_at.desc&limit=1'))?.[0];
  if (!inv) return null;

  const invPath = `invoices?id=eq.${encodeURIComponent(inv.id)}`;
  const clientPath = inv.client_id ? `clients?id=eq.${encodeURIComponent(inv.client_id)}` : null;

  if (address) {
    await patch(invPath, {
      job_address: { label: 'Service address', line1: address, line2: '', city: '', state: 'HI', zip: '' },
    });
    if (clientPath) {
      const c = (await get(`${clientPath}&select=addresses&limit=1`))?.[0];
      const list = Array.isArray(c?.addresses) ? [...c.addresses] : [];
      const entry = { label: 'Service address', line1: address, line2: '', city: '', state: 'HI', zip: '' };
      const same = list.findIndex(a => String(a?.line1 || '').trim().toLowerCase() === address.toLowerCase());
      const blank = list.findIndex(a => !String(a?.line1 || '').trim());
      if (same < 0) {
        if (blank >= 0) list[blank] = { ...list[blank], ...entry, label: list[blank].label || entry.label };
        else list.push(entry);
        await patch(clientPath, { addresses: list });
      }
    }
  } else {
    await patch(invPath, { client_info: { ...(inv.client_info || {}), email } });
    if (clientPath) await patch(clientPath, { email });
  }

  const slot = prettySlot(inv.gcal_date);
  const reply = `Perfect, got it! We have your ${address ? 'address' : 'email'} as ${address || email}.`
    + (slot ? ` See you ${slot}.` : ' Our team will confirm your time.') + ' Mahalo!';

  let sent = false;
  if (String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true') {
    await sendTwilioSms({ to: phone, body: reply });
    await logOutbound({ secret, phone, body: reply });
    sent = true;
  }
  return `captured ${address ? 'address' : 'email'} on ${inv.id}${sent ? ', confirmed' : ', outbound off, no confirmation'}`;
}

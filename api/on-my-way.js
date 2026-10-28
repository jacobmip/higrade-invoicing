// /api/on-my-way — texts the client an ETA from the tech's GPS position.
//
// Edge runtime on purpose: the project sits at the Hobby plan's 12 Node
// function cap (see CLAUDE.md), and edge routes do not count. That rules out
// api/_lib/sms.js (node:crypto), so the few Twilio and settings calls it would
// have given us are done with plain fetch here.
//
// POST { invoice_id, lat?, lng? }  with  Authorization: Bearer <session>
//   lat/lng absent (GPS denied) -> fixed "arrive shortly" wording, no ETA.
// Returns { ok, eta_minutes, message_sent, message? }. Failures carry
// { ok:false, code, error }; code 'sms_disabled' means settings.sms_outbound_enabled
// is not 'true'. The invoice read runs under the caller's own JWT, so RLS decides
// whether this person may text this job's client. The sms_sent version snapshot
// is recorded by the form (snapshotEvent) after a successful response.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPS_KEY = process.env.VITE_GOOGLE_MAPS_API_KEY;

const out = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function setting(key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!res.ok) return null;
  return (await res.json())?.[0]?.value ?? null;
}

function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d.length >= 11 ? `+${d}` : '';
}

async function geocode(address) {
  if (MAPS_KEY) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${MAPS_KEY}`,
        { headers: { Referer: 'https://higrade-invoicing.vercel.app' } });
      const loc = (await r.json())?.results?.[0]?.geometry?.location;
      if (loc) return { lat: loc.lat, lng: loc.lng };
    } catch { /* fall through */ }
  }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      { headers: { 'User-Agent': 'HIGradeInvoicing/1.0 (jacobmip@gmail.com)' } });
    const hit = (await r.json())?.[0];
    if (hit) return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
  } catch { /* no coordinates */ }
  return null;
}

// Whole minutes, rounded up. Google Distance Matrix if a key exists, else OSRM.
async function etaMinutes(from, to) {
  if (MAPS_KEY) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${from.lat},${from.lng}&destinations=${to.lat},${to.lng}&key=${MAPS_KEY}`,
        { headers: { Referer: 'https://higrade-invoicing.vercel.app' } });
      const el = (await r.json())?.rows?.[0]?.elements?.[0];
      if (el?.status === 'OK' && el.duration?.value) return Math.max(1, Math.ceil(el.duration.value / 60));
    } catch { /* fall through */ }
  }
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`);
    const secs = (await r.json())?.routes?.[0]?.duration;
    if (secs > 0) return Math.max(1, Math.ceil(secs / 60));
  } catch { /* no ETA */ }
  return null;
}

export default async function handler(req) {
  if (req.method !== 'POST') return out(405, { ok: false, error: 'Method not allowed' });
  if (!SERVICE || !ANON) return out(500, { ok: false, error: 'Server not configured' });

  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer /i.test(auth)) return out(401, { ok: false, error: 'Sign in required' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!userRes.ok) return out(401, { ok: false, error: 'Sign in required' });
  const user = await userRes.json();

  let body;
  try { body = await req.json(); } catch { return out(400, { ok: false, error: 'Bad JSON' }); }
  const invoiceId = String(body.invoice_id || '');
  if (!invoiceId) return out(400, { ok: false, error: 'invoice_id required' });
  // tech_id is accepted for callers that send it but never trusted: the tech is whoever holds the session.
  if (body.tech_id && body.tech_id !== user.id) return out(403, { ok: false, error: 'tech_id does not match session' });

  // Kill switch first, so a disabled switch never costs a routing call.
  const enabled = String((await setting('sms_outbound_enabled')) || 'false').toLowerCase() === 'true';
  if (!enabled) return out(409, { ok: false, code: 'sms_disabled', error: 'SMS disabled - enable in Settings' });

  // Under the caller's JWT: RLS limits this to jobs they may see.
  const userHeaders = { apikey: ANON, Authorization: auth };
  const invRes = await fetch(
    `${SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}&select=id,client_name,job_address,billing_address,job_lat,job_lng,clients(name,phone,mobile)&limit=1`,
    { headers: userHeaders });
  const inv = invRes.ok ? (await invRes.json())?.[0] : null;
  if (!inv) return out(404, { ok: false, error: 'Job not found' });

  const to = toE164(inv.clients?.mobile) || toE164(inv.clients?.phone);
  if (!to) return out(422, { ok: false, code: 'no_phone', error: 'Client has no phone number' });

  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=display_name&limit=1`, { headers: userHeaders });
  const techName = (profRes.ok && (await profRes.json())?.[0]?.display_name) || 'technician';
  const firstName = String(inv.clients?.name || inv.client_name || '').trim().split(/\s+/)[0] || 'there';

  // ETA only when the browser gave us a position and the job has a place to go.
  let eta = null;
  const lat = Number(body.lat), lng = Number(body.lng);
  const shown = Number(body.eta_minutes); // the figure the confirm modal showed
  if (body.eta_minutes != null && Number.isFinite(shown) && shown >= 0 && shown <= 600) {
    eta = Math.round(shown);
  } else if (body.lat != null && body.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    let dest = Number.isFinite(inv.job_lat) && Number.isFinite(inv.job_lng) ? { lat: inv.job_lat, lng: inv.job_lng } : null;
    if (!dest) {
      const a = inv.job_address || inv.billing_address || {};
      const addr = [a.line1, a.line2, a.line3].filter(Boolean).join(', ');
      if (addr) dest = await geocode(addr);
    }
    if (dest) eta = await etaMinutes({ lat, lng }, dest);
  }

  const arrive = eta != null ? `will arrive in approximately ${eta} minutes` : 'will arrive shortly';
  const message = `Aloha ${firstName}, ${techName} is on the way and ${arrive}. Mahalo!`;

  const sid = process.env.TWILIO_ACCOUNT_SID || (await setting('twilio_sid'));
  const token = process.env.TWILIO_AUTH_TOKEN || (await setting('twilio_token'));
  const from = process.env.TWILIO_FROM_NUMBER || (await setting('notify_from'));
  if (!sid || !token || !from) return out(500, { ok: false, error: 'Twilio not configured' });

  const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(`${sid}:${token}`) },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
  });
  const twJson = await tw.json().catch(() => ({}));
  if (!tw.ok) return out(502, { ok: false, error: `Twilio send failed: ${twJson?.message || tw.status}` });

  // Logged after the send: the customer has it either way; a failed log is a missing bubble.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_client_message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({
        p_secret: process.env.SMS_WEBHOOK_SECRET || (await setting('sms_webhook_secret')),
        p_phone: to, p_direction: 'outbound', p_body: message, p_call_id: twJson?.sid || null, p_media: null,
      }),
    });
  } catch (e) { console.error('[on-my-way] log failed', e?.message || e); }

  return out(200, { ok: true, eta_minutes: eta, message_sent: true, message });
}

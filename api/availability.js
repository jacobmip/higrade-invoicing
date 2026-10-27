// /api/availability — Jake's busy blocks and free slots for one day (Hawaii time).
//
// Lisa (Vapi) calls this through her `checkAvailability` tool BEFORE she pencils
// anyone in. Until now create_estimate_from_lead accepted whatever time the
// caller asked for and never looked at the calendar, which is how Jake got
// double-booked at 9am.
//
//   GET  /api/availability?date=2026-10-27
//   POST /api/availability   { "date": "2026-10-27" }   (what the Vapi tool sends)
//
// Auth: x-webhook-secret / x-vapi-secret header, or ?k=, matching
// SMS_WEBHOOK_SECRET (env) or settings.sms_webhook_secret. The same secret
// /api/vapi-call-ended already uses, so Vapi holds nothing new. The service-role
// key stays on this side; Vapi never sees it.
//
// Busy comes from two places, because the two systems that book are separate:
//   1. invoices: gcal_date and every entry of visits[] (Lisa's own bookings and
//      the app's, including ones whose Google event never got created).
//   2. Google Calendar: every calendar in google_credentials.read_calendar_ids
//      plus the write calendar (Jake's personal calendar and Work), so a dentist
//      appointment that is on no invoice still blocks.
//
// FAILS CLOSED. If Google cannot be read the answer is a 502, not a partial
// list: a partial list that omits the calendar is exactly the silent double
// booking this route exists to stop. Lisa is told to promise a callback instead.
//
// Edge runtime on purpose: the project sits at the Hobby plan's 12 Node
// function cap (see CLAUDE.md), and edge routes do not count. That rules out
// node:crypto, so this does NOT import _lib/gcal.js; the token refresh below is
// the same logic with fetch only. Keep the two in step.

export const config = { runtime: 'edge' };

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const HST_OFFSET_MIN = -600;          // Hawaii has no daylight saving
const DAY_START_MIN = 8 * 60;         // 8am
const DAY_END_MIN = 18 * 60;          // 6pm
const MIN_SLOT_MIN = 90;
const DEFAULT_VISIT_MIN = 90;         // when a visit carries no length
const LEAD_TIME_MIN = 60;             // never offer a slot starting inside the next hour

const supaUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || SUPABASE_URL_FALLBACK;

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function sbGet(path) {
  const r = await fetch(`${supaUrl()}/rest/v1/${path}`, { headers: svcHeaders() });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function expectedSecret() {
  if (process.env.SMS_WEBHOOK_SECRET) return process.env.SMS_WEBHOOK_SECRET;
  const rows = await sbGet('settings?key=eq.sms_webhook_secret&select=value&limit=1');
  return rows?.[0]?.value || null;
}

function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Time helpers (all minutes-of-day are Hawaii wall clock) ────────────────

const pad = n => String(n).padStart(2, '0');
const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function nextDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function label(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? ':' + pad(mm) : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function hawaiiNow() {
  const t = new Date(Date.now() + HST_OFFSET_MIN * 60000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// 'YYYY-MM-DDTHH:MM' local text -> minutes of `date`, or null if another day.
// gcal_date / visits[].start are local text with no offset (see CLAUDE.md); never
// pass them through Date().
function localTextToMinutes(text, date) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(text || ''));
  if (!m || m[1] !== date) return null;
  return Number(m[2]) * 60 + Number(m[3]);
}

// An absolute instant (Google gives an offset) -> {date, minutes} in Hawaii.
function instantToHawaii(iso) {
  const t = new Date(new Date(iso).getTime() + HST_OFFSET_MIN * 60000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// ─── Source 1: invoices ─────────────────────────────────────────────────────

async function invoiceBlocks(date) {
  const next = nextDate(date);
  // Any document with a visit on `date` has its EARLIEST visit (gcal_date) on or
  // before that day, so one upper bound catches both a lead's bare gcal_date and
  // a later visit in a multi-visit job.
  const cols = 'id,gcal_date,gcal_duration_minutes,visits,client_name,declined_at';
  const rows = await sbGet(
    `invoices?deleted_at=is.null&gcal_date=lt.${next}T00:00&select=${cols}` +
    `&order=gcal_date.desc&limit=1500`
  );
  const blocks = [];
  for (const inv of rows) {
    if (inv.declined_at) continue;
    const who = `${inv.id}${inv.client_name ? ' ' + inv.client_name : ''}`;
    const visits = Array.isArray(inv.visits) ? inv.visits : [];
    const entries = visits.length
      ? visits.map(v => ({ start: v.start, minutes: v.minutes }))
      : [{ start: inv.gcal_date, minutes: inv.gcal_duration_minutes }];
    for (const e of entries) {
      const s = localTextToMinutes(e.start, date);
      if (s == null) continue;
      const len = Number(e.minutes) > 0 ? Number(e.minutes) : (Number(inv.gcal_duration_minutes) > 0 ? Number(inv.gcal_duration_minutes) : DEFAULT_VISIT_MIN);
      blocks.push({ s, e: Math.min(s + len, 24 * 60), summary: who, source: 'invoice' });
    }
  }
  return blocks;
}

// ─── Source 2: Google Calendar (inline token logic; see header) ─────────────

let tokenMemo = { token: null, expires: 0 };

async function googleToken() {
  const now = Date.now();
  if (tokenMemo.token && tokenMemo.expires > now + 60000) return { token: tokenMemo.token };
  const rows = await sbGet('google_credentials?id=eq.google_calendar&select=*&limit=1');
  const cred = rows?.[0];
  if (!cred?.refresh_token) throw new Error('Google Calendar is not connected');
  const stored = cred.access_token_expires_at ? Date.parse(cred.access_token_expires_at) : 0;
  if (cred.access_token && stored > now + 60000) {
    tokenMemo = { token: cred.access_token, expires: stored };
    return { token: cred.access_token, cred };
  }
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Google OAuth client is not configured');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: cred.refresh_token, grant_type: 'refresh_token' }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google token refresh failed: ${j.error_description || j.error || r.status}`);
  const expires = now + (j.expires_in || 3600) * 1000;
  tokenMemo = { token: j.access_token, expires };
  // Best effort cache, same as _lib/gcal.js.
  fetch(`${supaUrl()}/rest/v1/google_credentials?on_conflict=id`, {
    method: 'POST',
    headers: { ...svcHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 'google_calendar', access_token: j.access_token, access_token_expires_at: new Date(expires).toISOString(), updated_at: new Date().toISOString() }),
  }).catch(() => {});
  return { token: j.access_token, cred };
}

async function googleBlocks(date) {
  let { token, cred } = await googleToken();
  if (!cred) cred = (await sbGet('google_credentials?id=eq.google_calendar&select=calendar_id,read_calendar_ids&limit=1'))?.[0];
  const ids = Array.isArray(cred?.read_calendar_ids) ? cred.read_calendar_ids.filter(Boolean) : [];
  const calendars = Array.from(new Set([...ids, cred?.calendar_id || 'primary']));

  // The Hawaii day is 10:00Z to 10:00Z the next day.
  const timeMin = `${date}T10:00:00Z`;
  const timeMax = `${nextDate(date)}T10:00:00Z`;

  const lists = await Promise.all(calendars.map(async calId => {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`Google Calendar ${calId} answered ${r.status}`);
    return (await r.json()).items || [];
  }));

  const blocks = [];
  const allDay = [];
  for (const ev of lists.flat()) {
    if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
    // An event Jake declined does not occupy him.
    const me = (ev.attendees || []).find(a => a.self);
    if (me?.responseStatus === 'declined') continue;
    const summary = ev.summary || '(no title)';
    if (!ev.start?.dateTime) { allDay.push(summary); continue; }
    const s = instantToHawaii(ev.start.dateTime);
    const e = instantToHawaii(ev.end?.dateTime || ev.start.dateTime);
    const sMin = s.date < date ? 0 : s.minutes;
    const eMin = e.date > date ? 24 * 60 : e.minutes;
    if (eMin <= sMin) continue;
    blocks.push({ s: sMin, e: eMin, summary, source: 'google' });
  }
  return { blocks, allDay };
}

// ─── Merge + free slots ─────────────────────────────────────────────────────

function merge(blocks) {
  const sorted = [...blocks].sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.s <= last.e) {
      last.e = Math.max(last.e, b.e);
      if (!last.summaries.includes(b.summary)) last.summaries.push(b.summary);
    } else {
      out.push({ s: b.s, e: b.e, summaries: [b.summary] });
    }
  }
  return out;
}

function freeSlots(merged, date) {
  let from = DAY_START_MIN;
  const now = hawaiiNow();
  if (date === now.date) from = Math.max(from, Math.ceil((now.minutes + LEAD_TIME_MIN) / 15) * 15);
  const slots = [];
  let cursor = from;
  for (const b of merged) {
    if (b.s - cursor >= MIN_SLOT_MIN) slots.push({ s: cursor, e: Math.min(b.s, DAY_END_MIN) });
    cursor = Math.max(cursor, b.e);
  }
  if (DAY_END_MIN - cursor >= MIN_SLOT_MIN) slots.push({ s: cursor, e: DAY_END_MIN });
  return slots.filter(x => x.e - x.s >= MIN_SLOT_MIN && x.s < DAY_END_MIN);
}

// ─── Handler ────────────────────────────────────────────────────────────────

async function readDate(req) {
  const url = new URL(req.url);
  let date = url.searchParams.get('date');
  if (!date && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    // Accept the flat body the apiRequest tool sends and Vapi's server-tool
    // envelope, so repointing the tool never silently drops the date.
    const call = body?.message?.toolCallList?.[0] || body?.message?.toolCalls?.[0];
    let args = call?.function?.arguments ?? call?.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
    date = body?.date || args?.date || null;
  }
  return date;
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return respond(405, { error: 'GET or POST only' });

  const url = new URL(req.url);
  const provided = req.headers.get('x-webhook-secret') || req.headers.get('x-vapi-secret') || url.searchParams.get('k');
  try {
    if (!sameSecret(provided, await expectedSecret())) return respond(401, { error: 'unauthorized' });
  } catch (e) {
    return respond(500, { error: 'auth unavailable', detail: e.message });
  }

  const date = await readDate(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return respond(400, { error: 'date is required as YYYY-MM-DD' });
  }
  if (date < hawaiiNow().date) return respond(400, { error: 'date is in the past' });

  try {
    const [inv, g] = await Promise.all([invoiceBlocks(date), googleBlocks(date)]);
    const merged = merge([...inv, ...g.blocks]);
    const slots = freeSlots(merged, date);

    const busy = merged.map(b => ({
      start: `${date}T${hhmm(b.s)}`, end: `${date}T${hhmm(b.e)}`, summary: b.summaries.join(' | '),
    }));
    const suggested = slots.map(x => ({
      start: `${date}T${hhmm(x.s)}`, end: `${date}T${hhmm(x.e)}`, label: `${label(x.s)} to ${label(x.e)}`,
    }));

    return respond(200, {
      ok: true,
      date,
      timezone: 'Pacific/Honolulu',
      busy,
      all_day_events: g.allDay,
      suggested_free_slots: suggested,
      // Lisa reads this. Customer names stay out of it on purpose.
      guidance: suggested.length
        ? `Free windows of 90 minutes or more between 8 AM and 6 PM: ${suggested.map(s => s.label).join('; ')}. Offer one of these. Any time outside them is not available. Do not tell the caller what the other appointments are.`
        : 'No window of 90 minutes or more is free on this date. Tell the caller that day is full and offer a different day.',
    });
  } catch (e) {
    console.error('[availability]', e.message);
    return respond(502, {
      ok: false,
      error: 'availability_unavailable',
      guidance: 'The calendar could not be checked. Do not confirm any time. Tell the caller you will call them back to confirm the time.',
    });
  }
}

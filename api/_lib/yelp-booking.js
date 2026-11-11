// Who is this Yelp customer, what is already on the calendar for them, and the
// writes Lisa may make from a Yelp thread (v1.63.0). Used by ./yelp-agent.js.
//
// Yelp never gives us a phone number, so a thread is anonymous until matched:
//   phone    the customer typed a number that is on a client record  (verified)
//   address  the service address they gave matches one client       (verified)
//   name     Yelp's "Javier D." matches exactly one client who has a visit
//            coming up. Lisa may confirm a day and time, nothing else, and must
//            verify before requesting a change.
//
// Booking goes through the same create_estimate_from_lead() RPC as phone and
// text leads, so a Yelp booking is an ordinary penciled estimate plus the usual
// owner alert. Reschedule: Lisa MOVES the visit herself (v1.74.0, Jake
// 2026-11-11: "don't pass it to the team, just book it") when the new time is in
// business hours and the calendar is clear: Google event first through the
// stored grant (./gcal.js), then invoices.visits. Cancel still goes through
// request_visit_change() (114), which only records it for Jake.

import { rpc, getSetting } from './sms.js';
import { calendarFetch, getCredentials } from './gcal.js';

function supabaseUrl() {
  return process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
}
function sbHeaders() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return { 'Content-Type': 'application/json', apikey: k, Authorization: `Bearer ${k}` };
}
async function select(path) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) return [];
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
}

// create_estimate_from_lead and lookup_client_by_phone check 'lead_secret',
// NOT 'sms_webhook_secret'. They are different values (see sms-agent.js).
async function leadSecret() {
  return process.env.LEAD_SECRET || (await getSetting('lead_secret'));
}

/** Hawaii wall clock. The database runs UTC; every date Lisa says is Hawaii time. */
export function hawaiiNow() {
  const d = new Date(Date.now() - 10 * 3600 * 1000);
  return {
    iso: d.toISOString().slice(0, 10),
    pretty: d.toISOString().replace('T', ' ').slice(0, 16),
    weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()],
  };
}

/** '2026-11-06T09:00' -> 'Friday Nov 6 at 9 AM' */
export function speakVisit(t) {
  const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  if (t.length < 16) return `${day} ${mon} ${d.getUTCDate()}`;
  const h = Number(t.slice(11, 13)), mm = t.slice(14, 16);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${mon} ${d.getUTCDate()} at ${h12}${mm === '00' ? '' : ':' + mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The client's next visits (today onward, Hawaii), soonest first. Same rule as migration 113. */
export async function upcomingVisits(clientId) {
  if (!clientId) return [];
  const today = hawaiiNow().iso;
  const docs = await select(
    `invoices?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=id,type,visits`);
  const out = [];
  for (const doc of docs) {
    for (const v of Array.isArray(doc.visits) ? doc.visits : []) {
      const start = String(v?.start || '');
      if (start && start >= today) {
        out.push({ start, what: String(v.label || v.kind || '').trim(), doc: doc.id, on_calendar: !!v.eventId });
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
}

/** Time (Hawaii, '9:42 AM') of today's "On My Way" text for any of these documents, else null. */
export async function onMyWayToday(docIds) {
  const ids = [...new Set((docIds || []).filter(Boolean))];
  if (!ids.length) return null;
  // Midnight Hawaii is 10:00 UTC.
  const since = `${hawaiiNow().iso}T10:00:00Z`;
  const rows = await select(
    `invoice_versions?invoice_id=in.(${ids.map(encodeURIComponent).join(',')})` +
    `&event_type=eq.sms_sent&note=ilike.*on%20my%20way*&sent_at=gte.${since}&select=sent_at&order=sent_at.desc&limit=1`);
  if (!rows[0]?.sent_at) return null;
  const hst = new Date(Date.parse(rows[0].sent_at) - 10 * 3600 * 1000);
  const h = hst.getUTCHours(), m = String(hst.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

async function getClient(id) {
  const rows = await select(
    `clients?id=eq.${encodeURIComponent(id)}&select=id,name,first_name,last_name,email,email2,phone,mobile,address1,address_unit&limit=1`);
  return rows[0] || null;
}

/** "Javier D." -> { first: 'Javier', initial: 'D' } */
function parseYelpName(display) {
  const parts = String(display || '').trim().replace(/[^A-Za-z.'\- ]/g, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0].replace(/\.$/, '');
  const initial = parts[1] ? parts[1][0].toUpperCase() : null;
  return first.length >= 2 ? { first, initial } : null;
}

function lastInitialOf(c, first) {
  const last = String(c.last_name || '').trim()
    || String(c.name || '').trim().slice(first.length).trim();
  return last ? last[0].toUpperCase() : null;
}

/**
 * Best match for this Yelp customer. Strongest evidence wins, and a link that
 * is already verified is never downgraded to a name guess.
 * @returns {Promise<{client: object|null, level: 'phone'|'address'|'name'|null}>}
 */
export async function matchClient({ clientId, level, displayName, phone, address }) {
  let current = null;
  if (clientId) {
    const c = await getClient(clientId);
    if (c) current = { client: c, level };
    if (current && level !== 'name') return current;
  }

  // Phone the customer typed: the same lookup Lisa's phone line uses.
  if (phone) {
    try {
      const r = await rpc('lookup_client_by_phone', { p_secret: await leadSecret(), p_phone: phone });
      if (r?.found && r.client_id) {
        const c = await getClient(r.client_id);
        if (c) return { client: c, level: 'phone' };
      }
    } catch (e) {
      console.error('[yelp-booking] phone lookup failed:', e.message || e);
    }
  }

  // Service address: house number plus first street word must match one client.
  const m = String(address || '').match(/^\s*(\d+[A-Za-z]?)\s+([A-Za-z]{3,})/);
  if (m) {
    const rows = await select(
      `clients?address1=ilike.${encodeURIComponent(`${m[1]} ${m[2]}*`)}&select=id&limit=3`);
    if (rows.length === 1) {
      const c = await getClient(rows[0].id);
      if (c) return { client: c, level: 'address' };
    }
  }

  if (current) return current;

  // Yelp name: unique among clients who have a visit coming up. A common first
  // name with no visit on the books is a new customer, not a match.
  const n = parseYelpName(displayName);
  if (!n) return { client: null, level: null };
  const rows = await select(
    `clients?or=(first_name.ilike.${encodeURIComponent(n.first)},name.ilike.${encodeURIComponent(n.first)},name.ilike.${encodeURIComponent(n.first + ' *')})` +
    `&select=id,name,first_name,last_name,email,email2,phone,mobile,address1,address_unit&limit=20`);
  // A record with no last name (a quick-add like "Diane") cannot contradict the
  // initial, so it stays a candidate; uniqueness below still has to hold.
  const byInitial = rows.filter((c) => {
    const li = lastInitialOf(c, n.first);
    return !n.initial || !li || li === n.initial;
  });
  const withVisits = [];
  for (const c of byInitial) {
    if ((await upcomingVisits(c.id)).length) withVisits.push(c);
    if (withVisits.length > 1) break;
  }
  return withVisits.length === 1 ? { client: withVisits[0], level: 'name' } : { client: null, level: null };
}

/**
 * Pencil a visit: same RPC and calendar push as a text lead.
 * @returns {Promise<string|null>} the new estimate id, or null
 */
export async function bookVisit({ name, phone, address, problem, appointment, urgency, services }) {
  const filed = await rpc('create_estimate_from_lead', {
    p_secret: await leadSecret(),
    p_name: name || 'Yelp lead - no name given',
    p_phone: phone,
    p_caller_id: phone,
    p_address: address,
    p_problem: String(problem || '').slice(0, 500) || 'Yelp lead',
    p_urgency: urgency || null,
    p_services: Array.isArray(services) && services.length ? services : null,
    p_appointment: appointment || null,
    p_heard_from: 'yelp',
    p_lead_channel: 'yelp',
  });
  const id = filed?.estimate_id || null;
  if (id) {
    // Backup push in case the insert trigger did not fire. Migration 119 makes
    // it skip while the trigger's push is in flight, so this cannot duplicate.
    try { await rpc('push_invoice_to_calendar', { p_id: id }); }
    catch (e) { console.error('[yelp-booking] calendar push failed (non-fatal):', e.message || e); }
  }
  return id;
}

/** Record a reschedule or cancel REQUEST. Jake makes the change. Keyed on the client's phone on file. */
export async function requestChange({ phone, action, visitStart, newTime, reason }) {
  return rpc('request_visit_change', {
    p_secret: await leadSecret(),
    p_phone: phone,
    p_action: action,
    p_visit_start: visitStart || null,
    p_new_time: newTime || null,
    p_reason: reason ? `Yelp: ${String(reason).slice(0, 300)}` : 'Requested on Yelp',
  });
}

/**
 * Real open times Lisa can offer, from the same /api/availability the phone
 * line uses (calendar + every booked visit, fails closed). Weekdays only and
 * starts between 8 AM and 3 PM: in the visit history Jake books Monday to
 * Friday, one Saturday ever, almost never after 3. One morning and one
 * afternoon option per day, soonest first.
 * @returns {Promise<Array<{start:string, spoken:string}>>} empty when the calendar could not be read
 */
export async function openSlots({ max = 4, days = 3, prefer = [] } = {}) {
  const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';
  const { webhookSecret } = await import('./sms.js');
  const secret = await webhookSecret().catch(() => null);
  if (!secret) return [];

  // Days the customer named come first, so "can you come Thursday?" is
  // answered from Thursday's real calendar, never guessed.
  const preferred = [...new Set(prefer)].filter(Boolean);
  const dates = [...preferred];
  const base = new Date(`${hawaiiNow().iso}T00:00:00Z`);
  for (let i = 0, added = 0; added < days + 1 && i < 10; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !dates.includes(iso)) { dates.push(iso); added++; }
  }
  const toMin = (t) => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  const results = await Promise.all(dates.map(async (date) => {
    try {
      const r = await fetch(`${APP_URL}/api/availability?date=${date}`, {
        headers: { 'x-webhook-secret': secret }, signal: AbortSignal.timeout(6000),
      });
      const j = await r.json().catch(() => null);
      return r.ok && j?.ok && Array.isArray(j.suggested_free_slots) ? { date, slots: j.suggested_free_slots } : null;
    } catch { return null; }
  }));
  // One failed day is skipped; if nothing came back, offer nothing rather
  // than guess (the prompt then asks what day works).
  const out = [];
  const fullDays = [];
  for (const day of results.filter(Boolean)) {
    let morning = null, afternoon = null;
    for (const w of day.slots) {
      // First on-the-hour start inside the window that leaves 90 minutes.
      let s = Math.ceil(toMin(w.start) / 60) * 60;
      for (; s + 90 <= toMin(w.end) && s <= 15 * 60; s += 60) {
        if (s < 8 * 60) continue;
        const t = `${day.date}T${String(s / 60).padStart(2, '0')}:00`;
        if (s < 12 * 60 && !morning) morning = t;
        if (s >= 12 * 60 && !afternoon) afternoon = t;
      }
    }
    const isPreferred = preferred.includes(day.date);
    if (!morning && !afternoon && isPreferred) fullDays.push(speakVisit(day.date));
    for (const t of [morning, afternoon]) if (t) out.push({ start: t, spoken: speakVisit(t), asked: isPreferred });
  }
  // Every opening on a day they asked for, then the soonest others up to max.
  const asked = out.filter((x) => x.asked);
  const rest = out.filter((x) => !x.asked).slice(0, Math.max(0, max - asked.length));
  const slots = [...asked, ...rest];
  slots.fullDays = fullDays;
  return slots;
}

/** Weekday dates the customer named ("Thursday", "tomorrow", "11/12"), as YYYY-MM-DD, today onward. */
export function requestedDates(text) {
  const t = String(text || '').toLowerCase();
  const today = new Date(`${hawaiiNow().iso}T00:00:00Z`);
  const out = [];
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  names.forEach((n, idx) => {
    if (new RegExp(`\\b${n}s?\\b|\\b${n.slice(0, 3)}\\b`).test(t)) {
      const ahead = (idx - today.getUTCDay() + 7) % 7;
      out.push(new Date(today.getTime() + ahead * 86400000));
    }
  });
  if (/\btomorrow\b/.test(t)) out.push(new Date(today.getTime() + 86400000));
  if (/\btoday\b/.test(t)) out.push(today);
  for (const m of t.matchAll(/\b(1[0-2]|0?[1-9])\/([12]\d|3[01]|0?[1-9])\b/g)) {
    let d = new Date(Date.UTC(today.getUTCFullYear(), Number(m[1]) - 1, Number(m[2])));
    if (d < today) d = new Date(Date.UTC(today.getUTCFullYear() + 1, Number(m[1]) - 1, Number(m[2])));
    out.push(d);
  }
  return out.filter((d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6).map((d) => d.toISOString().slice(0, 10));
}

/**
 * Business hours Lisa may book or move into on her own: a weekday, starting
 * 8 AM to 3 PM Hawaii (the same window openSlots offers), at least an hour out.
 * @param {string} t 'YYYY-MM-DDTHH:MM' Hawaii wall clock
 */
export function inBusinessHours(t) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(t || ''));
  if (!m) return false;
  const day = new Date(`${m[1]}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  const min = Number(m[2]) * 60 + Number(m[3]);
  if (min < 8 * 60 || min > 15 * 60) return false;
  const asUtc = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00-10:00`);
  return asUtc > Date.now() + 60 * 60 * 1000;
}

// 'YYYY-MM-DDTHH:MM' + minutes, as wall clock (Hawaii has no DST).
function addMinutes(t, minutes) {
  const d = new Date(Date.parse(`${t.slice(0, 16)}:00Z`) + minutes * 60000);
  return d.toISOString().slice(0, 16);
}

/**
 * Move one of this client's visits to newTime. The caller has already checked
 * inBusinessHours() and the calendar. Google first: if the event cannot be
 * moved, nothing in the app changes and the caller tells Jake. Then the visit
 * on the document, then a history row.
 * @returns {Promise<{ok:boolean, doc?:string, from?:string, to?:string, reason?:string}>}
 */
export async function moveVisit({ clientId, visitStart, newTime }) {
  const to = String(newTime || '').slice(0, 16);
  if (!clientId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to)) return { ok: false, reason: 'missing client or time' };
  const today = hawaiiNow().iso;
  const docs = await select(
    `invoices?client_id=eq.${encodeURIComponent(clientId)}&deleted_at=is.null&select=id,visits`);
  const upcoming = [];
  for (const doc of docs) {
    (Array.isArray(doc.visits) ? doc.visits : []).forEach((v, i) => {
      if (String(v?.start || '') >= today) upcoming.push({ doc, i, v });
    });
  }
  const want = String(visitStart || '').slice(0, 16);
  const hit = want ? upcoming.find((x) => String(x.v.start).slice(0, 16) === want)
    : (upcoming.length === 1 ? upcoming[0] : null);
  if (!hit) return { ok: false, reason: want ? 'no visit at that time' : 'which visit is unclear' };
  const from = String(hit.v.start).slice(0, 16);
  if (from === to) return { ok: true, doc: hit.doc.id, from, to, unchanged: true };
  const minutes = Number(hit.v.minutes) || 90;

  if (hit.v.eventId) {
    const id = String(hit.v.eventId).replace(/@google\.com$/, '');
    const cred = await getCredentials();
    const cals = [...new Set([cred?.calendar_id || 'primary', ...(cred?.read_calendar_ids || [])].filter(Boolean))];
    const patch = {
      start: { dateTime: `${to}:00`, timeZone: 'Pacific/Honolulu' },
      end: { dateTime: `${addMinutes(to, minutes)}:00`, timeZone: 'Pacific/Honolulu' },
    };
    let moved = false;
    let lastErr = null;
    for (const cal of cals) {
      try {
        await calendarFetch(`/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(id)}`, {
          method: 'PATCH', body: JSON.stringify(patch),
        });
        moved = true;
        break;
      } catch (e) {
        lastErr = e;
        if (e.status !== 404 && e.status !== 410) break;
      }
    }
    if (!moved) return { ok: false, reason: `calendar: ${lastErr?.message || 'event not found'}` };
  }

  const visits = hit.doc.visits.map((v, i) => (i === hit.i ? { ...v, start: to } : v));
  const r = await fetch(`${supabaseUrl()}/rest/v1/invoices?id=eq.${encodeURIComponent(hit.doc.id)}`, {
    method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    // updated_at is the app's stale-save lock (db.js expected_updated_at):
    // without bumping it, an estimate left open in the app saves its old
    // visit back over this move (EST1204, 2026-11-11).
    body: JSON.stringify({ visits, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return { ok: false, doc: hit.doc.id, reason: `calendar moved but the app did not save (${r.status})` };
  await fetch(`${supabaseUrl()}/rest/v1/invoice_events`, {
    method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ invoice_id: hit.doc.id, kind: 'visit_moved', recipient: null, meta: { from, to, via: 'lisa_yelp' } }),
  }).catch(() => {});
  return { ok: true, doc: hit.doc.id, from, to };
}

/** The client a document belongs to (a thread's booking), or null. */
export async function clientIdForDoc(docId) {
  if (!docId) return null;
  const rows = await select(`invoices?id=eq.${encodeURIComponent(docId)}&select=client_id&limit=1`);
  return rows[0]?.client_id || null;
}

/**
 * What the customer told Lisa, onto their client profile (v1.75.0, Jake
 * 2026-11-11: "lisa should be actively adding it to their client profile").
 * Fills EMPTY fields only, never overwrites what Jake typed: a different
 * email goes to the secondary email when that is empty. A full name fills
 * first / last when last is empty and the first name agrees, and upgrades a
 * one-word display name ("Dan" -> "Dan Miyamoto").
 * Only for a client this thread booked or a phone/address-verified match:
 * the caller decides that.
 * @returns {Promise<string[]>} the fields written
 */
export async function saveClientContact({ clientId, fullName, email, phone, address }) {
  if (!clientId) return [];
  const rows = await select(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,name,first_name,last_name,company_name,email,email2,phone,mobile,address1&limit=1`);
  const c = rows[0];
  if (!c) return [];
  const patch = {};
  const em = String(email || '').trim().toLowerCase();
  if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    const has = [c.email, c.email2].map((x) => String(x || '').toLowerCase());
    if (!c.email) patch.email = em;
    else if (!has.includes(em) && !c.email2) patch.email2 = em;
  }
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length === 10 && !c.mobile && !c.phone) patch.mobile = `+1${digits}`;
  const addr = String(address || '').trim();
  if (addr && !c.address1) patch.address1 = addr.slice(0, 300);
  const parts = String(fullName || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length >= 2 && parts.every((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w)) && !c.last_name && !c.company_name) {
    const first = parts[0], last = parts.slice(1).join(' ');
    const known = String(c.first_name || String(c.name || '').split(' ')[0] || '').toLowerCase();
    if (!known || known === first.toLowerCase()) {
      patch.first_name = first;
      patch.last_name = last;
      if (!String(c.name || '').trim().includes(' ')) patch.name = `${first} ${last}`;
    }
  }
  const fields = Object.keys(patch);
  if (!fields.length) return [];
  const r = await fetch(`${supabaseUrl()}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`, {
    method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`clients update ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return fields;
}

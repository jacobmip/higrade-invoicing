// Asks /api/availability whether one proposed appointment fits Jake's calendar.
//
// Shared by the SMS agent and the web form, which used to book whatever time
// the customer asked for. Vapi's `checkAvailability` tool already goes through
// the same endpoint. A helper, not a route, to stay under the function cap.
//
// Never throws. Anything that stops us getting a clear answer (no secret, a
// 502 because Google could not be read, a timeout, a malformed time) comes back
// as status 'error', and the caller must then NOT book blind.

import { webhookSecret } from './sms.js';

const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';
const MIN_SLOT_MIN = 90;

const toMin = (t) => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));

/**
 * @param {string} appointment  'YYYY-MM-DDTHH:MM' Hawaii wall clock
 * @returns {Promise<{status:'free'|'busy'|'error', date?:string, slots?:Array, next?:object|null, detail?:string}>}
 */
export async function checkAppointment(appointment) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(appointment || ''));
  if (!m) return { status: 'error', detail: 'unparseable appointment time' };
  const date = m[1];
  const start = `${date}T${m[2]}`;

  try {
    const secret = await webhookSecret();
    if (!secret) return { status: 'error', detail: 'no webhook secret' };
    const res = await fetch(`${APP_URL}/api/availability?date=${date}`, {
      headers: { 'x-webhook-secret': secret },
      signal: AbortSignal.timeout(7000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return { status: 'error', date, detail: `availability ${res.status}` };

    const slots = Array.isArray(json.suggested_free_slots) ? json.suggested_free_slots : [];
    const s = toMin(start);
    // Free only if the visit has a full 90 minutes of room inside one free window.
    const fits = slots.some((x) => s >= toMin(x.start) && toMin(x.end) - s >= MIN_SLOT_MIN);
    if (fits) return { status: 'free', date, slots };

    // Next opening: first window starting after the request, else the first of the day.
    const next = slots.find((x) => toMin(x.start) > s) || slots[0] || null;
    return { status: 'busy', date, slots, next };
  } catch (e) {
    return { status: 'error', date, detail: e?.name || e?.message || 'failed' };
  }
}

/** '2026-10-29T14:00' -> 'Thursday at 2 PM' */
export function speakSlot(t) {
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(`${t.slice(0, 10)}T00:00:00Z`).getUTCDay()
  ];
  const h = Number(t.slice(11, 13)), mm = t.slice(14, 16);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} at ${h12}${mm === '00' ? '' : ':' + mm} ${h < 12 ? 'AM' : 'PM'}`;
}

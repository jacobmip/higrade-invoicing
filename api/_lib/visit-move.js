// Lisa moves a booked visit herself, on every channel (lisa-soul.js: "Moving a
// visit: you move it yourself"). One path for text and the phone, so a move on
// a call is as real as a move by text: hours check, calendar check, then the
// calendar event and the app both change. Jake gets one Telegram either way.
//
// Returns { status, from, to, doc, next, reason }. status is one of
//   moved | unchanged | outside_hours | busy | check_failed | failed
// The caller turns it into words for its channel. A helper, not a route.

import { checkAppointment } from './availability-check.js';
import { moveVisit, inBusinessHours, speakVisit } from './yelp-booking.js';
import { telegramNotify } from './convert-estimate.js';

export async function lisaMoveVisit({ clientId, visitStart = null, newTime, who, phone, channel }) {
  const to = String(newTime || '').trim().slice(0, 16);
  const by = channel === 'phone' ? 'on a call' : `by ${channel}`;
  if (!inBusinessHours(to)) return { status: 'outside_hours', to };
  const chk = await checkAppointment(to);
  if (chk.status === 'busy') return { status: 'busy', to, next: chk.next || null };
  if (chk.status !== 'free') return { status: 'check_failed', to, reason: chk.detail || 'availability check failed' };
  const r = await moveVisit({ clientId, visitStart, newTime: to }).catch((e) => ({ ok: false, reason: e.message || String(e) }));
  if (r.ok && r.unchanged) return { status: 'unchanged', from: r.from, to, doc: r.doc };
  if (r.ok) {
    await telegramNotify(`Lisa moved ${who}'s visit ${by}: ${speakVisit(r.from)} -> ${speakVisit(r.to)} (${r.doc}). Calendar and app updated.`).catch(() => {});
    return { status: 'moved', from: r.from, to: r.to, doc: r.doc };
  }
  await telegramNotify(`Reschedule ${by} NOT applied for ${who}: ${r.reason}.\nWants: ${speakVisit(to)}${visitStart ? ` (was ${speakVisit(visitStart)})` : ''}\nMove it in the app and confirm by text.\n${phone || ''}`).catch(() => {});
  return { status: 'failed', to, reason: r.reason };
}

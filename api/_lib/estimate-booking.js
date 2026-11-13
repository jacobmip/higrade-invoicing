// Booking work from an estimate already sent to the customer (Jake 2026-11-12:
// "Lisa should book it automatically"). Zoe got EST1209 by text, then asked
// "When are you available to come and install it?". The visit belongs on that
// estimate: a new lead would duplicate the job. Used by Yelp Lisa; text Lisa
// has the same logic inline in sms-agent.js.

import { supabaseUrl, rpc } from './sms.js';

const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = () => ({ apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' });
async function select(path) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { headers: headers() });
  if (!r.ok) throw new Error(`select ${r.status}`);
  return r.json();
}
const fuzzyPhone = (d) => `*${d.slice(0, 3)}*${d.slice(3, 6)}*${d.slice(6)}*`;

/**
 * Estimates sent to this customer in the last 60 days (sent / pending / approved).
 * @returns {Promise<Array<{id, date, status, gcal_date, notes, items: string[]}>>}
 */
export async function sentEstimates({ clientId, phone }) {
  const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
  const who = [clientId && `client_id.eq.${clientId}`, last10.length === 10 && `client_info->>phone.ilike.${fuzzyPhone(last10)}`].filter(Boolean);
  if (!who.length) return [];
  const since = new Date(Date.now() - 60 * 86400e3).toISOString();
  const ests = await select(`invoices?or=(${encodeURIComponent(who.join(','))})&type=eq.estimate&deleted_at=is.null`
    + `&status=in.(sent,pending,approved)&created_at=gte.${encodeURIComponent(since)}`
    + '&select=id,date,status,gcal_date,notes&order=created_at.desc&limit=3');
  if (!Array.isArray(ests) || !ests.length) return [];
  const items = await select(`invoice_items?invoice_id=in.(${encodeURIComponent(ests.map((e) => e.id).join(','))})&select=invoice_id,name,description,qty&order=sort_order`);
  return ests.map((e) => ({
    ...e,
    items: (Array.isArray(items) ? items : []).filter((i) => i.invoice_id === e.id)
      .map((i) => `${Number(i.qty) > 1 ? `${i.qty} x ` : ''}${i.name}${i.description ? ` (${String(i.description).replace(/\s*\n\s*/g, '; ').slice(0, 220)})` : ''}`),
  }));
}

/** The prompt block for those estimates, '' when there are none. */
export function sentEstimatesPrompt(ests) {
  if (!ests?.length) return '';
  const lines = ests.map((e) => `- ${e.id}, sent ${e.date}, ${e.status === 'approved' ? 'APPROVED' : 'not approved yet'}`
    + `${e.gcal_date ? `, scheduled ${String(e.gcal_date).slice(0, 16).replace('T', ' at ')}` : ', not scheduled'}: `
    + `${e.items.join('; ') || 'no line items'}${e.notes ? `. Notes on it: ${String(e.notes).slice(0, 200)}` : ''}`);
  return `ESTIMATES ALREADY SENT TO THIS CUSTOMER:
${lines.join('\n')}
When they say "it", "the job" or "the install", they mean this work. Never ask what they want done when an estimate above covers it.
If they want to schedule work from an estimate that is not scheduled yet, book it yourself: agree a day and time, then set appointment to it, set estimate_id to that estimate's number (e.g. "EST1209") and set ready_to_book true. The visit goes on that estimate, so do not ask for the problem, address or phone again. If it is not approved yet, mention once that they can approve it at the link before the visit. If it already shows scheduled, tell them that time and do not rebook.`;
}

/** Put the agreed visit on that estimate and push it to Google Calendar. */
export async function bookOnEstimate({ estimateId, ests, appointment }) {
  try {
    const id = String(estimateId || '').trim().toUpperCase();
    const est = (ests || []).find((e) => e.id === id);
    if (!est) return { ok: false, why: `${id || 'no estimate'} is not one sent to this customer` };
    if (est.gcal_date) return { ok: false, why: `${id} is already scheduled ${est.gcal_date}` };
    const r = await fetch(`${supabaseUrl()}/rest/v1/invoices?id=eq.${encodeURIComponent(id)}&gcal_date=is.null`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ gcal_date: String(appointment).slice(0, 16), updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return { ok: false, why: `save ${r.status}` };
    try { await rpc('push_invoice_to_calendar', { p_id: id }); }
    catch (e) { return { ok: false, why: `saved on ${id}, calendar push failed: ${e.message || e}` }; }
    return { ok: true, estimateId: id };
  } catch (e) {
    return { ok: false, why: e.message || String(e) };
  }
}

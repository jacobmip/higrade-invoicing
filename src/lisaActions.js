// Lisa's outbound actions for the AI chat: send a text from her number and
// queue an outbound call. Shared by the per-invoice chat (JSON actions in
// App.jsx) and the global agent (tools in aiAgent.js), so both behave alike.
//
// Both go through /api/sms-inbound with the admin session (the 12-function cap
// leaves no room for a route of their own). A text sends at once; a call is only
// QUEUED, and the AI-OS runner will not dial without Jake's Telegram approval.

import { supabase } from './supabase.js';
import { api } from './apiBase.js';
import * as db from './db.js';

const digits = (p) => String(p || '').replace(/\D/g, '');

async function post(payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Signed out. Sign in again.');
  const res = await fetch(api('/api/sms-inbound'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

// invoice: the saved estimate/invoice in context, if any; it gets an sms_sent
// version snapshot. Returns the text for the chat.
export async function sendLisaText({ phone, message, invoice }) {
  const p = String(phone || '').trim();
  const body = String(message || '').trim();
  if (digits(p).length < 10) throw new Error('A phone number is needed to send a text.');
  if (!body) throw new Error('The message is empty.');
  const out = await post({ to: p, body });
  if (invoice?.id) {
    try { await db.recordInvoiceVersion(invoice, p, 'Text sent (Lisa)', 'sms_sent'); }
    catch (e) { console.warn('Version snapshot failed:', e); }
  }
  const preview = body.length > 50 ? `${body.slice(0, 50)}...` : body;
  return { ...out, text: `Text sent to ${p}: ${preview}` };
}

export async function queueLisaCall({ phone, name, about, context, invoiceId }) {
  const p = String(phone || '').trim();
  const reason = String(about || '').trim();
  if (digits(p).length < 10) throw new Error('A phone number is needed to place a call.');
  if (!reason) throw new Error('Say why Lisa is calling.');
  const out = await post({ op: 'place_call', phone: p, name, about: reason, context, invoice_id: invoiceId });
  const who = name ? `${name} at ${p}` : p;
  let text = `Call queued for ${who}. You'll get a Telegram approval request before Lisa dials.`;
  if (out.duplicate) text = `That call to ${who} is already queued (#${out.id}). Nothing new was added.`;
  else if (!out.outbound_calls_enabled) text += ' Outbound calls are switched off right now, so it will wait until that is turned on.';
  else if (!out.telegram_sent) text += ' The Telegram heads-up did not send (TELEGRAM_TOKEN missing on Vercel), but the approval request still comes when it is due to dial.';
  return { ...out, text };
}

// Google review request: one text to the client the first time one of their
// invoices goes to paid. Called from App() when it sees a status flip, so it
// covers every path that saves a payment (form, AI chat, a reload after
// PayPal). Never throws: a missed review request must not touch the payment.
//
// "Already sent" is a client_messages row whose body mentions "Google review",
// matched by client_id or by the phone's last 10 digits. A STOP reply is
// handled by Twilio at the carrier, and the send route enforces
// settings.sms_outbound_enabled, so this adds no consent logic of its own.

import { supabase } from './supabase.js';
import * as db from './db.js';
import { sendLisaText } from './lisaActions.js';

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const inFlight = new Set();

export async function maybeSendReviewRequest(invoice, clients) {
  const key = invoice?.client_id || invoice?.id;
  if (!invoice || invoice.type === 'estimate' || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const client = (clients || []).find(c => c.id === invoice.client_id) || null;
    if (client?.blacklisted) return;
    const phone = client?.mobile || client?.phone || invoice.clientInfo?.mobile || invoice.clientInfo?.phone || '';
    const digits = last10(phone);
    if (digits.length < 10) return;

    // A placeholder link would text customers a dead URL, so treat it as unset.
    const link = String((await db.getSetting('google_review_link')) || '').trim();
    if (!link || /PLACEHOLDER/i.test(link)) return;

    const filters = [`phone_number.ilike.%${digits.slice(-4)}`];
    if (invoice.client_id) filters.push(`client_id.eq.${invoice.client_id}`);
    const { data: prior } = await supabase.from('client_messages')
      .select('id, phone_number, client_id')
      .eq('direction', 'outbound').ilike('body', '%Google review%')
      .or(filters.join(',')).limit(50);
    if ((prior || []).some(m => (invoice.client_id && m.client_id === invoice.client_id) || last10(m.phone_number) === digits)) return;

    const who = client?.name || invoice.client || '';
    const first = /no name given|missed call|unknown/i.test(who) ? '' : who.trim().split(/\s+/)[0];
    const message = `Aloha${first ? ' ' + first : ''}! Mahalo for choosing HI Grade Plumbing. If we did a great job, we would love a Google review: ${link} - it means a lot to us. Mahalo!`;
    await sendLisaText({ phone, message });
  } catch (e) {
    console.warn('Review request skipped:', e?.message || e);
  } finally {
    inFlight.delete(key);
  }
}

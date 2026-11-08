// /api/_lib/change-order.js — change orders (migration 111). A helper, not a
// route: the project sits at the 12-function cap, so this is reached through
//   GET  /api/public-invoice?co=<token>          the customer's page reads it
//   POST /api/submit-signature {coToken, ...}    approve (signed) or decline
//   POST /api/sms-inbound (Twilio)               a YES text approves it
//   POST /api/sms-inbound {op:'send_change_order'} (admin) emails and/or texts the link
//
// Approval is automatic and final: the lines are added to the invoice right
// away with the service role. The status flip is a conditional PATCH
// (status = sent), so a double tap, a retry, or a signature plus a YES text
// can only apply the lines once.

import { sendTwilioSms, getSetting, rpc, webhookSecret } from './sms.js';
import { telegramNotify } from './convert-estimate.js';

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const APP_URL = process.env.APP_URL || 'https://higrade-invoicing.vercel.app';

function base() { return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || SUPABASE_URL_FALLBACK; }
function headers(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}
async function rest(path, opts = {}) {
  const r = await fetch(`${base()}/rest/v1/${path}`, { ...opts, headers: headers(opts.headers) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} ${r.status}: ${text.slice(0, 200)}`);
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export const coLabel = (co) => `${co.invoice_id}-CO${co.seq}`;
// Only the photo URLs reach the customer: they are public bucket URLs already.
const photoUrls = (co) => (Array.isArray(co.photos) ? co.photos : [])
  .filter(p => p && /^https:\/\//.test(p.url || '')).map(p => ({ url: p.url }));
const money = (n) => '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function coTotals(items, taxPct) {
  let sub = 0, taxable = 0;
  for (const it of items || []) {
    const line = Number(it.qty ?? 1) * Number(it.price ?? 0);
    sub += line;
    if (it.taxable !== false) taxable += line;
  }
  const tax = Math.round(taxable * Number(taxPct || 0)) / 100;
  return { subtotal: Math.round(sub * 100) / 100, tax, total: Math.round((sub + tax) * 100) / 100 };
}

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Pacific/Honolulu' });
const siteLine = (a) => (a && typeof a === 'object' ? (a.line1 || a.name || '') : String(a || '')).trim();

async function invoiceFor(id) {
  const rows = await rest(`invoices?id=eq.${encodeURIComponent(id)}&select=id,status,tax,client_name,job_address,deleted_at&limit=1`);
  return rows?.[0] || null;
}

// ─── The customer's page ────────────────────────────────────────────────────

export async function loadPublicChangeOrder(token) {
  const rows = await rest(`change_orders?view_token=eq.${encodeURIComponent(token)}&select=id,invoice_id,seq,items,note,photos,status,approved_at,approved_via,approved_name,declined_at&limit=1`);
  const co = rows?.[0];
  if (!co || co.status === 'draft') return null;
  const inv = await invoiceFor(co.invoice_id);
  if (!inv || inv.deleted_at) return null;
  return {
    changeOrder: { ...co, id: undefined, photos: photoUrls(co), label: coLabel(co), totals: coTotals(co.items, inv.tax) },
    job: { invoice_id: inv.id, client_name: inv.client_name, job_address: inv.job_address, tax: inv.tax },
  };
}

// ─── Approval ───────────────────────────────────────────────────────────────

// by: { token } or { id }. via: 'signature' | 'sms'.
export async function approveChangeOrder({ token, id, via, signatureData, name, message }) {
  const key = token ? `view_token=eq.${encodeURIComponent(token)}` : `id=eq.${encodeURIComponent(id)}`;
  const now = new Date().toISOString();
  const won = await rest(`change_orders?${key}&status=eq.sent`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'approved', approved_at: now, approved_via: via,
      approved_name: name ? String(name).slice(0, 120) : null,
      signature_data: signatureData || null,
      approval_message: message ? String(message).slice(0, 500) : null,
      updated_at: now,
    }),
  });
  const co = won?.[0];
  if (!co) {
    const cur = (await rest(`change_orders?${key}&select=status,invoice_id,seq&limit=1`))?.[0];
    if (!cur) return { ok: false, error: 'not_found' };
    if (cur.status === 'approved') return { ok: true, already: true, label: coLabel(cur) };
    return { ok: false, error: cur.status === 'declined' ? 'declined' : 'not_sent' };
  }
  try {
    const applied = await applyToInvoice(co, now);
    await telegramNotify(`Change order ${coLabel(co)} approved by ${via === 'sms' ? 'text' : 'signature'}${co.approved_name ? ` (${co.approved_name})` : ''}: ${money(applied.total)} added to ${co.invoice_id}.`);
    return { ok: true, label: coLabel(co), total: applied.total };
  } catch (e) {
    // Approved but not added: the customer said yes, so never undo that.
    // applied_at stays null, which is what to look for.
    console.error('[change-order] approved but not applied:', coLabel(co), e.message || e);
    await telegramNotify(`Change order ${coLabel(co)} was APPROVED but adding it to ${co.invoice_id} failed: ${e.message || e}. Add the lines by hand.`);
    return { ok: true, label: coLabel(co), applyFailed: true };
  }
}

// Adds the change order's lines at the end of the invoice, marked with the
// change order number and date (the app also uses that mark to keep the lines
// when an open invoice screen saves an older copy, see App.jsx), and bumps
// updated_at so that open screen's next save hits the optimistic lock.
async function applyToInvoice(co, now) {
  const inv = await invoiceFor(co.invoice_id);
  if (!inv) throw new Error('invoice not found');
  const last = await rest(`invoice_items?invoice_id=eq.${encodeURIComponent(co.invoice_id)}&select=sort_order&order=sort_order.desc&limit=1`);
  let order = (Number(last?.[0]?.sort_order) || 0) + 1;
  const mark = coLineMark(co.seq, now);
  const rows = (co.items || []).map(it => ({
    invoice_id: co.invoice_id,
    name: String(it.name || 'Additional work').slice(0, 200),
    description: it.desc ? `${mark} - ${it.desc}` : mark,
    qty: Number(it.qty ?? 1),
    price: Number(it.price ?? 0),
    unit: it.unit || 'ea',
    discount: 0,
    discount_type: '%',
    taxable: it.taxable !== false,
    sort_order: order++,
  }));
  if (rows.length) await rest('invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  const patch = { updated_at: now };
  if (inv.status === 'paid') patch.status = 'partial'; // money is owed again
  await rest(`invoices?id=eq.${encodeURIComponent(co.invoice_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  await rest(`change_orders?id=eq.${co.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ applied_at: now }) });
  const totals = coTotals(co.items, inv.tax);
  try {
    await rest('invoice_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      invoice_id: co.invoice_id, kind: 'change_order_approved',
      meta: { seq: co.seq, label: coLabel(co), via: co.approved_via, name: co.approved_name, total: totals.total, lines: rows.length },
    }) });
  } catch (e) { console.warn('[change-order] history event failed:', e.message || e); }
  return totals;
}

// "Change order #2, approved Nov 8". Kept in sync with CO_MARK_RE in App.jsx.
export function coLineMark(seq, when) { return `Change order #${seq}, approved ${fmtDate(when)}`; }

export async function declineChangeOrder({ token }) {
  const now = new Date().toISOString();
  const won = await rest(`change_orders?view_token=eq.${encodeURIComponent(token)}&status=eq.sent`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'declined', declined_at: now, updated_at: now }),
  });
  const co = won?.[0];
  if (!co) return { ok: false, error: 'not_open' };
  await telegramNotify(`Change order ${coLabel(co)} was declined by the customer. Nothing was added to ${co.invoice_id}.`);
  return { ok: true, label: coLabel(co) };
}

// ─── Text messages ──────────────────────────────────────────────────────────

export function changeOrderText(co, inv) {
  const t = coTotals(co.items, inv.tax);
  const site = siteLine(inv.job_address);
  const lines = (co.items || []).slice(0, 6).map(it => `- ${it.name || 'Additional work'}: ${money(Number(it.qty ?? 1) * Number(it.price ?? 0))}`);
  if ((co.items || []).length > 6) lines.push(`- and ${(co.items || []).length - 6} more`);
  return [
    `HI Grade Plumbing: change order ${co.seq} for your job${site ? ` at ${site}` : ''}.`,
    ...lines,
    `Total: ${money(t.total)}${t.tax ? ' incl. tax' : ''}.`,
    co.note ? co.note : null,
    photoUrls(co).length ? `Photos are on the link below.` : null,
    `Reply YES to approve, or review and sign: ${APP_URL}/co/${co.view_token}`,
  ].filter(Boolean).join('\n');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function salutation(name) {
  if (!name) return '';
  if (/\b(LLC|Inc|Corp|Construction|Contracting|Services|Co\.|Company)\b/i.test(name)) return name;
  return String(name).trim().split(/\s+/)[0];
}

// The email: same frame as the invoice emails (api/send-email.js), one
// "Review & Approve" button to the /co/<token> page. Says plainly that
// nothing is due now.
export function changeOrderEmail(co, inv) {
  const t = coTotals(co.items, inv.tax);
  const link = `${APP_URL}/co/${co.view_token}`;
  const site = siteLine(inv.job_address);
  const rows = (co.items || []).map(it => `
      <tr>
        <td style="padding:8px 0;border-top:1px solid #eef1f7;color:#1a1a1a;font-size:14px;">
          <strong>${esc(it.name || 'Additional work')}</strong>${it.desc ? `<br><span style="color:#777;font-size:13px;">${esc(it.desc)}</span>` : ''}
          ${Number(it.qty ?? 1) !== 1 ? `<br><span style="color:#999;font-size:12px;">${esc(it.qty)} x ${money(it.price)}</span>` : ''}
        </td>
        <td style="padding:8px 0;border-top:1px solid #eef1f7;text-align:right;white-space:nowrap;font-size:14px;color:#1a1a1a;">${money(Number(it.qty ?? 1) * Number(it.price ?? 0))}</td>
      </tr>`).join('');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0a1628; padding: 24px; text-align: center;">
        <h1 style="color: #E8622A; margin: 0; font-size: 24px; letter-spacing: 2px;">HI GRADE PLUMBING LLC</h1>
        <p style="color: #8899bb; margin: 4px 0 0; font-size: 12px; letter-spacing: 1px;">HONOLULU, HAWAII · LIC PJ-13579</p>
      </div>
      <div style="padding: 28px 24px; background: #f4f6fa;">
        <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 16px;">Aloha ${esc(salutation(inv.client_name))},<br><br>
          While working on your job${site ? ` at ${esc(site)}` : ''} we found additional work that needs your approval before we do it. Here is change order ${co.seq}.</p>
        <div style="background:#fff;border-radius:10px;padding:18px 20px;box-shadow:0 1px 6px rgba(0,0,0,0.06);">
          <div style="color:#888;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">Change order ${co.seq} · ${esc(coLabel(co))}</div>
          <table style="width:100%;border-collapse:collapse;margin-top:10px;">${rows}
            <tr><td style="padding:8px 0 0;border-top:2px solid #eef1f7;color:#555;font-size:13px;">Subtotal</td><td style="padding:8px 0 0;border-top:2px solid #eef1f7;text-align:right;color:#555;font-size:13px;">${money(t.subtotal)}</td></tr>
            ${t.tax ? `<tr><td style="color:#777;font-size:13px;">Tax</td><td style="text-align:right;color:#777;font-size:13px;">${money(t.tax)}</td></tr>` : ''}
            <tr><td style="padding-top:4px;font-size:17px;font-weight:bold;color:#0a1628;">Total</td><td style="padding-top:4px;text-align:right;font-size:17px;font-weight:bold;color:#0a1628;">${money(t.total)}</td></tr>
          </table>
          ${co.note ? `<p style="color:#555;font-size:13px;margin:12px 0 0;white-space:pre-wrap;">${esc(co.note)}</p>` : ''}
          ${photoUrls(co).length ? `<div style="margin-top:14px;font-size:0;">${photoUrls(co).slice(0, 6).map(p => `<a href="${esc(link)}" target="_blank" style="display:inline-block;width:31%;margin:0 1% 2% 1%;"><img src="${esc(p.url)}" alt="Photo of the work" width="170" style="width:100%;height:auto;border-radius:6px;display:block;"></a>`).join('')}${photoUrls(co).length > 6 ? `<p style="color:#888;font-size:12px;margin:4px 0 0;">${photoUrls(co).length - 6} more on the approval page.</p>` : ''}</div>` : ''}
          <div style="text-align:center;margin:22px 0 6px;">
            <a href="${esc(link)}" target="_blank" style="display:inline-block;background:#E8622A;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 36px;border-radius:6px;">Review &amp; Approve</a>
            <p style="color:#999;font-size:12px;margin:10px 0 0;">Nothing is due now. Approving adds this work to your invoice.</p>
          </div>
        </div>
        <p style="color:#666;margin-top:20px;font-size:13px;">Questions? Call or text us at <strong>808-393-0015</strong><br>Email: higradeplumbing@gmail.com</p>
        <p style="color:#888;font-size:12px;margin:14px 0 0;text-align:center;">Trouble with the button? Copy/paste this URL:<br><span style="color:#3070b8;word-break:break-all;">${esc(link)}</span></p>
      </div>
      <div style="background: #0a1628; padding: 16px; text-align: center;">
        <p style="color: #8899bb; font-size: 11px; margin: 0;">HI Grade Plumbing LLC · Honolulu, HI · higradeplumbing.com</p>
      </div>
    </div>`;
  const subject = `Change order ${co.seq} for your job${site ? ` at ${site}` : ''}: please review`;
  return { subject, html };
}

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('Email not configured (RESEND_API_KEY)');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'HI Grade Plumbing <invoices@higradeplumbing.com>', to: [to], bcc: ['higradeplumbing@gmail.com'], subject, html }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Email failed ${r.status}: ${j.message || JSON.stringify(j).slice(0, 160)}`);
  return j;
}

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

// Admin op from the app. Emails and/or texts the link (to = phone, email =
// address; at least one) and marks the change order sent. Each channel is
// tried on its own: one failing does not stop the other, and the result says
// what went out.
export async function sendChangeOrder({ id, to, email }) {
  const co = (await rest(`change_orders?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];
  if (!co) return { ok: false, error: 'not_found' };
  if (co.status === 'approved' || co.status === 'declined') return { ok: false, error: `already ${co.status}` };
  if (!(co.items || []).length) return { ok: false, error: 'no lines' };
  if (!to && !email) return { ok: false, error: 'no phone or email to send to' };
  if (email && !validEmail(email)) return { ok: false, error: `not a valid email: ${email}` };
  const inv = await invoiceFor(co.invoice_id);
  if (!inv || inv.deleted_at) return { ok: false, error: 'invoice not found' };

  const sent = {}, errors = [];
  if (email) {
    try { await sendEmail({ to: String(email).trim(), ...changeOrderEmail(co, inv) }); sent.email = String(email).trim(); }
    catch (e) { errors.push(`email: ${e.message || e}`); }
  }
  if (to) {
    try {
      if (String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() !== 'true') throw new Error('outbound texting is switched off (sms_outbound_enabled)');
      const body = changeOrderText(co, inv);
      const r = await sendTwilioSms({ to, body });
      sent.text = to;
      try {
        await rpc('log_client_message', { p_secret: await webhookSecret(), p_phone: to, p_direction: 'outbound', p_body: body, p_call_id: r?.sid || null, p_media: null });
      } catch (e) { console.warn('[change-order] log failed:', e.message || e); }
    } catch (e) { errors.push(`text: ${e.message || e}`); }
  }
  if (!sent.email && !sent.text) return { ok: false, error: errors.join('; ') };
  const now = new Date().toISOString();
  await rest(`change_orders?id=eq.${co.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'sent', sent_at: now, updated_at: now,
      ...(sent.text ? { sent_to: sent.text } : {}), ...(sent.email ? { sent_email: sent.email } : {}) }) });
  return { ok: true, label: coLabel(co), link: `${APP_URL}/co/${co.view_token}`, sent, errors };
}

const YES = new Set(['yes', 'yep', 'yeah', 'ya', 'yup', 'y', 'ok', 'okay', 'k', 'approve', 'approved', 'sure', 'confirmed', 'confirm', 'agreed']);
const YES_PHRASES = [/^sounds good\b/, /^go ahead\b/, /^do it\b/, /^(i )?approve\b/, /^(that'?s|thats) fine\b/, /^looks good\b/];

// A short reply that is clearly a yes. Long or mixed messages fall through to
// Lisa, so "yes but can you also look at the sink" is never taken as consent.
export function isYesReply(body) {
  if (/\?/.test(String(body || ''))) return false; // "ok?" is a question
  const t = String(body || '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const words = t.split(' ');
  if (words.length > 5) return false;
  if (/\b(no|not|don'?t|dont|wait|but|cancel|question)\b/.test(t)) return false;
  return YES.has(words[0]) || YES_PHRASES.some(re => re.test(t));
}

// Called by sms-inbound.js before Lisa. Returns a short status string when it
// handled the text, or null to let Lisa answer as usual.
export async function handleChangeOrderReply({ phone, body }) {
  const p = last10(phone);
  if (p.length < 10 || !isYesReply(body)) return null;
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const open = await rest(`change_orders?status=eq.sent&sent_to=like.*${p}&sent_at=gte.${since}&select=id,invoice_id,seq,view_token&order=sent_at.desc`);
  if (!open?.length) return null;
  let reply, result;
  if (open.length > 1) {
    reply = `Thanks! You have ${open.length} change orders waiting. Please approve each one from its link so we add the right one.`;
    result = 'change order: several open, asked to use links';
  } else {
    const r = await approveChangeOrder({ id: open[0].id, via: 'sms', message: body });
    reply = r.ok
      ? `Thanks, change order ${open[0].seq} is approved. We've added it to your invoice.`
      : `Thanks! That change order can't be approved by text any more. Please call us at your convenience.`;
    result = `change order ${coLabel(open[0])}: ${r.ok ? (r.already ? 'already approved' : 'approved by text') : r.error}`;
  }
  try {
    if (String(await getSetting('sms_outbound_enabled') || 'false').toLowerCase() === 'true') {
      const sent = await sendTwilioSms({ to: phone, body: reply });
      await rpc('log_client_message', { p_secret: await webhookSecret(), p_phone: phone, p_direction: 'outbound', p_body: reply, p_call_id: sent?.sid || null, p_media: null });
    }
  } catch (e) { console.warn('[change-order] confirmation text failed:', e.message || e); }
  return result;
}

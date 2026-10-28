// AI ballpark estimate for web / SMS / Yelp leads, behind Jake's approval.
//
// Flow: api/sms-inbound.js files a lead (autoReply), then dispatches
// `{ task: 'lead_estimate', invoice_id }` to /api/ai-estimator, which runs
// proposeLeadEstimate() below. This writes the proposal to
// invoices.estimator_items and asks Jake on Telegram. NOTHING is sent to the
// customer and no line item is touched here: the HI Grade Manager bot
// (telegram-bot/bot.js) handles the reply, and only an APPROVE sends the text
// and replaces the line items. Migration 100 holds the two columns.
//
// Phone leads are excluded on purpose. They go straight to scheduling.
// `invoices.source` is 'ai_lead' for phone calls AND texts (two triggers key off
// it), so the gate is `lead_channel`, which is the column that tells them apart.
//
// Every failure path returns quietly and logs: a lead must never be blocked by
// the estimator.

import { getSetting, secretMatches, webhookSecret, supabaseUrl } from './sms.js';
import { fetchSavedItems, callEstimator, textOf, parseEstimate } from './estimator.js';

// lead_channel values that get a ballpark. 'phone' and 'lisa' never do.
const ELIGIBLE_CHANNELS = new Set(['web', 'sms', 'yelp']);
// A line that is only the generic placeholder Lisa files does not count as pricing.
const GENERIC_ITEM = /service call|diagnostic/i;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || '6234704324';
// Hobby caps a function at 10s. Past this the model call is abandoned and the
// lead is simply left without a ballpark.
const MODEL_BUDGET_MS = 8000;

function key() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
}
function headers(extra = {}) {
  return { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...extra };
}

export async function authorizedLeadTask(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return !!bearer && secretMatches(bearer, await webhookSecret());
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const round5 = (n) => Math.round(n / 5) * 5;

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN || await getSetting('telegram_bot_token');
  if (!token) { console.warn('[lead-estimate] no Telegram token; approval not requested'); return false; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.error('[lead-estimate] telegram refused:', JSON.stringify(j).slice(0, 200));
    return !!j.ok;
  } catch (e) {
    console.error('[lead-estimate] telegram failed:', e.message || e);
    return false;
  }
}

function addressLine(ja) {
  if (!ja) return '';
  if (typeof ja === 'string') return ja.trim();
  return [ja.address1, ja.address2, ja.city, ja.state, ja.zip].filter(Boolean).join(', ').trim();
}

/**
 * @returns {Promise<string>} a short reason or outcome, for the log line
 */
export async function proposeLeadEstimate({ invoiceId, problem }) {
  const skip = (why) => { console.log(`[lead-estimate] ${invoiceId || '?'} skipped: ${why}`); return `skipped: ${why}`; };
  if (!invoiceId) return skip('no invoice id');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !key()) return skip('server not configured');

  const base = `${supabaseUrl()}/rest/v1`;
  const id = encodeURIComponent(invoiceId);
  const rows = await fetch(
    `${base}/invoices?id=eq.${id}&select=id,type,lead_channel,client_name,client_info,job_address,internal_notes,deleted_at,estimator_items,estimator_approval,visits,gcal_date,invoice_items(name,price,qty)&limit=1`,
    { headers: headers() }).then(r => r.ok ? r.json() : []).catch(() => []);
  const inv = rows?.[0];
  if (!inv) return skip('invoice not found');

  if (inv.type !== 'estimate' || inv.deleted_at) return skip('not a live estimate');
  if (!ELIGIBLE_CHANNELS.has(String(inv.lead_channel || '').toLowerCase())) {
    return skip(`lead_channel ${inv.lead_channel || 'null'} is not web/sms/yelp`);
  }
  if (inv.estimator_items || inv.estimator_approval) return skip('already proposed');

  // Real pricing already on it (not just the placeholder service call): leave it.
  const items = Array.isArray(inv.invoice_items) ? inv.invoice_items : [];
  if (items.some(it => Number(it.price) > 0 && !GENERIC_ITEM.test(String(it.name || '')))) {
    return skip('already has priced line items');
  }

  const address = addressLine(inv.job_address);
  const job = String(problem || inv.internal_notes || '').trim();
  if (!address) return skip('no service address yet');
  if (job.length < 10) return skip('no job description');

  const phone = inv.client_info?.phone || null;
  const clientName = inv.client_name || inv.client_info?.name || 'Customer';

  // Estimator, no web search: this runs on a 10s budget and the price book
  // covers the flat-rate jobs a text lead usually describes.
  const savedItems = await fetchSavedItems();
  const savedBlock = savedItems.length
    ? `SAVED PRICES (use these as primary match before searching):\n${savedItems.map(i => `  ${i.category} | ${i.name} | $${i.price}`).join('\n')}`
    : 'SAVED PRICES: none provided.';
  const userText = `${savedBlock}\n\nJOB (from a customer text, no site visit yet):\n${job.slice(0, 1500)}\n\n` +
    `Service address, for the travel zone only, never in the line items: ${address}\n` +
    'Give a ballpark. Make smart assumptions rather than asking a question.';

  let data;
  try {
    data = await callEstimator({
      apiKey, webSearch: false, maxTokens: 1800,
      messages: [{ role: 'user', content: userText }],
      signal: AbortSignal.timeout(MODEL_BUDGET_MS),
    });
  } catch (e) {
    return skip(`estimator call failed (${e.status || e.name || 'error'})`);
  }
  const est = parseEstimate(textOf(data));
  if (!est || est.action !== 'estimate' || !Array.isArray(est.items)) return skip('estimator returned no estimate');

  const lines = est.items
    .map(it => ({
      name: String(it.name || '').trim(),
      desc: String(it.desc || '').trim(),
      qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
      price: Number(it.price),
    }))
    .filter(it => it.name && Number.isFinite(it.price) && it.price > 0);
  if (!lines.length) return skip('estimator items had no usable prices');

  const total = lines.reduce((s, it) => s + it.qty * it.price, 0);
  // The estimator gives point prices. The range is a rule of ours, not the
  // model's: total up to 15% above it, rounded to $5.
  const proposal = {
    items: lines, total,
    min: round5(total), max: round5(total * 1.15),
    assumptions: Array.isArray(est.assumptions) ? est.assumptions.slice(0, 8) : [],
    summary: String(est.summary || ''),
    generated_at: new Date().toISOString(),
  };

  // Claim the row before messaging anyone: only one concurrent run can win.
  const claim = await fetch(
    `${base}/invoices?id=eq.${id}&estimator_items=is.null&estimator_approval=is.null`,
    { method: 'PATCH', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify({ estimator_items: proposal }) });
  const claimed = claim.ok ? await claim.json().catch(() => []) : [];
  if (!claimed.length) return skip('lost the claim to another run');

  const jobSummary = job.replace(/\s+/g, ' ').slice(0, 220);
  const msg =
    `Ballpark estimate ready - ${clientName}${phone ? ` (${phone})` : ''}\n` +
    `Job: ${jobSummary}\n` +
    `Items: ${lines.map(it => `${it.name} - ${money(it.price * it.qty)}`).join(', ')}\n` +
    `Total: ${money(proposal.min)}-${money(proposal.max)} before tax\n\n` +
    `Send to customer?\nReply: APPROVE ${invoiceId} or DECLINE ${invoiceId}`;
  const sent = await sendTelegram(msg);
  if (!sent) {
    // Jake never saw it, so release the claim; a later run can ask again.
    await fetch(`${base}/invoices?id=eq.${id}&estimator_approval=is.null`,
      { method: 'PATCH', headers: headers(), body: JSON.stringify({ estimator_items: null }) }).catch(() => {});
    return skip('telegram not delivered; proposal discarded');
  }
  console.log(`[lead-estimate] ${invoiceId} proposed ${money(proposal.min)}-${money(proposal.max)}, awaiting Jake`);
  return `proposed ${invoiceId}`;
}

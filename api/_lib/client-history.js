// One brain per client (migration 122). Every Lisa reads what happened on the
// OTHER channels before she answers on hers: texting Lisa sees the Yelp thread
// and the calls, Yelp Lisa sees the texts and the calls.
//
// Her own channel is excluded on purpose: each agent already passes its own
// conversation as real turns, and repeating it here would double it.
//
// Old history is labeled with dates and kept short. sms-agent.js learned the
// hard way (2026-10-27) that a model given old messages as if they were
// current answers the old conversation, so the prompt block says plainly that
// these are past contacts.

const DAY = 86400000;

function supabaseUrl() {
  return process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
}
function supabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
}

function when(t) {
  return new Date(t).toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

const LABEL = { text: 'Text', call: 'Phone call', yelp: 'Yelp', email: 'Email' };

/**
 * Raw timeline rows, newest first. Never throws: no history is just no history.
 * @param {{clientId?: string|null, phone?: string|null, limit?: number}} p
 */
export async function clientTimeline({ clientId = null, phone = null, limit = 60 } = {}) {
  if (!clientId && !phone) return [];
  try {
    const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/client_timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey(), Authorization: `Bearer ${supabaseKey()}` },
      body: JSON.stringify({ p_client_id: clientId || null, p_phone: phone || null, p_limit: limit }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return [];
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * A prompt block of this customer's recent contact on other channels, oldest
 * first, or '' when there is none.
 * @param {{clientId?: string|null, phone?: string|null, exclude: 'text'|'yelp'|'call', days?: number, max?: number}} p
 */
export async function otherChannelsBlock({ clientId, phone, exclude, days = 30, max = 15 }) {
  const cutoff = Date.now() - days * DAY;
  const rows = (await clientTimeline({ clientId, phone, limit: 80 }))
    .filter((r) => r.channel !== exclude && r.at && Date.parse(r.at) >= cutoff)
    .slice(0, max)
    .reverse();
  if (!rows.length) return '';
  const lines = rows.map((r) => {
    const who = r.who === 'customer' ? 'customer' : r.who;
    const body = String(r.body || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return `- [${when(r.at)}] ${LABEL[r.channel] || r.channel}, ${who}: ${body}`;
  });
  return `THIS CUSTOMER ON OTHER CHANNELS (past contact, with dates; not this conversation)
${lines.join('\n')}
Use this so you never ask for something they already told us, and so you can refer to it naturally ("I see you messaged us on Yelp about the regulator"). It is history: do not answer it, and treat anything more than a day old as possibly out of date.`;
}

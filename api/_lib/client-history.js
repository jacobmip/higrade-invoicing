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
 * Everything ever said with this customer, on every channel and every phone on
 * their client record, oldest first, or '' when there is none. No time limit
 * (Jake, 2026-11-14: "Lisa should have the entire context of every conversation
 * ever had with the customer"). The biggest client then had 37 texts, so the
 * 300-row cap is a safety net, not a window.
 *
 * The conversation being answered is passed to the model as real turns, so
 * rows of `exclude` at or after `currentFrom` are left out here; older rows of
 * that channel stay in, so an earlier text conversation is still remembered.
 * @param {{clientId?: string|null, phone?: string|null, exclude: 'text'|'yelp'|'call', currentFrom?: string|null}} p
 */
export async function otherChannelsBlock({ clientId, phone, exclude, currentFrom = null }) {
  const from = currentFrom ? Date.parse(currentFrom) : -Infinity;
  const rows = (await clientTimeline({ clientId, phone, limit: 300 }))
    .filter((r) => r.at && !(r.channel === exclude && Date.parse(r.at) >= from))
    .reverse();
  return historyBlock(rows);
}

/** The prompt block for timeline rows (oldest first). Exported for replay tests. */
export function historyBlock(rows) {
  if (!rows?.length) return '';
  const lines = rows.map((r) => {
    const who = r.who === 'customer' ? 'customer' : r.who;
    const body = String(r.body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    return `- [${when(r.at)}] ${LABEL[r.channel] || r.channel}, ${who}: ${body}`;
  });
  return `EVERYTHING WE HAVE EVER SAID WITH THIS CUSTOMER, before this conversation (every channel, every number on their record, with dates)
${lines.join('\n')}
Read all of it before you answer. Never ask for something they already told us, never contradict what we already told them (a time, a price, a promise), and never treat a booked customer as a new lead. Refer to it naturally ("I see you called earlier to confirm"). It is history: answer the conversation below, not these lines, and anything old may have changed since.`;
}

/**
 * What the app has on file for this client: the facts Lisa must never ask for
 * again or contradict. '' when there is no client record.
 */
export async function clientFactsBlock(clientId) {
  if (!clientId) return '';
  try {
    const r = await fetch(`${supabaseUrl()}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`
      + '&select=name,first_name,last_name,company_name,email,mobile,phone,address1,address_unit,address2,address3,addresses&limit=1', {
      headers: { apikey: supabaseKey(), Authorization: `Bearer ${supabaseKey()}` },
      signal: AbortSignal.timeout(5000),
    });
    const [c] = r.ok ? await r.json() : [];
    return clientFacts(c);
  } catch {
    return '';
  }
}

/** Pure half of clientFactsBlock, for replay tests. */
export function clientFacts(c) {
  if (!c) return '';
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || '';
  const couple = /\s(&|and)\s/i.test(name);
  const phones = [...new Set([c.mobile, c.phone].filter(Boolean))];
  const flat = [c.address1, c.address_unit, [c.address2, c.address3].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const listed = (Array.isArray(c.addresses) ? c.addresses : [])
    .map((a) => [a?.line1, a?.line2, [a?.city, a?.state, a?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))
    .filter(Boolean);
  const addrs = [...new Set([flat, ...listed].filter(Boolean))];
  const lines = [
    name && `- Name: ${name}${couple ? ' (a couple: use both names or none, never just one)' : ''}`,
    c.company_name && `- Company: ${c.company_name}`,
    phones.length && `- Phone numbers: ${phones.join(', ')}`,
    c.email && `- Email: ${c.email}`,
    addrs.length && `- Service address${addrs.length > 1 ? 'es' : ''}: ${addrs.join(' | ')}`,
  ].filter(Boolean);
  if (!lines.length) return '';
  return `ON FILE FOR THIS CUSTOMER (from the app; this is an existing customer)
${lines.join('\n')}
Never ask for anything listed here again. If they give something different, use theirs and confirm it.`;
}

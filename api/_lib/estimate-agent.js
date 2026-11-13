// The estimate agent: one price brain for every Lisa (Jake, 2026-11-12: "I want
// Lisa to be smarter and actually give an accurate estimate").
//
// It prices the way the website's AI estimator does (Honolulu market rates,
// the same reference ranges), then checks two things the website never could:
// what Jake actually charged on similar past jobs, and what the parts cost him
// at Ferguson. Online prices come from web search. Where a past charge is below
// market it says so to Jake ("sometimes I did not charge enough"), and it never
// lets a low past charge pull the quote down. The price book is not used.
//
// Travel is drive time from Ward/Kakaako, in traffic, at the visit time when we
// know it: under 30 min no charge, 30+ min +$150, 60+ min +$300, rolled into
// the price (Jake, 2026-11-12: "off town should be 30 min +").
//
// estimateJob() never sends anything. Callers decide what to do with it: Lisa
// quotes it when it is auto-sendable (high <= AUTO_SEND_MAX and not low
// confidence), anything else goes to Jake on Telegram.

const supabaseUrl = () => process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const sbHeaders = () => {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return { apikey: k, Authorization: `Bearer ${k}` };
};

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ESTIMATE_MODEL || 'claude-opus-5-5';
const HOME = 'Ward Ave & Kapiolani Blvd, Honolulu, HI 96814';

/** Lisa sends an estimate on her own only up to this (Jake, 2026-11-12). */
export const AUTO_SEND_MAX = 1000;

// Travel surcharge by one-way drive minutes in traffic.
export function travelFor(minutes) {
  if (!Number.isFinite(minutes)) return { zone: 'unknown', surcharge: null };
  if (minutes >= 60) return { zone: 'far side', surcharge: 300 };
  if (minutes >= 30) return { zone: 'off-town', surcharge: 150 };
  return { zone: 'in-town', surcharge: 0 };
}

/** One-way drive time from the shop, in traffic, leaving at `when` (Date) or now. */
export async function driveMinutes(address, when = null) {
  const key = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !address) return null;
  const t = when instanceof Date && when.getTime() > Date.now() ? Math.floor(when.getTime() / 1000) : 'now';
  const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
    + `?origins=${encodeURIComponent(HOME)}&destinations=${encodeURIComponent(address)}`
    + `&departure_time=${t}&traffic_model=best_guess&key=${key}`;
  try {
    const r = await fetch(url, { headers: { Referer: 'https://higrade-invoicing.vercel.app' } });
    const el = (await r.json())?.rows?.[0]?.elements?.[0];
    const s = el?.duration_in_traffic?.value || el?.duration?.value;
    return el?.status === 'OK' && s ? Math.round(s / 60) : null;
  } catch { return null; }
}

const words = (list) => (Array.isArray(list) ? list : [list])
  .map((w) => String(w || '').replace(/[^A-Za-z0-9 -]/g, '').trim()).filter((w) => w.length > 2).slice(0, 4);

async function sbGet(path) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}

// What Jake charged on similar work: invoices that were billed, and estimates
// the customer accepted. Trashed documents never count.
async function pastJobs({ keywords }) {
  const ks = words(keywords);
  if (!ks.length) return { error: 'give 1 to 4 keywords' };
  const or = ks.map((k) => `name.ilike.*${k}*`).join(',');
  const rows = await sbGet('invoice_items?select=name,price,qty,invoices!inner(id,type,status,date,job_address)'
    + `&or=(${encodeURIComponent(or)})&invoices.deleted_at=is.null`
    + '&invoices.status=in.(paid,outstanding,partial,net30,approved,converted)&order=invoice_id.desc&limit=25');
  return (rows || []).map((x) => ({
    item: x.name, price: Number(x.price), qty: Number(x.qty) || 1, doc: x.invoices?.id,
    date: x.invoices?.date, area: x.invoices?.job_address?.city || '', kind: x.invoices?.type,
  }));
}

// Jake's real cost on a part at Ferguson, newest first, one row per item.
async function partsCost({ keywords }) {
  const ks = words(keywords);
  if (!ks.length) return { error: 'give 1 to 4 keywords' };
  const and = ks.map((k) => `item_description.ilike.*${k}*`).join(',');
  const rows = await sbGet('ferguson_order_history?select=item_description,unit_price,order_date'
    + `&and=(${encodeURIComponent(and)})&order=order_date.desc&limit=40`);
  const seen = new Set();
  return (rows || []).filter((x) => !seen.has(x.item_description) && seen.add(x.item_description)).slice(0, 10)
    .map((x) => ({ part: x.item_description, unit_cost: Number(x.unit_price), bought: x.order_date }));
}

const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 2,
    user_location: { type: 'approximate', city: 'Honolulu', region: 'Hawaii', country: 'US', timezone: 'Pacific/Honolulu' } },
  { name: 'past_jobs', description: "Line items Jake billed (or had accepted) on past jobs whose name matches any keyword. Use 1 to 4 short keywords like 'toilet', 'water heater', 'disposal'.",
    input_schema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' } } }, required: ['keywords'], additionalProperties: false } },
  { name: 'parts_cost', description: "Jake's actual unit cost for parts bought at Ferguson whose description contains ALL keywords, newest first. Use for the main part of the job (e.g. ['water heater','50']).",
    input_schema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' } } }, required: ['keywords'], additionalProperties: false } },
];
const RUN = { past_jobs: pastJobs, parts_cost: partsCost };

// The website's estimator prompt (higrade-site/higrade-homepage-template.php),
// which Jake prefers because it prices higher. Keep the ranges in step with it.
const SYSTEM = `You are the estimator for HI Grade Plumbing LLC in Honolulu, Hawaii. You price a job from what the customer wrote, so Lisa (our front desk) can give them a rough estimate. You never talk to the customer.

HOW WE PRICE
Always use Honolulu market pricing, which runs 40 to 60% above mainland US. Journeyman labor is $185 to $225 an hour (internal only, never quoted as a rate). Reference ranges:
Toilet repair $220-$380. Toilet replace $550-$950. Faucet repair $195-$350. Water heater gas 40-50 gal $1,800-$2,800. Water heater electric $1,400-$2,200. Tankless $3,200-$5,500. Solar full system $7,500-$14,000. Drain clean snake $250-$450. Drain hydro-jet $550-$950. Sewer spot repair $1,800-$4,500. Sewer replacement $8,000-$18,000. Gas line $800-$2,500. Bathroom remodel plumbing $4,500-$12,000.

WHAT YOU CHECK (tools, use them together in one turn when you can)
- past_jobs: what we charged on similar work. If our past charge is below the market range, do NOT price down to it; price to market and say so in notes_for_jake (e.g. "INV1172 billed $325 for this; market is $450 to $600").
- parts_cost: our real cost on the main part. Parts are marked up 1.35x minimum inside the price.
- web_search: at most two searches, only when the job is not covered by the ranges above or depends on a specific part or model. Prefer Honolulu or Hawaii sources.

ADJUST FOR
- Travel: given to you as drive minutes in traffic. Add the surcharge you are given to both ends of the range, silently (never a line of its own).
- Commercial (a business, restaurant, store, office, commercial building): price at the top of the range or above, for commercial-grade fixtures, access and after-hours limits. Say so in assumptions.
- High-rise (condo tower): access, parking and shutoff coordination add time; lean high.
- Special-order parts (not stocked locally, a specific brand or model, long lead time): add a second trip at $185 and say the lead time in assumptions.
- Several separate tasks: one item each, and the total is the sum.

OUTPUT
Reply with ONLY this JSON, no markdown:
{"low":NUMBER,"high":NUMBER,"confidence":"High|Moderate|Low","summary":"one plain line naming the job, for Lisa to say","items":[{"name":"short title","low":NUMBER,"high":NUMBER}],"assumptions":["..."],"notes_for_jake":["underpricing found, things to confirm"],"needs_visit":BOOLEAN}
Round to clean numbers ($385, $425, $1,950). Keep low to high within about 40% unless the job is truly open-ended. Confidence Low (and needs_visit true) when it cannot be priced without seeing it: slab leaks, hidden leaks, unknown clogs in the main line, anything you would be guessing at.`;

/**
 * @param {object} p
 * @param {string} p.job          what the customer wrote about the job
 * @param {string} [p.address]    service address, for drive time
 * @param {Date}   [p.when]       visit time, so traffic is for that hour
 * @param {string[]} [p.photos]   https image links
 * @param {number} [p.deadlineMs] give up after this long (default 25s)
 */
export async function estimateJob({ job, address = '', when = null, photos = [], deadlineMs = 25000 }) {
  const started = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  if (!String(job || '').trim()) return { ok: false, error: 'no job description' };

  const minutes = address ? await driveMinutes(address, when) : null;
  const travel = { minutes, ...travelFor(minutes) };
  const travelLine = travel.surcharge === null
    ? `Travel: drive time unknown${address ? ` (address: ${address})` : ' (no address yet)'}. Guess the zone from any town they mention: Honolulu proper 0, 30+ min away (Hawaii Kai, Kailua, Kaneohe, Pearl City, Mililani, Ewa, Kapolei) +150, North Shore, Waianae coast or Laie/Kahuku +300. No town mentioned: assume 0 and say so.`
    : `Travel: ${minutes} min one way in traffic, ${travel.zone}, add $${travel.surcharge}.`;

  const content = [];
  for (const u of (photos || []).filter((x) => /^https:\/\//.test(x)).slice(0, 3)) content.push({ type: 'image', source: { type: 'url', url: u } });
  content.push({ type: 'text', text: `The customer wrote:\n"""\n${String(job).slice(0, 3000)}\n"""\n${travelLine}` });
  const messages = [{ role: 'user', content }];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(3000, deadlineMs - (Date.now() - started)));
  const looked = [];
  try {
    for (let turn = 0; turn < 6; turn++) {
      const r = await fetch(ANTHROPIC, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYSTEM, tools: TOOLS, messages, output_config: { effort: 'low' }, fallbacks: 'default' }),
      });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: `anthropic ${r.status}: ${j?.error?.message || ''}`.slice(0, 200) };
      if (j.stop_reason === 'refusal') return { ok: false, error: 'refused' };
      messages.push({ role: 'assistant', content: j.content });
      for (const b of j.content) if (b.type === 'server_tool_use') looked.push(`web: ${b.input?.query || ''}`);
      if (j.stop_reason === 'pause_turn') continue; // web search paused: resend as is
      if (j.stop_reason === 'tool_use') {
        const uses = j.content.filter((b) => b.type === 'tool_use');
        const results = await Promise.all(uses.map(async (u) => {
          looked.push(`${u.name}: ${(u.input?.keywords || []).join(', ')}`);
          try {
            const out = RUN[u.name] ? await RUN[u.name](u.input || {}) : { error: 'unknown tool' };
            return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 6000) };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: u.id, content: String(e.message || e), is_error: true };
          }
        }));
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = j.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const est = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const low = Math.round(Number(est.low)); const high = Math.round(Number(est.high));
      if (!(low > 0 && high >= low)) return { ok: false, error: 'no usable numbers', raw: text.slice(0, 300) };
      const confidence = ['High', 'Moderate', 'Low'].includes(est.confidence) ? est.confidence : 'Low';
      return {
        ok: true, low, high, confidence,
        summary: String(est.summary || ''), items: Array.isArray(est.items) ? est.items : [],
        assumptions: Array.isArray(est.assumptions) ? est.assumptions : [],
        notes_for_jake: Array.isArray(est.notes_for_jake) ? est.notes_for_jake : [],
        needs_visit: !!est.needs_visit || confidence === 'Low',
        auto_send: high <= AUTO_SEND_MAX && confidence !== 'Low' && !est.needs_visit,
        travel, looked, ms: Date.now() - started,
      };
    }
    return { ok: false, error: 'too many turns', looked };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timed out' : String(e.message || e).slice(0, 200), looked, ms: Date.now() - started };
  } finally { clearTimeout(timer); }
}

/** The ESTIMATE block for Lisa's prompt (every channel). */
export function estimatePrompt(est) {
  if (!est) return '';
  if (!est.ok) return '\nESTIMATE: our estimator could not price this one. Give no job price; use the service call rule and get them on the schedule.';
  if (!est.auto_send) {
    return `\nESTIMATE: this one needs the owner to look at it first (${est.needs_visit ? 'it has to be seen' : 'it is a larger job'}). Give NO price and no number of any kind except the service call fee. Say we will get them a real number, ask the one useful question or for a photo, and offer a time.`;
  }
  return `\nESTIMATE (from our estimator, already includes travel and parts): ${est.summary || 'this job'}, $${est.low.toLocaleString('en-US')} to $${est.high.toLocaleString('en-US')}.`
    + `\nQuote exactly that range, once, in your own words. Never any other dollar amount except the service call fee. Never mention travel, markup or how it was worked out.`;
}

/** The lines Jake gets on Telegram for one estimator run. */
export function estimateNote(est, { quoted }) {
  if (!est?.ok) return `Estimator could not price it (${est?.error || 'unknown'}). Lisa gave no price.`;
  const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
  const lines = [
    `Estimator: ${money(est.low)} to ${money(est.high)} (${est.confidence}) for ${est.summary || 'the job'}`,
    quoted ? 'Lisa quoted it.' : `Lisa gave NO price (${est.auto_send ? 'she left it out' : est.needs_visit ? 'needs to be seen' : `over ${money(AUTO_SEND_MAX)}`}). Send it yourself if you agree.`,
  ];
  if (est.items?.length > 1) lines.push(...est.items.map((i) => `- ${i.name}: ${money(i.low)} to ${money(i.high)}`));
  if (est.travel?.minutes != null) lines.push(`Travel: ${est.travel.minutes} min, ${est.travel.zone}`);
  if (est.notes_for_jake?.length) lines.push('Notes:', ...est.notes_for_jake.slice(0, 4).map((n) => `- ${String(n).slice(0, 300)}`));
  return lines.join('\n');
}

/** Customer asked about price in this message. */
export const PRICE_ASK = /\b(how much|price|pricing|cost|costs|charge|quote|estimate|ballpark|rough idea|rates?)\b|\$/i;

// A name we already know for a phone number, from channels that do not make a
// client record. Valente, 2026-11-16: gave his name, phone and email on Yelp,
// took our follow-up call, then called back and was filed as "Missed call -
// no name given" because a Yelp lead only becomes a client when it books.
// Every placeholder fallback ("Missed call", "Text lead") asks here first.

const PLACEHOLDER = /no name given|missed call|unknown caller|^unknown$/i;

/** True for the labels the system files when it has no name. */
export function isPlaceholderName(name) {
  const n = String(name || '').trim();
  return !n || PLACEHOLDER.test(n);
}

function supabaseUrl() {
  return process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
}
function sbHeaders() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return { apikey: k, Authorization: `Bearer ${k}` };
}
async function select(path) {
  try {
    const r = await fetch(`${supabaseUrl()}/rest/v1/${path}`, { headers: sbHeaders() });
    if (!r.ok) return [];
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

function clean(name) {
  const n = String(name || '').trim().replace(/[.,]+$/, '').replace(/\s+/g, ' ');
  if (isPlaceholderName(n) || n.length > 80 || !/[A-Za-z]/.test(n)) return null;
  return n.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * The best name on record for this number: a Yelp thread's first name, else
 * a name the office put on a queued call. Null when nothing is known.
 * Never throws.
 */
export async function knownNameForPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return null;
  const yelp = await select(`yelp_threads?phone=like.*${d}&select=first_name&order=updated_at.desc&limit=3`);
  for (const y of yelp) { const n = clean(y.first_name); if (n) return n; }
  const queued = await select(`call_queue?phone=like.*${d}&select=client_name&order=created_at.desc&limit=5`);
  for (const q of queued) { const n = clean(q.client_name); if (n) return n; }
  return null;
}

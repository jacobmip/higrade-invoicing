// /api/_lib/call-recording.js — Lisa's call recordings.
//
// A helper, not a route: the project sits on Vercel Hobby's 12-function cap
// (see CLAUDE.md), so this is reached through /api/vapi-call-ended.
//
//   recordCall()               the end-of-call webhook links a Vapi call id to
//                              its estimate in public.vapi_calls (migration 067)
//   handleRecordingRequest()   GET /api/vapi-call-ended?recording=<callId>
//                              with the app's Supabase session. Admins only.
//                              Returns { url } — a short-lived download link
//                              from Vapi that the app hands to an <audio> tag.
//
// Vapi keeps recordings in a private bucket. The documented way in is
// GET https://api.vapi.ai/call/{id}/mono-recording with the private key, which
// answers 302 to a short-lived signed URL. We read that redirect instead of
// following it, because the signed URL is its own credential: following it
// with the Bearer header still attached can be rejected for carrying two auth
// mechanisms, and the browser needs the URL anyway to play it. No audio passes
// through this function, which keeps it well inside the 10s Hobby limit.

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const VAPI_API = 'https://api.vapi.ai';

function supaUrl() {
  return process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
}

// Service role only. This table is written past RLS on purpose, and an anon
// fallback would just fail every insert quietly.
function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return key;
}

function serviceHeaders(extra) {
  const key = serviceKey();
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// ─── Linking a call to its estimate ─────────────────────────────────────────

// Upsert, so a Vapi retry of the same report is harmless, and a later report
// that does know the estimate fills it in. Never throws: a failure here must
// not affect the rest of the end-of-call handling.
export async function recordCall({ callId, invoiceId, phone, seconds }) {
  if (!callId) return false;
  try {
    const row = { call_id: String(callId) };
    if (invoiceId) row.invoice_id = String(invoiceId);
    if (phone) row.phone = String(phone);
    if (Number.isFinite(seconds)) row.seconds = Math.round(seconds);
    const res = await fetch(`${supaUrl()}/rest/v1/vapi_calls?on_conflict=call_id`, {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.error('[call-recording] record failed', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[call-recording] record failed:', e.message || e);
    return false;
  }
}

// ─── Who is asking ──────────────────────────────────────────────────────────

export async function requireAdmin(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const ures = await fetch(`${supaUrl()}/auth/v1/user`, {
    headers: { apikey: anon || serviceKey(), Authorization: `Bearer ${token}` },
  });
  if (!ures.ok) return null;
  const user = await ures.json().catch(() => null);
  if (!user?.id) return null;

  // profiles.role, not tier: role is what is_admin() and every policy use.
  const pres = await fetch(
    `${supaUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!pres.ok) return null;
  const rows = await pres.json().catch(() => []);
  return rows?.[0]?.role === 'admin' ? user : null;
}

async function vapiKey() {
  if (process.env.VAPI_PRIVATE_KEY) return process.env.VAPI_PRIVATE_KEY;
  const res = await fetch(
    `${supaUrl()}/rest/v1/settings?key=eq.vapi_private_key&select=value&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows?.[0]?.value || null;
}

// ─── The recording link ─────────────────────────────────────────────────────

export async function handleRecordingRequest(req, res, callId) {
  // Vapi call ids are uuids. Anything else never reaches Vapi.
  if (!/^[0-9a-f-]{36}$/i.test(String(callId || ''))) {
    return json(res, 400, { error: 'bad_call_id' });
  }

  let user;
  try { user = await requireAdmin(req); }
  catch (e) { return json(res, 500, { error: 'auth_check_failed', detail: String(e.message || e) }); }
  if (!user) return json(res, 401, { error: 'unauthorized' });

  const key = await vapiKey().catch(() => null);
  if (!key) return json(res, 500, { error: 'vapi_key_missing', detail: 'No VAPI_PRIVATE_KEY env var and no settings.vapi_private_key' });

  let vres;
  try {
    vres = await fetch(`${VAPI_API}/call/${encodeURIComponent(callId)}/mono-recording`, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'manual',
    });
  } catch (e) {
    return json(res, 502, { error: 'vapi_unreachable', detail: String(e.message || e) });
  }

  const location = vres.headers.get('location');
  if (vres.status >= 300 && vres.status < 400 && location) {
    return json(res, 200, { url: location });
  }
  if (vres.status === 404) {
    // Either the call has no recording (recording turned off on the assistant
    // at the time) or Vapi no longer keeps it.
    return json(res, 404, { error: 'no_recording' });
  }
  const detail = await vres.text().catch(() => '');
  console.error('[call-recording] unexpected Vapi response', vres.status, detail.slice(0, 300));
  return json(res, 502, { error: 'vapi_error', status: vres.status, detail: detail.slice(0, 300) });
}

// /api/approve-call — approve or cancel one queued outbound call.
//
// Edge runtime on purpose: the project sits at the Hobby plan's 12 Node
// function cap (see CLAUDE.md), and edge routes do not count. Plain fetch
// against PostgREST with the service role, no node builtins.
//
// The credential is the token itself: 12 random bytes (96 bits) minted when
// api/sms-inbound.js files the call_queue row (migration 107). Anyone holding
// the link can answer that one call and nothing else; there is no session.
//
// GET  ?token=...                      -> { ok, state, call }
// POST { token, approval: 'approved' | 'denied' }
//                                      -> { ok:true, callId, approval, already?, dialing?, vapiCallId? }
//
// Two POST paths:
//   Admin session (Authorization: Bearer <supabase-token>): bypasses the
//   approval_asked_at gate and fires the Vapi call immediately. This is the
//   app-chat approval path — Jake says yes in chat and Lisa dials at once.
//
//   Anonymous (token only): original link path. Requires the runner to have
//   stamped approval_asked_at first (i.e. it is actively waiting to dial).
//
// state: 'ready' | 'approved' | 'denied' | 'not_ready' | 'closed'.
// Errors: 400 bad request, 404 invalid_token, 409 not_ready / closed.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
// Outbound Lisa assistant — same IDs as AI-OS/scripts/outbound_call.py
const VAPI_ASSISTANT_ID = process.env.VAPI_OUTBOUND_ASSISTANT_ID || 'ebd3867d-6226-403d-8a0b-60ba41357159';
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_OUTBOUND_PHONE_NUMBER_ID || '8bba3841-c1bc-4cf9-847f-2e07377fbd73';
const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;
const COLS = 'id,phone,client_name,purpose,context,invoice_id,status,approval,approval_asked_at';

const out = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const rest = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/call_queue${path}`, {
  ...init,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

async function findByToken(token) {
  const res = await rest(`?approval_token=eq.${encodeURIComponent(token)}&select=${COLS}&limit=1`);
  if (!res.ok) throw new Error(`lookup failed (${res.status})`);
  const rows = await res.json().catch(() => []);
  return rows?.[0] || null;
}

function stateOf(row) {
  if (row.approval === 'approved' || row.approval === 'denied') return row.approval;
  if (row.status !== 'queued') return 'closed';
  if (!row.approval_asked_at) return 'not_ready';
  return 'ready';
}

const publicCall = (row) => ({
  id: row.id, name: row.client_name, phone: row.phone, purpose: row.purpose, context: row.context,
});

// Returns true when the bearer token belongs to an admin Supabase session.
async function checkAdminSession(token) {
  if (!token) return false;
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE, Authorization: `Bearer ${token}` },
    });
    if (!ur.ok) return false;
    const user = await ur.json().catch(() => null);
    if (!user?.id) return false;
    const pr = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    if (!pr.ok) return false;
    const rows = await pr.json().catch(() => []);
    return rows?.[0]?.role === 'admin';
  } catch { return false; }
}

// Fetch the Vapi private key: env var first, then settings table.
async function vapiPrivateKey() {
  if (process.env.VAPI_PRIVATE_KEY) return process.env.VAPI_PRIVATE_KEY;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/settings?key=eq.vapi_private_key&select=value&limit=1`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows?.[0]?.value || null;
}

// Claim the row, fire the Vapi call immediately, save the vapi_call_id back.
// Returns the Vapi call id string, or null on Vapi failure.
async function dialNow(row) {
  // Claim atomically before touching Vapi — same pattern as outbound_call.py.
  const now = new Date().toISOString();
  await rest(`?id=eq.${row.id}&status=eq.queued`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'calling', attempts: 1, approval: 'approved', approval_asked_at: now }),
  });

  const key = await vapiPrivateKey();
  if (!key) return null;

  let vapiCallId = null;
  try {
    const vr = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        assistantId: VAPI_ASSISTANT_ID,
        customer: {
          number: row.phone,
          ...(row.client_name ? { name: row.client_name } : {}),
        },
        assistantOverrides: {
          variableValues: {
            purpose: row.purpose || '',
            context: row.context || '',
            client_name: row.client_name || 'them',
            invoice_id: row.invoice_id || '',
          },
        },
      }),
    });
    const vd = await vr.json().catch(() => ({}));
    vapiCallId = vd.id || null;
  } catch (e) {
    console.error('[approve-call] vapi dial failed:', String(e));
  }

  if (vapiCallId) {
    await rest(`?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ vapi_call_id: vapiCallId }),
    });
  }
  return vapiCallId;
}

export default async function handler(req) {
  if (!SERVICE) return out(500, { ok: false, error: 'server_not_configured' });

  let token = '';
  let approval = '';
  let sessionToken = null;

  if (req.method === 'GET') {
    token = new URL(req.url).searchParams.get('token') || '';
  } else if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    token = String(body.token || '');
    approval = String(body.approval || '');
    if (approval !== 'approved' && approval !== 'denied') {
      return out(400, { ok: false, error: 'approval must be "approved" or "denied"' });
    }
    // Admin app-chat path: Authorization header carries the Supabase session token.
    const authHeader = req.headers.get('authorization') || '';
    if (authHeader.startsWith('Bearer ')) sessionToken = authHeader.slice(7).trim();
  } else {
    return out(405, { ok: false, error: 'method_not_allowed' });
  }
  if (!TOKEN_RE.test(token)) return out(404, { ok: false, error: 'invalid_token' });

  let row;
  try { row = await findByToken(token); }
  catch (e) { return out(502, { ok: false, error: 'lookup_failed', detail: String(e.message || e) }); }
  if (!row) return out(404, { ok: false, error: 'invalid_token' });

  let state = stateOf(row);

  if (req.method === 'GET') return out(200, { ok: true, state, call: publicCall(row) });

  // Already answered.
  if (state === 'approved' || state === 'denied') {
    return out(200, { ok: true, callId: row.id, approval: state, already: true });
  }

  // ── Admin app-chat path: bypass approval_asked_at, dial immediately ────────
  if (sessionToken && approval === 'approved') {
    const isAdmin = await checkAdminSession(sessionToken);
    if (!isAdmin) return out(403, { ok: false, error: 'admin_only' });
    if (row.status !== 'queued') return out(409, { ok: false, error: 'call_not_queued', callId: row.id });
    const vapiCallId = await dialNow(row);
    return out(200, { ok: true, callId: row.id, approval: 'approved', dialing: true, vapiCallId });
  }

  // ── Link path: requires approval_asked_at (runner is actively waiting) ─────
  if (state !== 'ready') {
    return out(409, { ok: false, error: state, callId: row.id });
  }

  // Conditional write — filters repeat the readiness test so two concurrent
  // taps cannot both win.
  const upd = await rest(
    `?approval_token=eq.${encodeURIComponent(token)}&status=eq.queued&approval=is.null&approval_asked_at=not.is.null`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ approval }) },
  );
  if (!upd.ok) return out(502, { ok: false, error: 'write_failed', status: upd.status });
  const written = await upd.json().catch(() => []);
  if (written?.length) return out(200, { ok: true, callId: row.id, approval });

  // Lost a race, or the runner moved the row between read and write.
  const again = await findByToken(token).catch(() => null);
  state = again ? stateOf(again) : 'closed';
  if (state === 'approved' || state === 'denied') {
    return out(200, { ok: true, callId: row.id, approval: state, already: true });
  }
  return out(409, { ok: false, error: state, callId: row.id });
}

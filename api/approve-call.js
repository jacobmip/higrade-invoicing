// /api/approve-call — approve or cancel one queued outbound call from a link.
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
//                                      -> { ok:true, callId, approval, already? }
//
// Writes the same call_queue.approval column the Telegram APPROVE/CANCEL reply
// writes (migration 093), so the outbound runner honours it unchanged. Only a
// row that is still `queued` AND whose approval gate has actually been asked
// (approval_asked_at set) can be answered, and only once: a repeat of the same
// answer, or a conflicting one, returns the stored decision instead of an error.
//
// state: 'ready' | 'approved' | 'denied' | 'not_ready' | 'closed'.
// Errors: 400 bad request, 404 invalid_token, 409 not_ready / closed.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;
const COLS = 'id,phone,client_name,purpose,context,status,approval,approval_asked_at';

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

export default async function handler(req) {
  if (!SERVICE) return out(500, { ok: false, error: 'server_not_configured' });

  let token = '';
  let approval = '';
  if (req.method === 'GET') {
    token = new URL(req.url).searchParams.get('token') || '';
  } else if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    token = String(body.token || '');
    approval = String(body.approval || '');
    if (approval !== 'approved' && approval !== 'denied') {
      return out(400, { ok: false, error: 'approval must be "approved" or "denied"' });
    }
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

  // Already answered: report the stored decision, whichever way it went.
  if (state === 'approved' || state === 'denied') {
    return out(200, { ok: true, callId: row.id, approval: state, already: true });
  }
  if (state !== 'ready') {
    return out(409, { ok: false, error: state, callId: row.id });
  }

  // Conditional write: the filters repeat the readiness test so two taps racing
  // each other cannot both win. return=representation is how an RLS-style
  // silent zero-row update is told apart from a real one.
  const upd = await rest(
    `?approval_token=eq.${encodeURIComponent(token)}&status=eq.queued&approval=is.null&approval_asked_at=not.is.null`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ approval }) },
  );
  if (!upd.ok) return out(502, { ok: false, error: 'write_failed', status: upd.status });
  const written = await upd.json().catch(() => []);
  if (written?.length) return out(200, { ok: true, callId: row.id, approval });

  // Lost a race, or the runner moved the row on between the read and the write.
  const again = await findByToken(token).catch(() => null);
  state = again ? stateOf(again) : 'closed';
  if (state === 'approved' || state === 'denied') {
    return out(200, { ok: true, callId: row.id, approval: state, already: true });
  }
  return out(409, { ok: false, error: state, callId: row.id });
}

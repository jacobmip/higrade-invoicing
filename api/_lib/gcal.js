// /api/_lib/gcal.js — server-side Google Calendar credentials + access.
//
// The browser no longer talks to Google. It talks to /api/gcal, which uses the
// one stored refresh token to mint access tokens on demand. That is the whole
// point: a refresh token does not expire on a schedule (once the OAuth consent
// screen is published to Production), so the connection survives closing the
// tab, a new laptop, and the iOS build.
//
// Config resolves from Vercel env first, then falls back to the settings table,
// matching the pattern in _lib/sms.js. Put the client secret in Vercel env —
// settings is readable by every signed-in browser, see migration 045.
//
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   SUPABASE_SERVICE_ROLE_KEY   (required — this table is service-role only)

import crypto from 'node:crypto';

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';
const CRED_ID = 'google_calendar';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export function supaUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || SUPABASE_URL_FALLBACK;
}

// Deliberately does NOT fall back to the anon key. google_credentials has RLS
// on with no policies, so an anon-key read returns an empty array rather than
// an error — which would look exactly like "not connected yet" and send you
// hunting for a missing refresh token that was there the whole time.
function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for Google Calendar sync');
  return key;
}

function serviceHeaders(extra) {
  const key = serviceKey();
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, ...(extra || {}) };
}

export function clientId() {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || null;
}

export function clientSecret() {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET || null;
}

export function isConfigured() {
  return Boolean(clientId() && clientSecret());
}

export function redirectUri(req) {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/gcal-auth`;
}

// ─── Credential row ────────────────────────────────────────────────────────

export async function getCredentials() {
  const res = await fetch(
    `${supaUrl()}/rest/v1/google_credentials?id=eq.${CRED_ID}&select=*&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!res.ok) throw new Error(`Reading google_credentials failed ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows?.[0] || null;
}

export async function saveCredentials(patch) {
  const res = await fetch(`${supaUrl()}/rest/v1/google_credentials?on_conflict=id`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({ id: CRED_ID, ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Writing google_credentials failed ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows?.[0] || null;
}

// ─── Access tokens ─────────────────────────────────────────────────────────

// Warm-lambda cache. Vercel reuses a container across requests, so paging a
// month of calendar usually costs one refresh call rather than one per event.
let memo = { token: null, expires: 0 };

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant means the grant itself is dead: consent revoked in the
    // Google account, the client secret rotated, or — the classic — the OAuth
    // app is still in "Testing" and Google expired the refresh token after
    // 7 days. Surface it as its own signal so /api/gcal can say
    // "reconnect required" instead of a generic 500.
    const err = new Error(json.error_description || json.error || `Token refresh failed ${res.status}`);
    err.code = json.error === 'invalid_grant' ? 'reconnect_required' : 'refresh_failed';
    throw err;
  }
  return { token: json.access_token, expiresIn: json.expires_in || 3600 };
}

export async function getAccessToken() {
  const now = Date.now();
  if (memo.token && memo.expires > now + 60_000) return memo.token;

  const cred = await getCredentials();
  if (!cred?.refresh_token) {
    const err = new Error('Google Calendar is not connected');
    err.code = 'not_connected';
    throw err;
  }

  // A cold lambda can still reuse the token a previous one stored.
  const storedExpiry = cred.access_token_expires_at ? Date.parse(cred.access_token_expires_at) : 0;
  if (cred.access_token && storedExpiry > now + 60_000) {
    memo = { token: cred.access_token, expires: storedExpiry };
    return cred.access_token;
  }

  const { token, expiresIn } = await refreshAccessToken(cred.refresh_token);
  const expires = now + expiresIn * 1000;
  memo = { token, expires };
  // Best effort. A failed write costs one extra refresh on the next cold
  // start, which is not worth failing the caller's calendar request over.
  saveCredentials({
    access_token: token,
    access_token_expires_at: new Date(expires).toISOString(),
  }).catch(e => console.warn('[gcal] could not cache access token:', e.message));
  return token;
}

export function clearTokenCache() {
  memo = { token: null, expires: 0 };
}

// ─── Google Calendar API ───────────────────────────────────────────────────

export async function calendarFetch(path, opts = {}, _retried = false) {
  const token = await getAccessToken();
  const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  // Google rejected a token we believed was live (revoked, or clock skew).
  // Drop the cache and force exactly one real refresh before giving up.
  if (res.status === 401 && !_retried) {
    clearTokenCache();
    await saveCredentials({ access_token: null, access_token_expires_at: null }).catch(() => {});
    return calendarFetch(path, opts, true);
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `Google Calendar error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ─── Caller auth ───────────────────────────────────────────────────────────

// /api/gcal acts on Jake's calendar with a stored grant, so it must never be
// callable anonymously — that would be an open write proxy into his calendar
// for anyone who guesses the URL. Require the Supabase session the app already
// holds and let Supabase validate it.
export async function requireUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const res = await fetch(`${supaUrl()}/auth/v1/user`, {
    headers: { apikey: anon || serviceKey(), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

// ─── OAuth state ───────────────────────────────────────────────────────────

// The consent screen is reached by a top-level browser navigation, which
// cannot carry an Authorization header. So the app asks this server for the
// URL while authenticated and we sign a short-lived state into it. The
// callback checks that signature, which stops a stranger opening
// /api/gcal-auth and grafting THEIR Google account over Jake's stored grant.
function stateSecret() {
  return crypto.createHash('sha256').update(serviceKey()).digest();
}

export function signState(userId, ttlMs = 10 * 60_000) {
  const payload = `${userId}.${Date.now() + ttlMs}`;
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex').slice(0, 32);
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyState(state) {
  if (!state || typeof state !== 'string') return false;
  const [encoded, sig] = state.split('.');
  if (!encoded || !sig) return false;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return false; }
  const expected = crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex').slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expiry = Number(payload.split('.')[1]);
  return Number.isFinite(expiry) && expiry > Date.now();
}

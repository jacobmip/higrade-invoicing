// Google Calendar OAuth + API helper
//
// SETUP:
//  1. Go to https://console.cloud.google.com
//  2. Create a project → Library → enable "Google Calendar API"
//  3. Credentials → + Create Credentials → OAuth 2.0 Client ID → Web application
//  4. Authorized JavaScript origins: add your Vercel URL (e.g. https://yourdomain.vercel.app)
//     and http://localhost:5173 for local dev
//  5. Copy the Client ID
//  6. Add VITE_GOOGLE_CLIENT_ID=<your_client_id> to .env.local and to Vercel env vars

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const TZ = 'Pacific/Honolulu';

let _tokenClient = null;
let _scriptPromise = null;

export const isConfigured = () => Boolean(CLIENT_ID);

function getStored() {
  try { return JSON.parse(localStorage.getItem('gcal_token')); } catch { return null; }
}

export function getStoredToken() {
  const d = getStored();
  return d?.expires > Date.now() + 60_000 ? d.token : null;
}

function storeToken(resp) {
  localStorage.setItem('gcal_token', JSON.stringify({
    token: resp.access_token,
    expires: Date.now() + resp.expires_in * 1000,
  }));
}

function clearToken() {
  try { localStorage.removeItem('gcal_token'); } catch {}
}

// Load Google Identity Services once. The old version set only `onload`, so a
// blocked or failed script left the promise pending forever and the Connect
// button did nothing at all, with no error anywhere.
function loadScript() {
  if (window.google?.accounts) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { _scriptPromise = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

export async function initAuth() {
  if (_tokenClient) return;
  await loadScript();
  if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in unavailable');
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {},
  });
}

// Ask the already-initialised client for a token. Kept separate so the
// interactive path can call it with no `await` in front of it.
function askForToken(prompt) {
  return new Promise((resolve, reject) => {
    let settled = false;
    _tokenClient.callback = resp => {
      if (settled) return;
      settled = true;
      if (resp.error || !resp.access_token) { reject(new Error(resp.error || 'No token returned')); return; }
      storeToken(resp);
      resolve(resp.access_token);
    };
    _tokenClient.error_callback = err => {
      if (settled) return;
      settled = true;
      reject(new Error(err?.type === 'popup_closed' ? 'Sign-in was cancelled.' : (err?.message || 'Google sign-in failed')));
    };
    _tokenClient.requestAccessToken({ prompt });
  });
}

export function requestToken(prompt = '') {
  const stored = getStoredToken();
  if (stored) return Promise.resolve(stored);
  // If the client is already warm, call straight through with no await in
  // between. `requestAccessToken` opens a popup, and iOS Safari only allows
  // that inside the user gesture that triggered it — awaiting a script load
  // first breaks the chain and the popup is silently blocked.
  if (_tokenClient) return askForToken(prompt);
  return initAuth().then(() => askForToken(prompt));
}

// Google's implicit flow hands back an access token that expires in one hour
// and no refresh token, which is why the app appeared to log itself out
// overnight or on reopen. Consent, though, is remembered by Google — so as
// long as the browser still has a Google session we can get a fresh token
// with no prompt and no UI at all.
//
// Resolves to a token, or null if a real sign-in is needed. Never throws and
// never shows anything, so it is safe to call on startup.
export async function silentRefresh() {
  if (!isConfigured()) return null;
  const stored = getStoredToken();
  if (stored) return stored;
  try { await initAuth(); } catch { return null; }
  return new Promise(resolve => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };
    _tokenClient.callback = resp => {
      if (resp.error || !resp.access_token) { done(null); return; }
      storeToken(resp);
      done(resp.access_token);
    };
    _tokenClient.error_callback = () => done(null);
    // With no Google session, GIS can neither succeed nor fire an error — it
    // just never calls back. Without this the caller would await forever.
    setTimeout(() => done(null), 8000);
    try { _tokenClient.requestAccessToken({ prompt: 'none' }); } catch { done(null); }
  });
}

export function signOut() {
  const d = getStored();
  if (d?.token) window.google?.accounts.oauth2.revoke(d.token);
  clearToken();
}

async function apiFetch(path, opts = {}, _retried = false) {
  const token = await requestToken();
  const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  // Google rejected the token before our own expiry check would have. Drop it
  // and try one silent refresh — a revoked or clock-skewed token would
  // otherwise surface as a bare "Invalid Credentials" with no way back.
  if (res.status === 401 && !_retried) {
    clearToken();
    const fresh = await silentRefresh();
    if (fresh) return apiFetch(path, opts, true);
  }
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'Google Calendar error');
  return json;
}

export async function listEvents(timeMin, timeMax) {
  const p = new URLSearchParams({
    timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
  });
  const d = await apiFetch(`/calendars/primary/events?${p}`);
  return d?.items || [];
}

export async function createEvent(event) {
  return apiFetch('/calendars/primary/events', { method: 'POST', body: JSON.stringify(event) });
}

// Partial update. Google merges what you send and leaves the rest alone, which
// is the whole point here: an event created by the AI receptionist's Apps
// Script carries a title, the lead notes and the job address, and moving its
// date must not take those with it. Deleting and re-creating the event -- the
// old behaviour -- replaced all of it with the app's own bare template.
export async function updateEvent(id, patch) {
  return apiFetch(`/calendars/primary/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteEvent(id) {
  await apiFetch(`/calendars/primary/events/${id}`, { method: 'DELETE' });
}

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

export async function initAuth() {
  if (_tokenClient) return;
  if (!window.google?.accounts) {
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {},
  });
}

export function requestToken(prompt = '') {
  return new Promise(async (resolve, reject) => {
    const stored = getStoredToken();
    if (stored) { resolve(stored); return; }
    try { await initAuth(); } catch (e) { reject(e); return; }
    _tokenClient.callback = resp => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      storeToken(resp);
      resolve(resp.access_token);
    };
    _tokenClient.requestAccessToken({ prompt });
  });
}

export function signOut() {
  const d = getStored();
  if (d?.token) window.google?.accounts.oauth2.revoke(d.token);
  localStorage.removeItem('gcal_token');
}

async function apiFetch(path, opts = {}) {
  const token = await requestToken();
  const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
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

export async function deleteEvent(id) {
  await apiFetch(`/calendars/primary/events/${id}`, { method: 'DELETE' });
}

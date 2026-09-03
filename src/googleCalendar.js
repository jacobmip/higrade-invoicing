// Google Calendar client — talks to /api/gcal, never to Google directly.
//
// WHAT CHANGED AND WHY
// The old version used Google Identity Services in the page
// (google.accounts.oauth2.initTokenClient). That is the implicit flow: it hands
// back an access token good for ONE HOUR and no refresh token, kept in
// localStorage. So the calendar disconnected about hourly, separately in every
// browser, and the "Connect Google Calendar" button came back over and over.
// silentRefresh() hid it only while the browser still held a live Google
// session cookie — which Safari and the Capacitor shell block, so on the phone
// it never held at all.
//
// Google issues a refresh token only to a server-side code exchange, so that
// moved to the server and the grant now lives in the database. This file
// just forwards calls with the user's Supabase session. Connect once, on any
// machine, and every machine plus the iOS build is connected.
//
// SETUP (one time, in https://console.cloud.google.com):
//  1. APIs & Services → Library → enable "Google Calendar API"
//  2. Credentials → OAuth 2.0 Client ID → Web application
//  3. Authorized redirect URI: https://higrade-invoicing.vercel.app/api/gcal
//  4. Put the client ID + secret in Vercel env as GOOGLE_CLIENT_ID and
//     GOOGLE_CLIENT_SECRET
//  5. OAuth consent screen → PUBLISH TO PRODUCTION. Left in "Testing", Google
//     expires the refresh token after 7 days and the disconnect comes back.

import { supabase } from './supabase.js';
import { api } from './apiBase.js';

export const TZ = 'Pacific/Honolulu';

// Sweep up the dead access token the old implicit flow left behind. Nothing
// reads it any more, but leaving a key named gcal_token in localStorage is a
// good way to send the next person debugging in the wrong direction.
try { localStorage.removeItem('gcal_token'); } catch { /* private mode */ }

// Mirrors the server's answer to { op: 'status' }. Starts optimistic on
// `configured` so the UI does not flash "not configured" on first paint.
let _status = { configured: true, connected: false, email: null, calendarId: 'primary', missing: [] };

export const isConfigured = () => _status.configured;
export const isConnected = () => _status.connected;
export const connectedEmail = () => _status.email;
// Which server env vars the /api routes reported missing, so the Calendar tab
// can name them instead of showing a dead Connect button.
export const missingConfig = () => _status.missing || [];

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sign in to the app first.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function call(payload) {
  const res = await fetch(api('/api/gcal'), {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server distinguishes "never connected" from "the grant died", and
    // both mean the same thing to the UI: the Connect button comes back.
    if (json.error === 'not_connected' || json.error === 'reconnect_required') {
      _status = { ..._status, connected: false };
      const err = new Error(json.error === 'reconnect_required'
        ? 'Google Calendar needs reconnecting.'
        : 'Google Calendar is not connected.');
      err.code = json.error;
      throw err;
    }
    throw new Error(json.error || `Calendar request failed (${res.status})`);
  }
  return json;
}

// ─── Connection ────────────────────────────────────────────────────────────

// Safe to call on startup: never throws, never shows anything.
export async function checkStatus() {
  try {
    const s = await call({ op: 'status' });
    _status = {
      configured: s.configured !== false,
      connected: Boolean(s.connected),
      email: s.email || null,
      calendarId: s.calendarId || 'primary',
      missing: s.missing || [],
    };
  } catch {
    _status = { ..._status, connected: false };
  }
  return _status;
}

// Opens Google's consent screen and resolves once the server has the grant.
//
// A popup rather than a same-tab redirect, because in the Capacitor build the
// app is served from capacitor:// and Google will not redirect back to a custom
// scheme. The popup lands on the Vercel callback page instead, and we learn the
// outcome by polling the server — which works identically on web and native.
export async function connect() {
  // Open the window BEFORE any await. The consent URL has to be fetched from
  // the server first, but a window.open() after an await is no longer inside
  // the click's gesture and gets blocked — silently, on iOS Safari. So claim
  // the window on the gesture and point it at the URL once we have it.
  let popup = window.open('', 'gcal-connect', 'width=520,height=680');

  let json;
  try {
    json = await call({ op: 'connect_url' });
    if (!json?.url) throw new Error('Could not start Google sign-in.');
  } catch (e) {
    try { popup?.close(); } catch { /* already gone */ }
    throw e;
  }

  // A blocker still got it, or the shell does not do popups. Falling back to
  // the current tab costs unsaved form state, so it is the last resort.
  if (!popup || popup.closed) { window.location.href = json.url; return false; }
  popup.location.href = json.url;

  // Poll rather than listen for a postMessage: the callback page is on the
  // Vercel origin and the app may be on capacitor://, so they cannot talk.
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    const s = await checkStatus();
    if (s.connected) { try { popup.close(); } catch { /* cross-origin */ } return true; }
    let closed = false;
    try { closed = popup.closed; } catch { /* cross-origin */ }
    // Give the callback a moment to finish writing before believing a closed
    // window means failure.
    if (closed) {
      await new Promise(r => setTimeout(r, 1200));
      return (await checkStatus()).connected;
    }
  }
  return false;
}

export async function disconnect() {
  try { await call({ op: 'disconnect' }); } catch { /* already gone */ }
  _status = { ..._status, connected: false, email: null };
}

// ─── Events ────────────────────────────────────────────────────────────────

export async function listEvents(timeMin, timeMax) {
  const d = await call({ op: 'list', timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() });
  return d?.items || [];
}

export async function createEvent(event) {
  return call({ op: 'create', event });
}

// Partial update. Google merges what you send and leaves the rest alone, which
// is the whole point here: an event created by the AI receptionist's Apps
// Script carries a title, the lead notes and the job address, and moving its
// date must not take those with it.
export async function updateEvent(id, patch) {
  return call({ op: 'update', id, patch });
}

export async function deleteEvent(id) {
  await call({ op: 'delete', id });
}

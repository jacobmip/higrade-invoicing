// /api/gcal — the app's only route to Google Calendar.
//
// Replaces the direct browser calls in src/googleCalendar.js. The browser holds
// no Google token at all now; it sends its Supabase session and this route acts
// with the stored refresh token. That is what stops the hourly disconnect and
// what makes the connection shared across every browser and the iOS build.
//
// POST /api/gcal   Authorization: Bearer <supabase access token>
//   { op: 'status' }                              → { connected, email, calendarId, configured }
//   { op: 'list', timeMin, timeMax }              → { items: [...] }
//   { op: 'create', event }                       → the created event
//   { op: 'update', id, patch }                   → the patched event
//   { op: 'delete', id }                          → { ok: true }
//   { op: 'disconnect' }                          → { ok: true }
//
// Only these six ops exist on purpose. Forwarding an arbitrary path and method
// would make this a general-purpose proxy into Jake's Google account for any
// signed-in user, including the test plumber login.
//
// Classic (req, res) signature — a Web Response hangs the nodejs runtime, see
// the note at the top of public-invoice.js.

import {
  calendarFetch, getCredentials, saveCredentials, requireUser,
  isConfigured, clearTokenCache, clientId, clientSecret,
} from './_lib/gcal.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function cal(id) {
  return `/calendars/${encodeURIComponent(id)}/events`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'unauthorized' });

  const body = await readBody(req);
  const op = body?.op;

  try {
    // status and disconnect must work even with no grant stored, so they run
    // before anything that would try to mint an access token.
    if (op === 'status') {
      // Self-diagnosing on purpose. Every one of these is set in the Vercel
      // dashboard, where a typo is invisible from the code, and a missing one
      // otherwise surfaces as a generic 500 that looks identical to "Google is
      // down". Naming them lets the app say which is missing.
      const missing = [];
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
      if (!clientId()) missing.push('GOOGLE_CLIENT_ID');
      if (!clientSecret()) missing.push('GOOGLE_CLIENT_SECRET');
      if (missing.length) {
        return json(res, 200, { configured: false, connected: false, missing });
      }
      const cred = await getCredentials();
      return json(res, 200, {
        configured: isConfigured(),
        connected: Boolean(cred?.refresh_token),
        email: cred?.google_email || null,
        calendarId: cred?.calendar_id || 'primary',
        connectedAt: cred?.connected_at || null,
        missing: [],
      });
    }

    if (op === 'disconnect') {
      await saveCredentials({
        refresh_token: null, access_token: null, access_token_expires_at: null,
        google_email: null, connected_at: null,
      });
      clearTokenCache();
      return json(res, 200, { ok: true });
    }

    const cred = await getCredentials();
    if (!cred?.refresh_token) return json(res, 409, { error: 'not_connected' });
    const calendarId = cred.calendar_id || 'primary';

    if (op === 'list') {
      const { timeMin, timeMax } = body;
      if (!timeMin || !timeMax) return json(res, 400, { error: 'timeMin and timeMax are required' });
      const p = new URLSearchParams({
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      const data = await calendarFetch(`${cal(calendarId)}?${p}`);
      return json(res, 200, { items: data?.items || [] });
    }

    if (op === 'create') {
      if (!body.event) return json(res, 400, { error: 'event is required' });
      const created = await calendarFetch(cal(calendarId), {
        method: 'POST', body: JSON.stringify(body.event),
      });
      return json(res, 200, created);
    }

    if (op === 'update') {
      if (!body.id || !body.patch) return json(res, 400, { error: 'id and patch are required' });
      // PATCH, not PUT. Events created by the receptionist's Apps Script carry
      // the lead notes and the job address; a full replace would drop them and
      // leave the customer's details nowhere.
      const updated = await calendarFetch(`${cal(calendarId)}/${encodeURIComponent(body.id)}`, {
        method: 'PATCH', body: JSON.stringify(body.patch),
      });
      return json(res, 200, updated);
    }

    if (op === 'delete') {
      if (!body.id) return json(res, 400, { error: 'id is required' });
      try {
        await calendarFetch(`${cal(calendarId)}/${encodeURIComponent(body.id)}`, { method: 'DELETE' });
      } catch (e) {
        // Already gone (deleted in Google's UI) is the outcome the caller
        // wanted. Anything else is a real failure.
        if (e.status !== 404 && e.status !== 410) throw e;
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: 'unknown_op', op: op || null });
  } catch (e) {
    if (e.code === 'not_connected') return json(res, 409, { error: 'not_connected' });
    // The grant died — revoked in the Google account, secret rotated, or the
    // consent screen was left in Testing and Google expired the refresh token
    // after 7 days. The app shows a Reconnect prompt for this specific code.
    if (e.code === 'reconnect_required') return json(res, 409, { error: 'reconnect_required' });
    console.error('[gcal] error:', e);
    return json(res, e.status && e.status < 500 ? e.status : 500, { error: e.message || String(e) });
  }
}

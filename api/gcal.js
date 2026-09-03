// /api/gcal — the app's only route to Google Calendar, and the OAuth callback.
//
// The browser holds no Google token. It sends its Supabase session and this
// route acts with a stored refresh token, which is what stops the hourly
// disconnect and makes one connect cover every browser and the iOS build.
//
// POST  Authorization: Bearer <supabase access token>
//   { op: 'status' }                   → { connected, email, calendarId, missing }
//   { op: 'connect_url' }              → { url } to open Google's consent screen
//   { op: 'list', timeMin, timeMax }   → { items: [...] }
//   { op: 'create', event }            → the created event
//   { op: 'update', id, patch }        → the patched event
//   { op: 'delete', id }               → { ok: true }
//   { op: 'disconnect' }               → { ok: true }
//
// GET ?code=...&state=...              → Google's redirect after consent.
//                                        Exchanges the code for a refresh token.
//
// WHY THE CALLBACK LIVES HERE rather than in its own api/gcal-auth.js file:
// the Hobby plan allows 12 Node Serverless Functions per deployment. Edge
// functions do not count, and six of this project's routes are edge, so the
// real count was 11 — two separate files took it to 13 and every deploy failed
// at "Deploying outputs..." with NO error line in the build log. Keep this at
// one file. See the note in CLAUDE.md before adding another Node route.
//
// Only named ops exist on purpose. Forwarding an arbitrary path and method
// would make this a general-purpose proxy into Jake's Google account for any
// signed-in user, including the test plumber account.
//
// Classic (req, res) signature — a Web Response hangs the nodejs runtime, see
// the note at the top of public-invoice.js.

import {
  GOOGLE_SCOPE, calendarFetch, getCredentials, saveCredentials, requireUser,
  isConfigured, clearTokenCache, clientId, clientSecret, redirectUri,
  signState, verifyState,
} from './_lib/gcal.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function page(res, status, title, message, ok) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0f1b33;color:#fff;font-family:system-ui,-apple-system,sans-serif;padding:24px}
  .card{background:#fff;color:#1a1a1a;border-radius:14px;padding:28px 26px;max-width:380px;text-align:center;
        box-shadow:0 8px 30px rgba(0,0,0,.3)}
  .dot{width:46px;height:46px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;
       justify-content:center;font-size:24px;color:#fff;background:${ok ? '#27ae60' : '#cc4444'}}
  h1{font-size:19px;margin:0 0 8px}
  p{font-size:14px;line-height:1.5;color:#555;margin:0}
</style>
<div class="card"><div class="dot">${ok ? '&#10003;' : '!'}</div><h1>${title}</h1><p>${message}</p></div>`);
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

function missingConfig() {
  const missing = [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!clientId()) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret()) missing.push('GOOGLE_CLIENT_SECRET');
  return missing;
}

// ─── OAuth callback (GET) ──────────────────────────────────────────────────

async function handleCallback(req, res, url) {
  const error = url.searchParams.get('error');
  if (error) {
    return page(res, 400, 'Not connected',
      error === 'access_denied'
        ? 'Consent was cancelled. Close this and tap Connect again when ready.'
        : `Google returned: ${error}`,
      false);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return page(res, 400, 'Not connected', 'Google did not return an authorization code.', false);
  if (!verifyState(state)) {
    return page(res, 403, 'Not connected',
      'That connect link was not valid or has expired. Open the app and tap Connect again.', false);
  }

  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      console.error('[gcal] code exchange failed:', tokenRes.status, tok);
      return page(res, 502, 'Not connected', tok.error_description || tok.error || 'Token exchange failed.', false);
    }

    if (!tok.refresh_token) {
      // With prompt=consent this should not happen. If it does, the grant is
      // useless: storing it would look connected and then disconnect in an
      // hour, which is exactly the bug being fixed. Refuse it instead.
      console.error('[gcal] no refresh_token in response', Object.keys(tok));
      return page(res, 502, 'Not connected',
        'Google did not return a refresh token. Remove this app at myaccount.google.com/permissions, then tap Connect again.',
        false);
    }

    // Whose account did we just connect? Handy when the wrong Google account
    // is signed in, which is otherwise invisible until events land nowhere.
    let email = null;
    try {
      const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (who.ok) email = (await who.json())?.email || null;
    } catch { /* not fatal */ }

    const expires = Date.now() + (tok.expires_in || 3600) * 1000;
    await saveCredentials({
      refresh_token: tok.refresh_token,
      access_token: tok.access_token || null,
      access_token_expires_at: new Date(expires).toISOString(),
      scope: tok.scope || GOOGLE_SCOPE,
      google_email: email,
      connected_at: new Date().toISOString(),
    });
    clearTokenCache();

    return page(res, 200, 'Calendar connected',
      `${email ? email + ' is' : 'Your Google account is'} linked. This stays connected — you can close this window and go back to the app.`,
      true);
  } catch (e) {
    console.error('[gcal] callback error:', e);
    return page(res, 500, 'Not connected', e.message || String(e), false);
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = new URL(req.url, `${proto}://${host}`);

  // Google's redirect lands here. It is a plain browser navigation with no
  // Authorization header, which is why it is authenticated by the signed
  // state parameter instead.
  if (req.method === 'GET') {
    if (url.searchParams.has('code') || url.searchParams.has('error')) {
      return handleCallback(req, res, url);
    }
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'unauthorized' });

  const body = await readBody(req);
  const op = body?.op;

  try {
    // status, connect_url and disconnect must work with no grant stored, so
    // they run before anything that would try to mint an access token.
    if (op === 'status') {
      // Self-diagnosing on purpose. These are set in the Vercel dashboard,
      // where a typo is invisible from the code, and a missing one would
      // otherwise surface as a generic 500 that looks like "Google is down".
      const missing = missingConfig();
      if (missing.length) return json(res, 200, { configured: false, connected: false, missing });
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

    if (op === 'connect_url') {
      const missing = missingConfig();
      if (missing.length) {
        return json(res, 500, { error: 'not_configured', detail: `Missing in Vercel: ${missing.join(', ')}` });
      }
      const params = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(req),
        response_type: 'code',
        scope: GOOGLE_SCOPE,
        // access_type=offline is what makes Google issue a refresh token at
        // all. Without it this is the old one-hour flow with extra steps.
        access_type: 'offline',
        // Google only returns a refresh token on the FIRST consent for a given
        // client/account pair. Reconnecting after a revoke would otherwise
        // hand back an access token with no refresh token and silently
        // reintroduce the hourly disconnect, so force consent every time.
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: signState(user.id),
      });
      return json(res, 200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
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

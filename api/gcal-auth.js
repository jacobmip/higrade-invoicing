// /api/gcal-auth — one-time Google Calendar connect.
//
// Two jobs on one route:
//
//   POST  (Authorization: Bearer <supabase access token>)
//         → { url } — the Google consent URL to open. Signed state, 10 min.
//
//   GET   ?code=...&state=...
//         → Google redirects the browser here after consent. Exchanges the code
//           for a REFRESH token, stores it, and renders a small "you can close
//           this" page. This is the only place a refresh token is ever issued.
//
// Uses the classic (req, res) signature. Returning a Web Response from the
// nodejs runtime hangs until timeout — see the note at the top of
// public-invoice.js.

import {
  GOOGLE_SCOPE, clientId, clientSecret, isConfigured, redirectUri,
  saveCredentials, requireUser, signState, verifyState, clearTokenCache,
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

async function handleStart(req, res) {
  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'unauthorized' });
  if (!isConfigured()) {
    return json(res, 500, {
      error: 'not_configured',
      detail: 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel.',
    });
  }

  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    // access_type=offline is what makes Google issue a refresh token at all.
    // Without it this is just the old one-hour flow with extra steps.
    access_type: 'offline',
    // Google only returns a refresh token on the FIRST consent for a given
    // client/account pair. Reconnecting after a revoke would otherwise hand
    // back an access token with no refresh token and silently reintroduce the
    // hourly disconnect, so force the consent screen every time.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signState(user.id),
  });

  json(res, 200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
}

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
      console.error('[gcal-auth] code exchange failed:', tokenRes.status, tok);
      return page(res, 502, 'Not connected', tok.error_description || tok.error || 'Token exchange failed.', false);
    }

    if (!tok.refresh_token) {
      // With prompt=consent this should not happen. If it does, the grant is
      // useless: storing it would look connected and then disconnect in an
      // hour, which is exactly the bug being fixed. Refuse it instead.
      console.error('[gcal-auth] no refresh_token in response', Object.keys(tok));
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
    console.error('[gcal-auth] error:', e);
    return page(res, 500, 'Not connected', e.message || String(e), false);
  }
}

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = new URL(req.url, `${proto}://${host}`);

  if (req.method === 'POST') return handleStart(req, res);
  if (req.method === 'GET') return handleCallback(req, res, url);
  return json(res, 405, { error: 'method_not_allowed' });
}

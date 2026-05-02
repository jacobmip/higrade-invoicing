// /api/register-device
// Capacitor app calls this on launch (and whenever the APNs token rotates)
// to upsert its device token into device_tokens. We use the service-role
// key here because device_tokens has RLS that locks out the anon role.
//
// Body: { token: string, platform: 'ios'|'android'|'web', bundle_id?, app_version? }

export const config = { runtime: 'nodejs', maxDuration: 10 };

const SUPABASE_URL_FALLBACK = 'https://cwhgcxxszyvevjpbnnkc.supabase.co';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload;
  try { payload = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { token, platform, bundle_id, app_version } = payload || {};
  if (!token || typeof token !== 'string') return json({ error: 'Missing token' }, 400);
  if (!['ios', 'android', 'web'].includes(platform)) return json({ error: 'Invalid platform' }, 400);

  const url = process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
            || process.env.VITE_SUPABASE_ANON_KEY
            || process.env.SUPABASE_ANON_KEY;
  if (!key) return json({ error: 'Server not configured' }, 500);

  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    // Postgres unique-constraint upsert via PostgREST.
    'Prefer': 'resolution=merge-duplicates,return=representation',
  };

  try {
    const res = await fetch(`${url}/rest/v1/device_tokens?on_conflict=token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        token,
        platform,
        bundle_id: bundle_id || null,
        app_version: app_version || null,
        last_seen_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[register-device] upsert failed:', res.status, text);
      return json({ error: 'Upsert failed', detail: text }, 500);
    }
    const rows = await res.json();
    return json({ ok: true, id: rows?.[0]?.id });
  } catch (e) {
    console.error('[register-device] error:', e);
    return json({ error: e.message || String(e) }, 500);
  }
}

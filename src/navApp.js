// Which maps app the Navigate buttons open, chosen per person in Settings.
//
// Stored on the signed-in user's own auth record (user_metadata.nav_app), so it
// follows them to any phone they sign in on and each person picks their own.
// Every user may update their own metadata, so this needs no table, no policy
// and no migration. A localStorage copy lets the buttons build their link
// synchronously at render time; it is refreshed from the session on sign-in.
//
// Both Navigate buttons (JobActions.jsx and OnMyWay.jsx) call mapsUrl(), so the
// choice applies everywhere and the two can no longer drift apart.
import { supabase } from './supabase.js';

export const NAV_APPS = [
  { value: 'auto',   label: 'Phone default (Apple Maps on iPhone)' },
  { value: 'apple',  label: 'Apple Maps' },
  { value: 'google', label: 'Google Maps' },
  { value: 'waze',   label: 'Waze' },
];
const VALID = new Set(NAV_APPS.map(a => a.value));
const CACHE_KEY = 'higrade_nav_app';

export function getNavApp() {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return VALID.has(v) ? v : 'auto';
  } catch { return 'auto'; }
}

function cache(v) {
  try { localStorage.setItem(CACHE_KEY, VALID.has(v) ? v : 'auto'); } catch { /* private mode */ }
}

// Keep the cache in step with whoever is signed in. Signing out clears it, so
// the next person on a shared phone starts on the phone default, not on the
// previous person's choice.
supabase.auth?.onAuthStateChange?.((event, session) => {
  if (event === 'SIGNED_OUT') { try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } return; }
  const v = session?.user?.user_metadata?.nav_app;
  if (v) cache(v);
});

export async function setNavApp(value) {
  const v = VALID.has(value) ? value : 'auto';
  const prev = getNavApp();
  cache(v);
  const { error } = await supabase.auth.updateUser({ data: { nav_app: v } });
  if (error) { cache(prev); throw error; }
  return v;
}

const isApple = () => /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent || '');

// Turn-by-turn directions to `address` in the person's chosen app. Each is the
// app's documented https link, which opens the installed app on iPhone and
// Android and falls back to the website when it is not installed.
export function mapsUrl(address, app = getNavApp()) {
  const q = encodeURIComponent(address);
  const choice = app === 'auto' ? (isApple() ? 'apple' : 'google') : app;
  if (choice === 'apple') return `https://maps.apple.com/?daddr=${q}`;
  if (choice === 'waze') return `https://waze.com/ul?q=${q}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

// API base URL helper.
//
// On the web (Vercel) the app and serverless functions share an origin, so
// relative `/api/...` calls work. In a native Capacitor build the app is
// served from `capacitor://` (iOS) or `https://localhost` (Android), so we
// must point `/api/...` calls at the live Vercel deployment.

const PROD_API = 'https://higrade-invoicing.vercel.app';

function isNative() {
  if (typeof window === 'undefined') return false;
  // Capacitor sets window.Capacitor.isNativePlatform()
  if (window.Capacitor?.isNativePlatform?.()) return true;
  // Fallback: detect non-http(s) protocols used by native shells
  const proto = window.location.protocol;
  if (proto === 'capacitor:' || proto === 'ionic:' || proto === 'file:') return true;
  return false;
}

// In Capacitor live-reload mode the app loads from a LAN URL like
// http://192.168.x.x:5173 instead of capacitor://. There's no `/api`
// serverless backend on the dev server, so route those calls to Vercel.
function isLiveReload() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (!host) return false;
  // Private LAN ranges + non-localhost dev hosts
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
}

export const API_BASE = (isNative() || isLiveReload()) ? PROD_API : '';

export function api(path) {
  if (!path.startsWith('/')) path = '/' + path;
  return API_BASE + path;
}

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

export const API_BASE = isNative() ? PROD_API : '';

export function api(path) {
  if (!path.startsWith('/')) path = '/' + path;
  return API_BASE + path;
}

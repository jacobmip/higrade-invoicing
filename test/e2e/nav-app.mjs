// Per-user Navigation App setting (v1.51.0), driven in a real browser against a
// fake Supabase. Run: npm run build && npx vite preview --port 4173, then
//   node test/e2e/nav-app.mjs
// Playwright must resolve: install it locally, or set NODE_PATH to a global install.
// Pass = a non-admin sees the card, picking Waze saves {nav_app:"waze"} to their
// own login, and a second phone that signs in fresh shows Waze.
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:4173';
const TECH = 'fbf88c7c-ae9c-4601-af22-d0959d59a040';
const t0 = Date.now(); const log = (...a) => console.log(String(Date.now() - t0).padStart(6), ...a);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: TECH, role: 'authenticated', exp, aud: 'authenticated' })}.sig`;
const server = { user_metadata: {} };            // what the auth server holds for this login
const userObj = () => ({ id: TECH, aud: 'authenticated', role: 'authenticated', email: 'test@higradeplumbing.com', user_metadata: { ...server.user_metadata } });
const session = () => ({ access_token: jwt, refresh_token: 'r', expires_in: 86400, expires_at: exp, token_type: 'bearer', user: userObj() });
const profiles = [{ id: TECH, display_name: 'Test Tech', role: 'plumber', tier: 'service_tech' }];
let saves = 0;

async function phone(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  await ctx.addInitScript(s => localStorage.setItem('sb-cwhgcxxszyvevjpbnnkc-auth-token', JSON.stringify(s)), session());
  const page = await ctx.newPage();
  page.on('pageerror', e => log(name, 'PAGEERROR', e.message));
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (!url.hostname.includes('supabase.co') && !url.pathname.startsWith('/api/')) return route.continue();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname.startsWith('/api/')) return json({});
    if (url.pathname.startsWith('/auth/v1/user')) {
      if (req.method() === 'PUT') { const d = req.postDataJSON()?.data || {}; Object.assign(server.user_metadata, d); saves++; log(name, 'SAVED to login:', JSON.stringify(d)); }
      return json(userObj());
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(session());
    if (url.pathname.startsWith('/realtime')) return route.abort();
    if (url.pathname === '/rest/v1/profiles' && req.method() === 'GET') {
      const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      return single ? json(profiles[0]) : json(profiles);
    }
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(BASE + '/'); await page.waitForTimeout(3000);
  return { ctx, page };
}

async function openSettings(page) {
  await page.getByText('More', { exact: true }).last().click({ timeout: 8000 });
  await page.waitForTimeout(500);
  await page.getByText('Settings', { exact: true }).last().click({ timeout: 8000 });
  await page.waitForTimeout(800);
}

const browser = await chromium.launch();
const A = await phone(browser, 'phone A');
await openSettings(A.page);
const sel = A.page.getByLabel('Navigation app');
log('phone A card visible to non-admin:', await sel.isVisible());
log('phone A starts on:', await sel.inputValue());
await sel.selectOption('waze'); await A.page.waitForTimeout(1200);
log('phone A status:', await A.page.getByText(/^(Saved|Saving…|Could not save.*)$/).first().innerText().catch(() => '?'));
log('phone A cache:', await A.page.evaluate(() => localStorage.getItem('higrade_nav_app')));
await A.ctx.close();

const B = await phone(browser, 'phone B');            // a different phone, fresh sign-in
log('phone B cache after sign-in:', await B.page.evaluate(() => localStorage.getItem('higrade_nav_app')));
await openSettings(B.page);
log('phone B shows:', await B.page.getByLabel('Navigation app').inputValue());
await B.ctx.close(); await browser.close();
log(saves === 1 && server.user_metadata.nav_app === 'waze' ? 'PASS' : 'FAIL', JSON.stringify(server.user_metadata));

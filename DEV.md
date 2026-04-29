# Dev workflow — fast iteration

You have three ways to test changes, fastest to slowest.

## 1. Mac browser (fastest, no native shell)

```bash
npm run dev
```

Open http://localhost:5173 in Safari/Chrome on the Mac. Save a file →
auto-reloads. API calls `/api/...` are routed to Vercel automatically.

Doesn't catch native-only bugs (Capacitor plugins, iOS-specific
styling/safe-areas, deep links). Use this for ~95% of UI work.

## 2. Live reload to your iPhone (best for native testing)

Both your Mac and iPhone must be on the **same Wi-Fi**.

**One-time setup is already done** in `capacitor.config.dev.json`. If
your Mac's LAN IP changes (different network, router reboot), update
the `server.url` field there — currently `http://192.168.1.214:5173`.

**Each session:**

```bash
# Terminal 1 — start the dev server
npm run dev

# Terminal 2 — point the iOS app at the dev server and open Xcode
npm run ios:live
```

Then in Xcode click ▶. The app on your iPhone will load from the dev
server. Save a file in your editor → app refreshes on your phone in
~1 second.

When you're done with live-reload, switch the app back to a normal
bundled build:

```bash
npm run ios:live:reset    # rewrites the iOS project to use bundled dist/
npm run ios               # re-builds bundled and opens Xcode
```

If the app on your phone shows a connection error after closing the
Mac dev server, that's expected — re-run `npm run ios:live:reset` or
`npm run ios` to make it fully standalone again.

## 3. Vercel deploy + Safari on iPhone

Just `git push`, wait ~60 sec, refresh `https://higrade-invoicing.vercel.app`
in Safari on your iPhone. Slowest of the three but zero local setup.

---

## Troubleshooting live-reload

- **App on iPhone is white / "could not connect":** Mac dev server isn't
  running, or your iPhone is on a different Wi-Fi (e.g. cellular). Check
  Wi-Fi, then make sure `npm run dev` is running on the Mac.
- **IP address changed:** edit `server.url` in `capacitor.config.dev.json`,
  rerun `npm run ios:live`.
- **Mac firewall blocks port 5173:** System Settings → Network → Firewall →
  allow incoming connections for `node`.

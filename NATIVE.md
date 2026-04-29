# HI Grade Invoicing — Native (iOS + Android) Build Guide

This app is a Vite + React PWA wrapped in [Capacitor](https://capacitorjs.com)
so it can be installed as a native app on iPhone and Android **without going
through the App Store / Play Store**.

The web version is still deployed to Vercel as before. The native shells just
load the same UI from the bundled web build (`dist/`) and call the Vercel
serverless functions over the network for AI / email / signature endpoints.

---

## How API calls work in native builds

Native builds run from `capacitor://localhost` (iOS) or `https://localhost`
(Android), so relative `fetch("/api/...")` calls would fail. `src/apiBase.js`
detects native builds at runtime and rewrites those calls to:

```
https://higrade-invoicing.vercel.app/api/...
```

If you change your production URL, edit `PROD_API` in `src/apiBase.js`.

---

## Prerequisites

### Android
- [Android Studio](https://developer.android.com/studio) (Hedgehog or newer)
- JDK 17 (Android Studio bundles one)

### iOS (Mac only)
- Xcode 15+
- CocoaPods: `sudo gem install cocoapods`
- A free Apple ID (for personal sideloading) **or** a paid Apple Developer
  account ($99/yr) for stable signing and TestFlight

---

## Common workflow

After any change to the React app:

```bash
npm run sync         # builds web + copies into android/ + ios/
```

Then open the native project of your choice:

```bash
npm run android      # opens Android Studio
npm run ios          # opens Xcode (Mac only)
```

---

## Android — install on your phone (no Play Store)

### Option A — debug APK (fastest for personal use)

```bash
npm run android:apk
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

Email or AirDrop that file to your phone, tap it, allow installs from this
source, done.

### Option B — signed release APK (cleaner, no "debug" warning)

1. Generate a keystore once:
   ```bash
   keytool -genkey -v -keystore higrade-release.keystore \
     -alias higrade -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Add a `android/keystore.properties` (gitignored — see below):
   ```
   storeFile=../../higrade-release.keystore
   storePassword=YOUR_PASSWORD
   keyAlias=higrade
   keyPassword=YOUR_PASSWORD
   ```
3. In `android/app/build.gradle`, add a `signingConfigs.release` block that
   reads from `keystore.properties` (Android Studio can do this for you via
   Build → Generate Signed Bundle / APK).
4. `npm run android:release` → `android/app/build/outputs/apk/release/app-release.apk`

---

## iOS — install on your phone (no App Store)

### Option A — Xcode personal team (free, re-sign every 7 days)
1. `npm run ios` (opens Xcode)
2. Select the **App** target → **Signing & Capabilities**
3. Pick a **Team** (your free Apple ID works)
4. Plug in your iPhone, select it as the run destination, click ▶
5. On the phone: Settings → General → VPN & Device Management → trust the cert

The app stays installed forever, but the certificate expires after 7 days —
just plug in and click ▶ again to re-sign.

### Option B — Apple Developer Program ($99/yr) + Xcode
Same flow, but signed certs last 1 year. Best if you don't want to re-sign weekly.

### Option C — TestFlight (Apple Developer account required)
Best if you want your crew to install too. Up to 100 internal testers, builds
last 90 days. Run **Product → Archive** in Xcode, upload to App Store Connect,
add testers, they install via the TestFlight app. No public store listing.

### Option D — AltStore / Sideloadly (free, re-sign weekly)
Build an `.ipa` in Xcode, install via [AltStore](https://altstore.io) or
[Sideloadly](https://sideloadly.io). Same 7-day cert limit as Option A, but no
Mac required after the first build.

---

## Updating the app on your phone

After making code changes:

```bash
npm run sync
```

Then re-build in Xcode / Android Studio and install over the existing app.
Local data (Supabase already syncs, plus the localStorage fallback cache) is
preserved across reinstalls as long as the bundle ID stays the same.

---

## Bundle ID

Set in `capacitor.config.json`:

```
com.higradeplumbing.invoicing
```

Don't change this without coordinating — changing it invalidates installed
apps and breaks Apple/Google signing.

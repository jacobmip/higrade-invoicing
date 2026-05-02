# In-app push notifications — setup checklist

Three things have to be done before pushes will actually deliver to your
iPhone. The web app's bell icon already works without any of this — it
will show new payments / opens / signatures in real time whenever the
app is open.

## 1. Apply the Supabase migration

Open the Supabase SQL editor for project `cwhgcxxszyvevjpbnnkc` and paste
the contents of `supabase/migrations/011_notifications.sql`. Run it once.

This creates two tables: `device_tokens` and `notifications`, both with
RLS configured.

You also need to enable Realtime for the `notifications` table so the
bell-icon badge updates the moment a row lands:

- Database → Replication → tick `notifications` under the `supabase_realtime` publication.

## 2. Generate (or grab) an APNs auth key

If you already have a `.p8` from Apple Developer, skip to step 3.

Otherwise:

1. Sign in to [developer.apple.com](https://developer.apple.com/account/resources/authkeys/list).
2. Keys → "+" → name it "HI Grade APNs" → check **Apple Push Notifications service (APNs)** → Continue → Register.
3. Download the `.p8` file. **You can only download it once — store it safely.**
4. Note the **Key ID** (10 chars, shown on the same page) and your **Team ID** (top-right of the Apple Developer site, also 10 chars).
5. Make sure your bundle ID `com.higradeplumbing.invoicing` has the **Push Notifications** capability enabled under Identifiers → your app ID → Capabilities.

## 3. Add Vercel env vars

Project → Settings → Environment Variables (Production + Preview):

| Name | Value |
|---|---|
| `APNS_KEY_ID` | The 10-char Key ID from step 2 |
| `APNS_TEAM_ID` | Your Apple Developer Team ID |
| `APNS_BUNDLE_ID` | `com.higradeplumbing.invoicing` |
| `APNS_KEY_P8` | Paste the **entire** contents of the `.p8` file, including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines |
| `APNS_ENV` | `production` (or `sandbox` if you're testing with a sideloaded build that uses the dev APS environment) |

Note: `SUPABASE_SERVICE_ROLE_KEY` is already set from earlier work — no
changes needed.

Redeploy after adding the vars (or just push another commit).

## 4. Xcode capability

Open `ios/App/App.xcworkspace` in Xcode → select the `App` target →
Signing & Capabilities → "+ Capability" → add **Push Notifications**.
Also add **Background Modes** with **Remote notifications** ticked if
you want silent pushes to wake the app.

## 5. Sync Capacitor + build

```bash
cd ~/Documents/higrade-invoicing
npm install            # picks up @capacitor/push-notifications
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode: Product → Run on your iPhone. On first launch you'll see the
"Allow notifications" prompt. Tap Allow. The app will POST its APNs
token to `/api/register-device` automatically.

## 6. Test it end-to-end

The cheapest test: hit a public viewer link from a different device or
incognito browser. That fires `track-open` → inserts a notification row
→ pushes to your phone. You should see the bell badge increment on the
web app and a banner on your iPhone within a couple of seconds.

If it's silent on the phone, check Vercel function logs for
`/api/track-open` and `/api/_lib/notify` — the notify helper logs every
APNs failure with status code so you can spot config issues fast.

## Sandbox vs production gotcha

A sideloaded debug build registers with the **APNs sandbox** environment
(`api.sandbox.push.apple.com`), but TestFlight + App Store builds use
**production** (`api.push.apple.com`). The same JWT works for both, but
a token issued in one environment will not deliver from the other.

Quick rule:

- Sideloading from Xcode for testing → set `APNS_ENV=sandbox`.
- TestFlight or App Store → `APNS_ENV=production`.

If you switch, you'll need to delete the old row in `device_tokens`
(or just truncate the table) so the next launch re-registers.

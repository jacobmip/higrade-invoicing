# HI Grade Invoicing — Project Handoff

**Last updated:** May 1, 2026
**Owner:** Jacob "Jake" Petersen — jacobmip@gmail.com
**Purpose:** Drop this file into any AI chat (Claude, ChatGPT, Computer, Cursor, etc.) and the assistant will know exactly where this project stands, what tools to use, and how to continue working on it without re-asking questions. Keep this file in the repo root and update it whenever the architecture changes.

---

## 1. Owner / Operator

- **Name:** Jacob "Jake" Petersen
- **Email:** jacobmip@gmail.com
- **Business:** HI Grade Plumbing LLC, Honolulu HI
- **Hawaii GET tax rate:** 4.712% (default on every invoice)
- **Phone (business):** (808) 393-0015
- **Hardware:** Mac mini · Windows keyboard · Safari is primary browser · iPhone for testing the iOS build
- **Time zone:** Pacific/Honolulu (HST, UTC−10)

### Communication preferences
- Direct, concise. Skip filler.
- Always commit and push after every set of changes — don't pile up uncommitted work.
- Test before pushing only when changes are risky. Skip Playwright for trivial wiring; the user is conscious of credit usage.
- Do not share back test screenshots — wastes credits.
- Never use the words "scrape" / "scraping" / "crawl" / "crawling" — prefer "fetch" / "collect" / "browse".
- Avoid emojis unless explicitly asked.
- The user tolerates small discrepancies. Demands real testing only before high-risk commits.

---

## 2. Product Summary

HI Grade Invoicing is a single-operator invoicing + estimating + client-management web app for a plumbing business. It runs as:

- A **Vite + React 18** SPA hosted on **Vercel** at https://higrade-invoicing.vercel.app
- A **Capacitor**-wrapped iOS app (sideloaded on Jake's iPhone, planning a TestFlight/App Store release)
- A **Supabase** Postgres backend for the data layer
- **Vercel serverless functions** under `/api/*` for things the client can't do (PayPal capture, AI calls, email send, push notifications)

### Feature surface
- Invoices and estimates (separate id sequences `INV0000` / `EST0000`)
- Clients with addresses, primary contacts, full history
- Saved line items with auto-fill
- Calendar view (day/week/month) integrating with Google Calendar
- Public viewer pages (token-based) at `/v/<token>` so clients can pay/sign without an account
- PayPal Smart Buttons + Venmo + manual marking-paid with payment-method picker
- AI chat (uses the `/api/ai` endpoint) that can create invoices/estimates and add payments by voice/text
- Estimate e-signature flow with signature pad → PDF re-render → email confirmation
- iOS-style long-press quick-actions menu on every invoice and estimate row
- In-app notifications (bell icon) + APNs push for payments, invoice opens, signed estimates
- Receipt photo OCR → expense entries
- Daily Supabase backup → Google Drive (cron via Perplexity Computer)

---

## 3. Repo Layout

**GitHub:** https://github.com/jacobmip/higrade-invoicing
**Local clone:** `~/Documents/higrade-invoicing` on the Mac mini
**Default branch:** `main` — push directly, no PR workflow.

```
higrade-invoicing/
├── src/
│   ├── App.jsx            # Single-file React app, ~7,500 lines. Everything UI-side lives here.
│   ├── db.js              # Supabase data-layer helpers (loadAll, upsertInvoice, listNotifications, …)
│   ├── supabase.js        # Supabase client init (with localStorage fallback if env missing)
│   ├── apiBase.js         # Resolves "/api" vs absolute URL for Capacitor builds
│   ├── backup.js          # Settings → Backup tab logic
│   ├── contacts.js        # iOS native contacts integration
│   ├── googleCalendar.js  # Google Calendar OAuth + sync
│   ├── printablePdf.js    # PDF generation for invoices/estimates
│   └── main.jsx
├── api/                   # Vercel serverless functions (all Node runtime unless noted)
│   ├── _lib/notify.js     # APNs JWT + push fan-out + insertNotification
│   ├── ai.js              # AI chat → OpenAI proxy
│   ├── extract-receipt.js # Receipt OCR
│   ├── paypal-create-order.js
│   ├── paypal-capture-order.js
│   ├── paypal-webhook.js  # PAYMENT.CAPTURE.COMPLETED safety net
│   ├── register-device.js # APNs token upsert from the iOS app
│   ├── send-email.js      # Sends invoice email via Resend
│   ├── send-estimate.js   # Sends estimate email via Resend
│   ├── submit-signature.js # Notifies on estimate sign + email confirmation
│   └── track-open.js      # Logs invoice opens (was edge, now nodejs)
├── ios/App/                  # Capacitor iOS scaffold
│   ├── App.xcworkspace       # Open this in Xcode (NOT App.xcodeproj)
│   └── App/
│       ├── AppDelegate.swift # APNs registration + token POST to /api/register-device
│       ├── Info.plist
│       └── capacitor.config.json
├── supabase/migrations/    # Apply via Supabase SQL editor — there is no CI for migrations
├── public/
├── HANDOFF.md             # ← this file
├── PUSH_SETUP.md          # APNs / Apple Developer / Vercel env-var setup checklist
├── higrade_backup.py      # Daily backup script (downloads every Supabase row to JSON)
├── capacitor.config.json
├── package.json
└── vite.config.js
```

### File-size note
`src/App.jsx` is ~7,500 lines and intentionally monolithic. Don't refactor without explicit ask — the user prefers grep-able single-file code over splitting into many small files. Use `grep -n "function FooBar"` to locate components.

---

## 4. Live URLs / Endpoints

| What | URL |
|---|---|
| Production app | https://higrade-invoicing.vercel.app |
| GitHub repo | https://github.com/jacobmip/higrade-invoicing |
| Supabase project | https://cwhgcxxszyvevjpbnnkc.supabase.co |
| Public viewer pattern | `https://higrade-invoicing.vercel.app/v/<view_token>` |
| PayPal webhook | `https://higrade-invoicing.vercel.app/api/paypal-webhook` (subscribed to `PAYMENT.CAPTURE.COMPLETED`) |
| Device-token register endpoint | `https://higrade-invoicing.vercel.app/api/register-device` |

---

## 5. Backend Services & Identifiers

### Supabase
- **Project ref:** `cwhgcxxszyvevjpbnnkc`
- **Anon key (public, baked into bundle):** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3aGdjeHhzenl2ZXZqcGJubmtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODU4MTUsImV4cCI6MjA5Mjk2MTgxNX0.QrZ37rPNhDl5SjZnuPEFArLA3fdq2cyN2eGDPD6SYm8`
- **Service-role key:** stored in Vercel env as `SUPABASE_SERVICE_ROLE_KEY`. Never commit it. Used by `paypal-capture-order`, `paypal-webhook`, `register-device`, `notify.js`.
- **Migrations are applied manually** via the Supabase SQL editor. There is no `supabase db push` CI. When adding migration N+1, paste the file contents into the SQL editor and run it.

### Vercel
- **Project:** `jacobmips-projects/higrade-invoicing` (Hobby plan)
- **Auto-deploys** from `main` on every push. No preview env separate from prod for this project.
- **Env vars currently set:** `OPENAI_API_KEY`, `RESEND_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` (`live`), `PAYPAL_WEBHOOK_ID`, `SUPABASE_SERVICE_ROLE_KEY`. Push notifications need `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_P8`, `APNS_ENV` — see `PUSH_SETUP.md`.

### PayPal
- Live mode (not sandbox).
- Smart Buttons live on the public viewer (`/v/<token>`) when an invoice has an outstanding balance.
- `paypal-create-order` derives the balance + surcharge server-side so the client can't tamper with the amount.
- `paypal-capture-order` is the inline capture; `paypal-webhook` is the safety net. Both insert into `payments` and dedupe on `paypal_capture_id`. Both also fire an in-app notification + APNs push (deduped via the `deduped` flag from `recordPayment`).

### Resend (email)
- Sender: `HI Grade Plumbing <invoices@higradeplumbing.com>` — domain is verified.
- Used by `send-email`, `send-estimate`, `submit-signature`.
- The user wants to keep emails to a minimum going forward. New events should push, not email.

### OpenAI
- Used by `api/ai.js` for the global AI chat (model is gpt-4o-mini at the time of writing).
- Used by `api/extract-receipt.js` for receipt OCR.

### APNs (Apple Push Notifications service)
- Bundle ID: `com.higradeplumbing.invoicing`
- Production endpoint: `https://api.push.apple.com`
- Sandbox endpoint (sideloaded debug builds): `https://api.sandbox.push.apple.com`
- JWT signed with ES256 from the `.p8` auth key. Helper code lives in `api/_lib/notify.js` and caches the JWT for 50 min.
- Setup checklist in `PUSH_SETUP.md`.

### Google Calendar
- OAuth via the user's personal Google account. Tokens stored in `localStorage`. No server-side token storage.

### Supabase Auth (login gate — added May 2026)
- The web app at `https://higrade-invoicing.vercel.app` requires email + password sign-in. Single-tenant: only Jake's account exists.
- Implementation:
  - `LoginScreen` component in `App.jsx` (~line 6418) renders the navy-themed login form.
  - Auth gate in `App()` (~line 6494): `useEffect` calls `supabase.auth.getSession()` + subscribes to `onAuthStateChange`. While `session === undefined` it shows a splash; if `session === null` it shows `LoginScreen`; otherwise the app renders.
  - `db.loadAll()` is guarded by `if (!session) return` so no Supabase reads happen pre-auth.
  - Sign Out button lives in `SettingsTab` (~line 6383) — confirm dialog → `supabase.auth.signOut()`.
  - Sessions persist via Supabase JS client default (`localStorage`) so the user stays logged in across reloads.
- Public customer routes are NOT gated:
  - `/sign/<token>` (estimate signing) and `/v/<token>` (public invoice viewer) render before the auth check.
  - `/v/<token>` reads via the new `api/public-invoice.js` endpoint (service-role, scoped to the view_token) so it keeps working after the RLS lockdown.
- RLS lockdown is `supabase/migrations/012_auth_lockdown.sql`. It drops every anon policy on app tables (`invoices`, `invoice_items`, `payments`, `clients`, `saved_items`, `expenses`, `settings`, `invoice_versions`, `invoice_events`, `notifications`) and replaces them with `for all to authenticated using (true) with check (true)`. Server endpoints using the service-role key are unaffected.

#### To activate the lockdown (one-time manual steps in Supabase dashboard)
1. **Apply migration 012**: open the Supabase SQL editor for project `cwhgcxxszyvevjpbnnkc`, paste the contents of `supabase/migrations/012_auth_lockdown.sql`, run it. The trailing DO block prints a notice listing any anon policies still in place — should be empty.
2. **Create the user**: Authentication → Users → "Add user" → email `jacobmip@gmail.com` + a strong password. Mark email as confirmed.
3. **Disable signups**: Authentication → Providers → Email → turn OFF "Enable signups". Without this, anyone could register and gain full access (the RLS policies trust any authenticated user).

If the user ever forgets the password: Supabase dashboard → Authentication → Users → row menu → "Send password recovery" or set a new password directly.

---

## 6. Database Schema (Supabase)

All tables are in the `public` schema. RLS is enabled on most tables. The anon role can read/write the user's own data because this is single-tenant.

### Core tables
- **`invoices`** — id (text, e.g. `INV0123`), type (`invoice`|`estimate`), client_id, client_name, client_info (jsonb snapshot), date, due_date, status (`outstanding`|`paid`|`partial`|`net30`|`open`|`closed`|`approved`|`expired`), tax, discount, discount_type, notes, year, gcal_date, gcal_event_id, follow_up_date, follow_up_event_id, signature_data, signed_at, converted_to_id, view_token, job_address (jsonb), billing_address (jsonb), updated_at.
- **`invoice_items`** — invoice_id FK, name, desc, qty, price, sort_order.
- **`payments`** — invoice_id FK, amount, method (`Cash|Check|Venmo|Zelle|Credit Card|PayPal|Bank Transfer|Other`), date, note, paypal_order_id, paypal_capture_id (unique).
- **`clients`** — id, name, email, phone, addresses (jsonb array), notes, created_at.
- **`saved_items`** — id, name, desc, price (the user's item library).
- **`invoice_events`** — id, invoice_id, kind (`opened`|`sent`|…), recipient, meta (jsonb), created_at. Activity log.
- **`invoice_versions`** — id, invoice_id, snapshot (jsonb), sent_to, note, created_at. Versioned history of every send.
- **`settings`** — singleton-ish key/value store for app preferences.

### Notifications (added in migration `011_notifications.sql`, May 2026)
- **`device_tokens`** — id, token (unique), platform (`ios`|`android`|`web`), bundle_id, app_version, created_at, last_seen_at. RLS locks out anon — only service role writes.
- **`notifications`** — id, type (`payment`|`invoice_open`|`estimate_signed`|…), title, body, invoice_id (loose ref), data (jsonb), created_at, read_at. Anon can read + mark read; only service role inserts.

### Optimistic locking
`invoices.updated_at` is bumped server-side on every `upsertInvoice` and used as a version token to prevent stale-write races. The client passes its `updatedAt` and the RPC rejects if the row in the DB has moved on.

### Important indexes
- `device_tokens.token` UNIQUE
- `payments.paypal_capture_id` UNIQUE (dedupe key for PayPal flow)
- `invoices.view_token` UNIQUE
- `notifications(created_at desc)` and `notifications(read_at) WHERE read_at IS NULL`

### Realtime
The `notifications` table needs to be added to the `supabase_realtime` publication for the bell-icon badge to update live — done via Database → Replication in the Supabase dashboard.

---

## 7. iOS App (Capacitor + Xcode)

### Project location
- Xcode workspace: `~/Documents/higrade-invoicing/ios/App/App.xcworkspace` (always open the `.xcworkspace`, not the `.xcodeproj`).
- Bundle ID: `com.higradeplumbing.invoicing`
- Signed with Jake's personal Apple ID (jacobmip@gmail.com). For TestFlight/App Store, a paid Apple Developer account + Team ID are required.

### Native code touched
- `ios/App/App/AppDelegate.swift` — APNs registration. Requests `.alert + .sound + .badge`, calls `application.registerForRemoteNotifications()`, and POSTs the device token to `https://higrade-invoicing.vercel.app/api/register-device` on registration. Also forwards events to the `@capacitor/push-notifications` plugin via `NotificationCenter` posts.

### Required Xcode capabilities
- **Push Notifications** (must be added in Signing & Capabilities)
- **Background Modes → Remote notifications** (only if silent pushes are needed)

### Build / run
```bash
cd ~/Documents/higrade-invoicing
npm install                  # installs JS deps including @capacitor/push-notifications
npm run build                # bakes dist/ that Capacitor copies into the iOS shell
npx cap sync ios             # pushes JS + plugins into the Xcode project
npx cap open ios             # opens Xcode
# In Xcode: Product → Run on iPhone
```

### Capacitor config
- `capacitor.config.json` (committed) points to a production server.
- `capacitor.config.ts` exists too — check both if config seems off.
- Dev server URL `http://192.168.1.214:5173` is pinned in one of the config files for live-reload during local dev. Don't ship that to TestFlight.

---

## 8. Build / Deploy / Test Commands

```bash
# Install deps
npm install

# Local dev (Vite)
npm run dev                  # http://localhost:5173

# Production build
npm run build                # outputs to dist/

# Local preview of production build
npx vite preview --port 5173 --host 0.0.0.0 --strictPort

# Sync to iOS shell
npx cap sync ios

# Daily Supabase backup (used by the cron at 04:00 UTC)
python3 higrade_backup.py
```

---

## 9. Git Workflow & Conventions

- **Branch:** always `main`, push directly.
- **Commit message style:** imperative, sentence case, optionally with a multi-paragraph body for big changes. Examples:
  - `Open payment method picker when marking invoice paid from quick actions`
  - `Add iOS-style quick-actions menu on long-press of an invoice`
  - `Fix AI chat estimate creation using INV prefix instead of EST`
- **Always use a commit-message file** (`/tmp/commitmsg.txt` + `git commit -F`) — heredocs choke on em-dashes in commit messages.
- **`user.email`:** `jacobmip@gmail.com` · **`user.name`:** `Jacob Petersen`
- **Pre-push backup hook**: there is one. **Never modify or replace it.** It's the safety net that auto-backs up Supabase before every push.
- **Pre-commit hook**: there isn't one. **Don't create one.**

### Recent commit history (for context on how the project evolves)
```
0c5385e Add in-app push notifications: PayPal, invoice opens, estimate signs
c148559 Open payment method picker when marking invoice paid from quick actions
cd17fca Add quick-actions long-press menu to the Estimates tab
8b7bd37 Trim dead space below the Edit/Preview tabs on the invoice form
26f8bb5 Fix AI chat estimate creation using INV prefix instead of EST
ea5864f Add iOS-style quick-actions menu on long-press of an invoice
2975dd8 Add per-platform review request toggle to Settings
926befb Fix Venmo "something went wrong" after QR scan
9afab50 Fix PayPal API handlers for Vercel Node runtime
1bd8d87 Switch PayPal API endpoints from Edge to Node runtime
940f6a8 Enable Venmo as funding source on PayPal Smart Button
8177f35 Add PayPal Smart Button checkout and online payment surcharge
```

---

## 10. Architecture Patterns to Preserve

These are recurring decisions baked deep into the codebase. Don't undo them by accident.

### Single-file React app
Everything UI lives in `src/App.jsx`. New components are inserted in the same file at logical spots (e.g. tab components grouped together). Don't extract to new files unless asked.

### Numbering
**One shared sequence** for both types, as of migration 040. Every new document takes the next number from `nextDocNumRef` via `mintDocId(type)`; converting an estimate reuses its number rather than taking a new one, so EST1000 becomes INV1000. The number identifies the *job*, not the document — that is what makes it collision-proof, since a number is issued once and the invoice side can never land on one the estimate side already used. Invoice numbers are therefore not contiguous, which is an accepted trade-off.

Never mint from `nextNumRef` / `nextEstimateNumRef` — they are dead, kept only as a record of where the old sequences stopped. Never assign `nextDocNumRef` downwards; use `bumpDocNum()`, which only raises.

**The app is not the only minter.** `create_estimate_from_lead()` allocates a number in SQL when the AI receptionist files a lead, using `next_doc_num` and `bump_doc_num()` directly. See "Writers outside the app" below before changing anything about numbering.

Documents numbered below 1000 predate this and come from the old side-by-side sequences, where `INV0767` and `EST0767` are both real and unrelated. Conversion checks whether the paired id is free and falls back to a fresh number when it is not, so legacy pairs stay linked by the cross-link button instead of by matching numbers.

### Writers outside the app — the AI receptionist
`src/App.jsx` and `src/db.js` are **not** the only things that write to `invoices`. The AI receptionist ("Lisa") inserts rows through its own `SECURITY DEFINER` RPCs, called straight from Vapi and from serverless routes. They never load App.jsx, so no guard, ref or helper in the front end applies to them.

Anything that changes how documents are **numbered, identified, typed, or scheduled** has to be checked against these too:

| Function | Writes | Called by |
|---|---|---|
| `create_estimate_from_lead()` | inserts an `invoices` row + `invoice_items`, mints a document number | Vapi `createEstimate` tool, mid-call |
| `capture_abandoned_call()` | calls the above when a caller hangs up before Lisa files | `/api/vapi-call-ended` |
| `set_invoice_internal_notes()` | `internal_notes` | editor save path, and the abandoned-call capture |
| `set_invoice_gcal_event()` | `gcal_event_id` | the Google Apps Script webhook, calling back |
| `push_invoice_to_calendar()` | reads `gcal_date`, posts to the calendar webhook | trigger on `ai_lead` insert |
| `notify_owner_of_lead()` | inserts `notifications`, sends the lead email | trigger on `ai_lead` insert |

This has already caused two production breaks:

- **Migration 040** retired `next_estimate_num` and said nothing minted from it. `create_estimate_from_lead` still did. `INV0808` exists and 52 more legacy invoices sit between 808 and 999, so the next lead would have reissued a number already printed on a customer's invoice. Fixed in `041`.
- **Vapi's Composer AI** silently detached `createEstimate` and deleted the estimate workflow from the assistant prompt, taking the receptionist down for two live calls with no error anywhere.

Two rules that follow:

1. **Grep `supabase/migrations/` for the column you are changing before changing it.** The receptionist logic lives in SQL, not in JS, so a front-end search will not find it.
2. **Prefer a trigger to an app-side guard** when an invariant must hold. Migration `039` does this correctly — it catches every writer, including these RPCs and the SQL editor.

To inspect the live receptionist state without a phone call, `settings.vapi_private_key` lets SQL drive the Vapi API through the `http` extension. That is how the assistant's tools and prompt are read and edited.

### View tokens
Every invoice gets a random ~72-bit token in `view_token`. Anyone with the token can hit `/v/<token>` to view + pay + sign. Keep tokens unguessable and never expose them in logs or analytics.

### Optimistic locking
`db.upsertInvoice(inv, isNew)` reads `inv.updatedAt` and rejects on stale writes. Always pass the latest `updatedAt` you have from a fresh load.

### Quick-actions long-press menu
- `useLongPress` hook at `src/App.jsx:436` provides the press-and-hold trigger.
- `InvoiceQuickActionsMenu` at `src/App.jsx:~3071` is the bottom-sheet UI. It branches on `inv.type === 'estimate'` to swap "Mark paid" for "Convert to invoice" etc.
- Both `InvoiceList` and `EstimatesTab` have a `menuInv` state that controls the sheet.
- `InvoiceList` also has `payInv` state — when the user picks "Mark paid" on an unpaid invoice, that opens the existing `PaymentModal` (line ~685) so the method can be picked. Calls `onRecordPayment(updatedInvoice)` which calls `recordPayment` in App.

### Notifications fan-out
- Server-side events insert a row into `notifications` AND fire an APNs push. Wrapped in `notifyAll()` from `api/_lib/notify.js`.
- Notification rows persist; pushes are best-effort and don't block the response.
- The push helper no-ops if `APNS_KEY_P8` env is missing — so the bell icon works even before push is configured.
- Dedupe push via the `deduped` flag returned from `recordPayment` (otherwise PayPal inline capture + webhook would both notify for the same payment).

### Edge vs Node runtime
- All API endpoints are now `runtime: 'nodejs'`. Avoid Edge unless you're 100% sure the helper imports work — `api/_lib/notify.js` uses `node:crypto.createSign()` which Edge doesn't have.
- `submit-signature` and `track-open` were flipped from edge → nodejs in May 2026 to call `notifyAll()`.

### Long PayPal/payment paths
Two endpoints can record a PayPal payment: the inline capture (faster, runs while the buyer is still on the page) and the webhook (safety net for when the inline call's response gets lost). Both insert into `payments` deduped on `paypal_capture_id` and only fan out a notification when the row is actually new.

### Realtime subscription pattern
The bell uses `db.subscribeNotifications(onInsert)` which wraps a Supabase realtime channel. Always pair with `db.unsubscribeChannel(channel)` in a `useEffect` cleanup so we don't leak channels.

---

## 11. Operational Tasks & Cadence

### Daily Supabase backup
- **Cron:** Perplexity Computer scheduled cron at `0 4 * * *` UTC (cron id `0d900b36`).
- **Steps:**
  1. `python3 /home/user/workspace/higrade_backup.py` writes `higrade-backup-YYYY-MM-DD.json` with every row of every table (read via REST API + anon key).
  2. The cron reads the `BACKUP_FILE=...` line from stdout to find the path.
  3. Uploads the file to the user's Google Drive via the `google_drive` connector.
  4. On success: silent. On failure: send_notification with a clear error.

This is read-only. Never commits. Never modifies code.

### Manual Settings → Backup tab
The Settings tab has a Backup section (in `SettingsTab` at `App.jsx:~6121`) that lets the user manually export the same JSON. Restore is also implemented — it nukes every table and re-inserts from the JSON.

---

## 12. Known Constraints / Gotchas

- **Supabase anon key is hardcoded as a fallback** in `src/supabase.js` and `api/track-open.js`. This is intentional — it lets the app work even if Vercel env vars are missing. The key is public anyway (it's RLS-enforced).
- **`api/_lib/notify.js` requires Node runtime** for `node:crypto`. Never wrap an Edge endpoint around it.
- **Capacitor live-reload URL** is committed in one of the configs (`192.168.1.214:5173`). Production builds should use the `webDir: "dist"` flow without a `server.url`. Be careful not to ship a TestFlight build with the dev URL pinned.
- **GET tax = 4.712%** is the Hawaii General Excise Tax pass-through rate. Default on every invoice. Don't change it.
- **PayPal env**: `live` in production. Only flip to `sandbox` for explicit testing — and remember to set `APNS_ENV=sandbox` to match if testing pushes from a sideload.
- **Sideloaded iOS apps register to APNs sandbox**, TestFlight/App Store register to production. Switching means the device-token rows in `device_tokens` from the previous environment won't deliver and should be cleared.
- **`paypal-webhook` returns 200 even on errors** so PayPal doesn't infinite-retry. Failures are logged; investigate via Vercel function logs.

---

## 13. Naming, Styling, Brand

- **Primary navy:** `#0a1628` (constant `NAVY`)
- **Accent orange:** `#E8622A` (constant `ORANGE`)
- **Heading font:** `'Barlow Condensed', sans-serif`, all caps, letter-spaced
- **Body font:** system stack
- **Logo string:** "HI GRADE PLUMBING" + subhead "LLC · HONOLULU"
- **Method colors:** Cash green `#27ae60`, Check `#2980b9`, Venmo `#3D95CE`, Zelle `#6B39A8`, PayPal `#0070ba`, Credit Card `ORANGE`, Bank Transfer `#16a085`

---

## 14. Quick Reference: How to Resume Work

If you're an AI picking this up cold:

1. **Read this file end-to-end first.** Don't ask the user about anything covered here.
2. **Clone the repo:** `git clone https://github.com/jacobmip/higrade-invoicing.git`
3. **Install:** `npm install`
4. **Run locally:** `npm run dev`
5. **Find code:** start with `grep -n "function ComponentName" src/App.jsx`. The single-file structure is intentional.
6. **Database changes:** add a new migration file `supabase/migrations/NNN_*.sql`, then ask Jake to apply it via the Supabase SQL editor. There is no automated migration runner.
7. **API changes:** Vercel auto-deploys on push to `main`. No preview branches.
8. **Commit / push** after every set of changes. Use a commit-message file (`/tmp/commitmsg.txt`). Commit message style: imperative, sentence case.
9. **iOS changes:** open `ios/App/App.xcworkspace` in Xcode after running `npx cap sync ios`.
10. **Don't:** rewrite Capacitor as Expo or split `App.jsx` into many files without explicit ask. Don't add a pre-commit hook. Don't touch the pre-push backup hook.

### Useful greps
```bash
# Find a component
grep -n "function InvoiceList" src/App.jsx

# Find every place a method is called
grep -n "toggleInvoicePaid\|recordPayment" src/App.jsx

# Find Supabase queries
grep -n "supabase\.from" src/App.jsx src/db.js

# Find serverless endpoints
ls api/

# Find pending migrations
ls supabase/migrations/
```

---

## 15. Outstanding Work / Roadmap

(Update this section as features ship.)

### Recently shipped (May 2026)
- ✅ iOS-style quick-actions menu (long-press on invoices and estimates)
- ✅ Payment-method picker when marking paid from quick actions
- ✅ AI chat estimate-prefix bug fix (was creating `INV` instead of `EST`)
- ✅ Invoice form bottom-gap trim
- ✅ In-app notifications + APNs push for payments, invoice opens, estimate signs

### Pending setup (user must do)
- Apply migration `011_notifications.sql` in Supabase SQL editor
- Enable Realtime on `notifications` table (Database → Replication)
- Generate APNs `.p8` key from Apple Developer
- Add `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_P8`, `APNS_ENV` to Vercel env
- Add Push Notifications capability in Xcode → Signing & Capabilities
- (Optional) Background Modes → Remote notifications

### Possible future features
- Stripe / Square integration for credit-card payments (currently CC is a manual method)
- Multi-user / team support
- TestFlight + App Store submission pipeline
- PDF rendering improvements (currently uses `printablePdf.js` + html2canvas)
- Better mobile-keyboard handling on the AI chat input
- Per-platform review request automation (already started, see commit `2975dd8`)

---

## 16. Where Things Live in `App.jsx` (line numbers, ~May 2026)

These shift as the file grows — re-grep if exact lines look off.

| Symbol | Line |
|---|---|
| `useLongPress` hook | 436 |
| `Icon` component | 378 |
| `PaymentModal` | 685 |
| `GlobalAIModal` | 1199 |
| `InvoiceQuickActionsMenu` | ~3071 |
| `InvoiceListCard` | 3119 |
| `InvoiceList` | ~3179 |
| `EstimateListCard` | ~3157 |
| `EstimatesTab` | ~3368 |
| `NotificationsBell` | ~4262 |
| `PaymentsTab` | ~4383 |
| `PayPalCheckout` | ~4541 |
| `SettingsTab` | ~6121 |
| `subHeader` state hook | 6324 |
| `handleGlobalAIAction` (AI command dispatcher) | ~6577 |
| App-level invoice handlers (toggleInvoicePaid, recordPayment, duplicateInvoice, …) | ~6866–6920 |
| `convertInvoice` | ~6938 |
| Header render (with bell + AI buttons) | ~7264 |
| `<InvoiceList>` render with all props | ~7327 |

---

**End of handoff.** If anything important is missing, the assistant should add it here on the way out so the next pickup is easier.

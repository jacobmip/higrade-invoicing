# HI Grade Invoicing — Handoff for Claude Code

Read this file first. It captures everything an AI agent needs to safely continue work on this repo.

## Owner
- **Jacob "Jake" Petersen** — jacobmip@gmail.com
- HI Grade Plumbing LLC, Honolulu HI · GET tax 4.712%
- Mac mini + Windows keyboard + Safari; iPhone for live testing
- Jake's auth UUID: `0a3bcefd-6faf-4bae-b43b-cd4492dd9938`
- Test journeyman UUID: `fbf88c7c-ae9c-4601-af22-d0959d59a040` (test@higradeplumbing.com)

## Hard rules — do not break
1. **Always commit and push after a working set of changes.** Jake reviews on his phone immediately.
2. **Never touch the pre-push backup hook.** It exists to protect data.
3. **Never create a pre-commit hook.**
4. Git identity: `user.email "jacobmip@gmail.com"`, `user.name "Jacob Petersen"`.
5. Use a commit message file (`/tmp/commitmsg.txt` + `git commit -F`), not inline `-m` for multi-line messages.
6. **SQL migrations: paste the full SQL inline in chat for Jake to run in the Supabase SQL editor.** Do not assume any CLI access to Supabase.
   - **One query per code block.** Never put several statements in one box expecting Jake to run them separately — he copies a whole box at a time. If a step must run on its own, give it its own box.
   - **Always include the SQL editor link** with any query: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new
   - Remember the editor only returns the result of the **last** statement in a batch, so a multi-statement box silently hides the earlier results.
7. **Never use the words "scrape" / "scraping" / "crawl" / "crawling".** Use "extract" / "fetch" / "read".
8. **No emoji in chat or code output.** (The ⚠️ in the AI chat fallback is the only intentional one.)
9. Jake works mostly from his phone — keep replies short, no long diagnostic detours.
10. **Verify Jake is logged into the right account before destructive RLS / chat-history work.** Past bug: chat history got moved to the wrong account because we didn't check first.
11. **Before committing any changes to `src/App.jsx`, first copy it to `src/App.jsx.bak` and commit that backup as a separate commit with message "Backup App.jsx before [description of change]".** Push the backup commit before making any code changes. This gives Jake a one-command restore point: `cp src/App.jsx.bak src/App.jsx`.
12. **Push directly to `main` — no feature branches, no PRs, no merge step.** Vercel auto-deploys from `main`, and Jake prefers commits to land live without an extra merge. Only work on a separate branch if Jake explicitly asks in that session. (If a session is launched pinned to a development branch, that pin overrides this for that session, but it is not the default Jake wants.)
13. **Before every `git push origin main`, update `src/version.js` and `CHANGELOG.md`.**
    - Bump the version: patch (+0.0.1) for bug fixes / small changes, minor (+0.1.0) for new features, major (+1.0.0) for big architectural changes. Also update `APP_BUILD_DATE` to today's date (YYYY-MM-DD).
    - Prepend a new `## vX.Y.Z — YYYY-MM-DD` section to `CHANGELOG.md` describing every change in that push.
    - Commit both files in the same commit as the code change (not a separate commit).
14. **Update the docs in the same commit as the change.** `CLAUDE.md` is the
    single source of truth for the schema, migrations, document numbering, the
    invariants and the sharp edges; `HANDOFF.md` covers architecture patterns,
    the writers outside the app, and service/native setup. Nothing is documented
    in both — a fact in two places drifts into two different facts.
    A change to any of the following is not finished until the doc is updated
    alongside it: the database schema, a new migration, how documents are
    numbered or identified, an invariant or trigger, a new API endpoint or
    source file, or an AI model id. This rule exists because CLAUDE.md described
    the schema as of migration 018 for two months while the database went to
    041 — `version.js` and `CHANGELOG.md` stayed current the whole time because
    rule 13 forced them, and nothing forced this.

## Stack
- **Frontend**: Vite + React. `src/App.jsx` is ~10,300 lines and intentionally monolithic; a few later features live in their own files (see Source layout).
- **DB**: Supabase Postgres, project ref `cwhgcxxszyvevjpbnnkc`.
- **Auth**: Supabase Auth, email + password. Multi-user: `profiles.role` is `admin` or `plumber`.
- **Native**: Capacitor shells for iOS and Android (`ios/`, `android/`) — see `NATIVE.md` and `DEV.md`.
- **Telephony**: Vapi (AI receptionist, "Lisa") + Twilio SMS. Outbound SMS is gated off pending A2P 10DLC.
- **Hosting**: Vercel, project `jacobmips-projects/higrade-invoicing`. Auto-deploys on push to `main`.
- **Live**: https://higrade-invoicing.vercel.app
- **Test harness**: https://higrade-invoicing.vercel.app/estimator-test.html
- **Repo**: https://github.com/jacobmip/higrade-invoicing.git
- **Supabase SQL editor**: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new
- **Supabase Auth Users**: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/auth/users

## Source layout
```
src/
  App.jsx            — routing, all modals, AI chat, invoice form, client list (~10,300 lines)
  App.jsx.bak        — restore point, see hard rule 11
  db.js              — all Supabase reads/writes (~990 lines)
  printablePdf.js    — jsPDF invoice/estimate generator
  JobPhotos.jsx      — per-job photo gallery
  OnMyWay.jsx        — "on my way" customer notification
  PriceBook.jsx      — price book picker
  billTo.js          — bill-to / job-site address resolution
  backup.js          — manual backup export + restore
  contacts.js        — phone contact import (iOS)
  googleCalendar.js  — gcal sync helpers
  apiBase.js         — API base URL helper (rewrites /api for native builds)
  supabase.js        — Supabase client init
  version.js         — APP_VERSION + APP_BUILD_DATE, see hard rule 13
  main.jsx           — entry
api/                 — Vercel serverless functions, all nodejs runtime
  ai.js                    — per-invoice + global AI chat
  ai-estimator.js          — structured estimate generation
  ai-extract-client.js     — screenshot to client records (vision)
  extract-receipt.js       — receipt OCR to expense
  paypal-create-order.js / paypal-capture-order.js / paypal-webhook.js
  send-email.js / send-estimate.js / submit-signature.js / track-open.js
  public-invoice.js        — service-role read for /v/<token>
  register-device.js       — APNs token upsert
  vapi-call-ended.js       — Vapi end-of-call webhook
  sms-inbound.js           — Twilio inbound SMS webhook
  eta.js / geocode.js      — travel time + address lookup
  _lib/notify.js           — APNs JWT + push fan-out
  _lib/sms.js              — Twilio send helper
public/
  estimator-test.html — standalone test harness for AI estimator + extractor
supabase/migrations/ — numbered SQL, applied by hand in the SQL editor
local-mirror/        — optional local Postgres replica, see its README
```

### Where the other docs fit
Nothing below is duplicated in `CLAUDE.md`; see hard rule 14.

- **`HANDOFF.md`** — architecture patterns to preserve, the writers-outside-the-app
  table, optimistic locking, PayPal and notification flows, service credentials
  and setup, iOS/Capacitor, brand and styling. Also portable: it is written to be
  dropped into a tool that does not auto-load this file.
- **`CHANGELOG.md`** — the release log, one entry per version.
- **`NATIVE.md`**, **`DEV.md`**, **`PUSH_SETUP.md`** — native builds, local dev, APNs.
- **`local-mirror/README.md`** — optional local Postgres replica.

## Database schema (current through migration 041)
Most tables carry `owner_id uuid references auth.users(id)` with RLS scoped to
`owner_id = auth.uid() OR is_admin()`.

- `profiles` — id (FK auth.users), display_name, role ('admin'|'plumber'), created_at
- `clients` — name, email, email2, phone, address1/2/3, `addresses` jsonb (multi-property, each with its own admin notes), billing_address, notes
- `client_versions` — full client snapshots, mirrors invoice_versions
- `invoices` — id (`EST####`/`INV####`), type, client snapshot, job_address / billing_address jsonb, show_billing_address, status, tax, discount, converted_to_id, down_payment_pct, down_payment_invoice_id, view_token, internal_notes, source, late_fee_waived, gcal_date, gcal_event_id, gcal_duration_minutes, visits jsonb, deleted_at, updated_at
- `invoice_items` — invoice_id, name, description, qty, price, unit, discount, taxable, sort_order
- `invoice_versions` — snapshots for the History tab (`sent_at`, **not** `created_at`)
- `invoice_events` — audit trail (`sent`, `opened`, …) with `created_at`
- `payments` — invoice_id, amount, surcharge, method, date, note, paypal_order_id, paypal_capture_id (unique)
- `saved_items` — line-item library. Reads are shared (migration 043): every plumber sees admin-owned items plus their own. Writes stay owner-scoped, so only the owner can change an item. Unique on `(owner_id, name)`.
- `job_photos` — per-invoice photos
- `expenses` — receipt OCR output
- `notifications` / `device_tokens` — in-app bell + APNs
- `ai_chat_history` — user_id PK, messages jsonb (max 200); **RLS self-only, admins do NOT bypass**
- `settings` — key/value. Counters live here: `next_doc_num` is live, `next_num` and `next_estimate_num` are retired.

### Helper functions and RPCs
- `is_admin()` / `is_admin_uid(uid)` — SECURITY DEFINER; the second breaks RLS recursion in profiles policies
- `admin_owner_ids()` — SECURITY DEFINER, migration 043. Admin user ids, used by the shared price book policy. Reading `profiles` under RLS from another table's policy can silently return nothing, hence the definer.
- `set_owner_id()` — trigger, stamps owner_id on insert. **Returns NULL under the service-role key** (`auth.uid()` is null), which is how down-payment invoices ended up invisible — see migration 037.
- `save_invoice_with_items(...)` — the main upsert. Redefined by seven migrations; rebuild it from its live definition, never from an old file.
- `enforce_invoice_id_type()` — trigger, migration 039. An `EST` row is an estimate and an `INV` row is an invoice; blocks any write that would introduce a mismatch, grandfathers rows already mismatched.
- `bump_doc_num(n)` — advance-only shared counter, migration 040
- `sync_first_visit()` — trigger, migration 044. Mirrors the earliest entry of `invoices.visits` into `gcal_date` / `gcal_event_id` / `gcal_duration_minutes`. Runs only when `visits` is a non-empty array, so the AI receptionist writing `gcal_date` directly on a lead is left alone.
- `create_estimate_from_lead(...)` / `capture_abandoned_call(...)` — AI receptionist
- `set_invoice_internal_notes(...)`, `set_invoice_gcal_event(...)`, `push_invoice_to_calendar(...)`, `notify_owner_of_lead(...)`, `propagate_client_to_invoices(...)`, `lookup_client_by_phone(...)`, `log_client_message(...)`, `client_message_thread(...)`

**`src/App.jsx` and `src/db.js` are not the only writers to `invoices`.** The AI
receptionist inserts through SECURITY DEFINER RPCs called straight from Vapi and
from serverless routes, so no front-end guard applies to them and a JS-only grep
never finds them. This has already caused two production breaks. Before changing
anything about how documents are numbered, identified, typed or scheduled, read
**"Writers outside the app"** in `HANDOFF.md`.

## Document numbering (migration 040)
One shared sequence for both types, so a converted estimate keeps its number:
EST1000 becomes INV1000. The number identifies the **job**, not the document —
that is what makes it collision-proof, since a number is issued once. Invoice
numbers are therefore not contiguous, which was an accepted trade-off.

- Mint via `mintDocId(type)` in App.jsx, which draws from `nextDocNumRef`.
- Never mint from `nextNumRef` / `nextEstimateNumRef`. They are dead.
- Never assign `nextDocNumRef` downwards; use `bumpDocNum()`, which only raises.
- Documents below 1000 predate this. The old scheme ran two independent
  sequences, so `INV0767` and `EST0767` are both real and unrelated. Conversion
  checks whether the paired id is free and falls back to a fresh number when it
  is not; legacy pairs stay linked by the cross-link button instead.

## Migrations applied (in order)
- **001–016** — foundational schema, items, payments, saved items, versions, events, PayPal, notifications, auth lockdown, estimate down payments
- **017** — multi-user: profiles, owner_id, RLS scoping, admin role, View-as. **The file is not in the repo**; it was applied directly in the SQL editor. Reconstruct from the live schema if you need it.
- **018–022** — ai_chat_history, client_versions, estimate counter fix, propagate fix, address unit
- **023–036** — AI receptionist: lead capture, auto-pricing, appointments, SMS/email alerts, caller ID, calendar webhook, message log, abandoned-call capture, phone lookup
- **037** — backfill invoices orphaned by the missing `owner_id`
- **038** — calendar timezone fix
- **039** — id/type trigger
- **040** — shared document number
- **041** — put the AI receptionist on the shared counter
- **042** — `gcal_duration_minutes` on invoices, so a scheduled job's length survives without Google
- **043** — shared price book: `admin_owner_ids()` plus a widening SELECT policy on `saved_items`
- **044** — `visits` jsonb: a job can be scheduled across several appointments
- `20260515_job_photos.sql`, `20260515_price_book_seed.sql` — date-named, apply after the numbered set

Next migration is `045_<short_description>.sql`. Paste the SQL inline in chat per hard rule 6.

## AI features
All AI calls go to the Anthropic API via `api/*` (never OpenAI — the model ids
below are the source of truth, and `ANTHROPIC_API_KEY` is the only AI key set).

| Feature | Where | Model |
|---|---|---|
| Per-invoice chat (`AIChatPanel`) and global modal (`GlobalAIModal`) | `api/ai.js` | `claude-haiku-4-5-20251001` |
| AI estimator — job description + photos to a structured estimate | `api/ai-estimator.js` | `claude-sonnet-4-5-20250929` |
| Screenshot-to-client extractor (vision) | `api/ai-extract-client.js` | `claude-sonnet-4-5-20250929` |
| Receipt OCR to expense | `api/extract-receipt.js` | `claude-sonnet-4-6` |

### AI receptionist ("Lisa")
Answers the business line through **Vapi**, captures the lead, and files an
estimate mid-call via `create_estimate_from_lead()`. `/api/vapi-call-ended`
handles the end-of-call report; `capture_abandoned_call()` still files a lead if
the caller hangs up first. Inbound customer SMS lands at `/api/sms-inbound`.

**Outbound SMS is gated off** behind `settings.sms_outbound_enabled` pending A2P
10DLC registration. Turning it on before that clears produces silent failures
that look like success. Inbound (customer texts the business) is not blocked and
works today.

### Pricing model (Option B, locked)
For each line item: `max(materials × 0.35 markup factor, labor floor)`.
Labor floors: $185 minor / $400 standard / $800 major / quote-per-job multi-day.

### Travel zones
- Zone 1 in-town: +$0
- Zone 2 off-town: +$150
- Zone 3 far: +$300

### Photos
Unlimited, paperclip button, auto-resize to 1600px, available in **both** AIChatPanel and GlobalAIModal.

### Chat-history failure mode (recently fixed)
Earlier the model would reply "I've updated the description..." in plain text without emitting the `update_item` action JSON, so the change never happened. The fix:
1. System prompt explicitly maps "adjust / tweak / rewrite / modify / update / change / edit" of any line field to `update_item`, with a worked example of a description rewrite.
2. Hard rule in the prompt: never claim a change without emitting JSON.
3. Defensive guard in `AIChatPanel`: if the reply contains "I've updated/changed [the description/line/item/etc]" but no action JSON was extracted, auto-retry once forcing JSON output. If the retry also fails, surface a visible ⚠️ warning instead of silently lying.

If a similar "AI claims it did something but nothing happened" bug appears for a different action, follow the same pattern: tighten the prompt with examples, add a regex guard + retry.

## Connectors / external services
- **Vercel** — auto-deploy from main, project `jacobmips-projects/higrade-invoicing`
- **Supabase** — DB + auth + storage
- **Anthropic** — every AI feature (`ANTHROPIC_API_KEY`)
- **Resend** — invoice/estimate email from `invoices@higradeplumbing.com`
- **PayPal** — live mode, Smart Buttons + Venmo on the public viewer
- **Twilio** — SMS; inbound works, outbound gated pending A2P 10DLC
- **Vapi** — the AI receptionist's telephony
- **Google Calendar** — invoice → event sync, via a webhook
- **Google Drive** — daily backup destination
- **APNs** — iOS push, see `PUSH_SETUP.md`

Vercel env vars in use: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `PAYPAL_CLIENT_ID`,
`PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_WEBHOOK_SECRET`, `APNS_*`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_API_KEY`.

## Daily backup (recurring task in Perplexity Computer)
Cron `0d900b36`, runs `0 4 * * *` UTC:
1. Runs `python3 /home/user/workspace/higrade_backup.py` which dumps every row from every Supabase table to `higrade-backup-YYYY-MM-DD.json`.
2. Uploads the JSON to Jake's Google Drive via the connector.
3. Silent on success; sends a notification on failure.
This is read-only and runs outside Claude Code. Do not duplicate it in this repo.

## Locked UI specs
- Dark navy header, orange Done button.
- Estimate / invoice tabs: Edit · Preview · History · Photos.
- Quick-actions row above line items: Reorder · AI · Saved · Price Book · +.
- Both the quick-add and full client edit modals support `email2`.
- On a converted document the convert button becomes a cross-link showing the
  counterpart's number (`→ INV1000` / `← EST1000`).

## Queued bugs

Verified against the code on 2026-08-26. Anything listed as fixed was confirmed
by reading the source, not by trusting the changelog — six of the original eight
were already done and were sending agents chasing work that did not exist.

### Open

1. **iPhone customer-info text-selection drags the page** — needs checking on a
   real device before anyone writes code. `index.html` already sets
   `touch-action: pan-y` globally and the list cards set
   `userSelect/WebkitUserSelect/WebkitTouchCallout: none`, so some of this was
   addressed already. Reproduce it first and find which input still misbehaves.

### Known state, not bugs

- **`EST0767` is deliberately an invoice.** It carries `type = 'invoice'` with
  an estimate's number because of the form state-bleed bug fixed in v1.3.2, and
  Megill was emailed an invoice under that number before it was caught. Jake
  chose to leave it rather than confuse the customer with a correction. The
  migration 039 trigger grandfathers already-mismatched rows for exactly this
  reason, so it stays editable. **Do not "fix" it.**
- **Documents numbered below 1000 have no paired estimate/invoice numbers.**
  They predate the shared sequence (migration 040) and come from the old
  side-by-side counters, where `INV0767` and `EST0767` are both real and
  unrelated. Conversion falls back to a fresh number when the paired id is
  taken. Legacy pairs are linked by the cross-link button, which never depended
  on numbers matching.

### Blind spot worth knowing

The id/type guards (v1.3.2 app-side, migration 039 in the database) catch a
document whose number contradicts its type. They cannot catch the *other* shape
of state-bleed: if the wrong contents reach the form before the number is
minted, the id is assigned to match what it was handed, and the row looks
perfectly consistent while being the wrong document entirely. v1.3.5 closed the
paths that could cause this (type-scoped drafts, the epoch guard), but if a
document ever turns up with the right-looking number and someone else's
contents, this is the class to investigate — not the id/type rule.

### Fixed — do not re-open

- Secondary email rollout — `email2` is live in the quick-add modal, AI
  `create_client` / `update_client`, and auto-CC on send.
- Job site nickname on the printed PDF and on the on-screen invoice.
- Property selector — shows at `clientAddresses.length >= 1`, with inline
  "Add property".
- Notes on client and per-property — admin-gated, in `ClientEditFields`.
- Version history UI — the History tab, with snapshots and a manual snapshot
  button.
- Saved items sharing model — settled in migration 043. One price book, read by
  every plumber, editable only by its owner. The AI receptionist already priced
  every lead from the admin's book (`c_owner` is hardcoded in
  `create_estimate_from_lead`), so this made the app agree with the business.

The user explicitly chose to **keep `addresses` as JSON** rather than break it out into a separate `properties` table — the migration risk wasn't worth it for a system he runs his business on. Re-evaluate only if cross-property reporting becomes a real need.

## Recent work (2026-08-26)
Rather than a commit list that goes stale immediately, run `git log --oneline -20`.
The session that produced most of the current state did the following, in order:

- Cross-link button between an estimate and its invoice; fixed down-payment
  invoices created by `/api/paypal-capture-order` with a null `owner_id`, which
  RLS then hid entirely (migration 037 backfilled the existing ones)
- Fixed the form bug behind `EST0767`: a new document opened within the 300ms
  slide-out window reused the previous document's state *and* the id auto-save
  writes to, overwriting the old row and flipping its type
- Migration 039: moved the id/type invariant into a database trigger, since the
  app-side guards did not cover the serverless routes or the receptionist RPCs
- Migration 040: shared document numbering; 041 put the receptionist on it too

## Known sharp edges
- **App.jsx is ~10,300 lines.** Use grep, not full reads, to navigate.
- **The app is not the only writer to `invoices`.** See the schema section above and "Writers outside the app" in `HANDOFF.md`. Two production breaks have come from assuming otherwise.
- **Prefer a trigger to an app-side guard** when an invariant must hold. Migration 039 is the model: the front end cannot police writes it never sees.
- **`set_owner_id()` stamps null under the service-role key.** Any endpoint inserting with the service role must set `owner_id` explicitly or the row is invisible to everyone.
- **Two different systems create Google Calendar events.** The AI receptionist goes DB → webhook → Apps Script, which sets a title, the caller's notes as the description and the job address as the location, then calls `set_invoice_gcal_event()` back with the id. The app goes through `/api/gcal`, which acts with a server-side refresh token stored in `google_credentials` (`src/googleCalendar.js` is now just a thin client for that route, holding no Google credential of its own). When the app edits an appointment it must **PATCH** the existing event, never delete-and-recreate: recreating replaces everything the receptionist put there with the app's own template. Both sides build the event body to the same shape — title `Client - ID`, the job address as the location, contact details and internal notes in the body — so keep `eventFor()` in `ScheduleJobModal` and `push_invoice_to_calendar()` in step. The server function is create-only and skips any invoice that already has an event id, so it will never repair a visit the app failed to sync.
- **This project is at the Hobby plan's 12 Node Serverless Function cap.** Six routes in `api/` are `runtime: 'edge'` and do not count; the other twelve do. Adding a thirteenth Node route makes every deploy fail at `Deploying outputs...` **with no error line anywhere in the build log** — the build itself completes fine, so it reads like a platform glitch. This cost a full debugging session on 2026-09-02. Before adding a Node route, either make it `runtime: 'edge'` or fold it into an existing one, the way the OAuth callback lives inside `api/gcal.js` rather than its own file. Count with: `for f in api/*.js; do grep -L "runtime: 'edge'" $f; done | wc -l`
- **Both calendar writers must target the same calendar.** The app reads and writes `google_credentials.calendar_id` (default `primary`); the receptionist's Apps Script has its calendar hardcoded and writes to the shared **Work** calendar. If those disagree, everything still appears to work — events are created, no errors are raised — but the two-way reconciliation is comparing unrelated calendars, so it matches nothing and the app never sees a booking Lisa made. Check this before debugging a "reconciliation isn't working" report.
- **The Google OAuth consent screen must stay published to Production.** In "Testing" status Google expires refresh tokens after 7 days, which resurrects the disconnect bug on a weekly cycle instead of an hourly one. Same trap called out in the header of `033_calendar_webhook.sql`.
- **Only one calendar reconciliation may run at a time.** There are two callers — the startup sweep and the calendar's own fetch — and both fire on the same `gcalAuthed` change. Creating an event is the one step repeating cannot undo, so `runReconcile()` holds a lock, reads invoices from a ref rather than a closure, and claims a per-visit key *before* awaiting. Without all three, connecting Google mid-session created every unsynced event twice.
- **Calendar sync is two-way but not live.** `reconcileVisitsWithGoogle()` runs when the Calendar tab fetches events and once per session on app load (-30 to +90 days). Order matters: a visit marked `pending` never reached Google, so it is pushed rather than overwritten; a visit with no `eventId` is created, because `push_invoice_to_calendar()` is create-only and would skip the invoice; otherwise Google's times win, since that is where appointments actually get dragged around. A visit whose event was deleted in Google is left alone — absence from a range query is not proof of deletion.
- **A job can have several visits.** `invoices.visits` is the source of truth; `gcal_date` and friends are *derived* from the earliest one by a trigger and must never be written by hand once visits exist. They stay because `push_invoice_to_calendar()`, the webhook trigger and `create_estimate_from_lead` all read `gcal_date` — removing it would reach into the AI receptionist.
- **`internal_notes`, `gcal_duration_minutes` and `visits` do not round-trip through `save_invoice_with_items`.** All three are written separately in `db.js` after the main save, deliberately — the RPC never names them, so a full save cannot clobber any of them. Add a column the same way rather than rewriting that function.
- **`invoice_versions` uses `sent_at`, not `created_at`.** `invoice_events` uses `created_at`. Getting this wrong aborts the whole SQL batch.
- **`save_invoice_with_items` has been redefined by seven migrations** and may carry edits made directly in the SQL editor. Rebuild it from `pg_get_functiondef`, never from an old migration file — migration 041 shows the pattern, with asserted replacements.
- **Do not reset the invoice form when backing out to the list.** That path clears `selected` too, and resetting there blanks the form mid-animation; the unmount flush then saves an id-less form and `autoSaveInvoice` mints an empty document. Reset only on an explicit new-document request.
- **Document-level touch handlers must stand down inside modals and nested scrollers.** Pull-to-refresh and edge-swipe-back both `preventDefault()`, which cancels the scroll the finger was about to perform, not just the browser gesture. Pull-to-refresh originally only checked `window.scrollY`, and on a screen whose content fits the page never scrolls — so it claimed every downward drag and nothing with its own scrollbar could be scrolled back up. `touchInOverlay()` and `touchInScroller()` near the top of App.jsx are the guards; any new document-level gesture needs them too.
- **Never write an auto-grow textarea as an inline `ref={el => ...}` callback.** A new arrow function each render makes React reattach the ref every render, and setting `height = "auto"` to measure collapses the element and clamps the scroll position. Use a stable ref plus a layout effect.
- **iOS Safari `SpeechRecognition.start()`** throws synchronously. Always wrap in try/catch.
- **localStorage chat history is a warm cache only.** The authoritative copy is `ai_chat_history`. Don't reintroduce migration logic that "claims" a legacy key — that made chat jump accounts.
- **Profiles table RLS recursion**: any policy on `profiles` that queries `profiles` infinite-loops. Use `is_admin_uid(auth.uid())`.
- **`form.jobAddress` is an object, not a string.**

## Workflow tips for the next agent
- Build before pushing: `npm run build`. It will **not** catch a reference to a variable you deleted — esbuild does not scope-check, so grep for leftovers after a refactor. That exact gap shipped a crash in the AI bulk-create path.
- Jake's phone is the primary device. Test at mobile widths before declaring something fixed.
- Pushing to `main` auto-deploys. Don't run `vercel` manually.
- Jake must hard-reload on his phone to pick up a new build; the service worker caches.
- The AI chat system prompt is near the top of `App.jsx` — search for `update_item` (~line 410).
- If the AI claims it did something but nothing happened, add a regex guard + retry like the one around `extractActionsJSON` in `AIChatPanel`.
- Another session may be pushing to `main` at the same time. Fetch before you start and rebase if the push is rejected.

— end of handoff —

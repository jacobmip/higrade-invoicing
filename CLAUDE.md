# HI Grade Invoicing — Handoff for Claude Code

Read this file first. It captures everything an AI agent needs to safely continue work on this repo.

## Owner
- **Jacob "Jake" Petersen** — jacobmip@gmail.com
- HI Grade Plumbing LLC, Honolulu HI · GET tax 4.712% (0.5% for GE half tax clients) · GE license GE-187-330-7136-01
- Mac mini + Windows keyboard + Safari; iPhone for live testing
- Jake's auth UUID: `0a3bcefd-6faf-4bae-b43b-cd4492dd9938`
- Test journeyman UUID: `fbf88c7c-ae9c-4601-af22-d0959d59a040` (test@higradeplumbing.com)

## Hard rules — do not break
1. **Always commit and push after a working set of changes.** Jake reviews on his phone immediately.
2. **Never touch the pre-push backup hook.** It exists to protect data.
3. **Never create a pre-commit hook.**
4. Git identity: `user.email "jacobmip@gmail.com"`, `user.name "Jacob Petersen"`.
5. Use a commit message file (`/tmp/commitmsg.txt` + `git commit -F`), not inline `-m` for multi-line messages.
6. **SQL migrations: apply them yourself with `AI-OS/scripts/apply-migration.py`.** It drives the
   Supabase Management API, which is the only one of the three doors to this database that runs
   DDL. Jake does not paste SQL by hand. Working since 2026-10-20.
   - **Dry-run first.** Copy the file with its final `commit;` changed to `rollback;` and apply
     that. It compiles every statement against the real database and leaves nothing behind.
   - **Then verify by exercising the mechanism, not by reading your own migration back.** For an
     RLS change that means assuming the affected user's identity inside a rolled-back
     transaction: `set local role authenticated; set local request.jwt.claims =
     '{"sub":"<uuid>","role":"authenticated"}';` and attempting both what should work and what
     should be refused.
   - **An RLS-filtered UPDATE or DELETE affects zero rows instead of erroring.** A write the
     policy's USING clause excludes looks like a success to the caller. A WITH CHECK violation
     does raise. Plan for the silent case — it is how duplicate rows and phantom saves happen.
   - If Jake ever does need to run one by hand: **one query per code block**, because he copies a
     whole box at a time, always include https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new,
     and remember the editor only returns the result of the **last** statement in a batch.
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
    - **This is enforced by CI** (`.github/workflows/release-check.yml`): a push
      to `main` that touches `src/`, `api/` or `supabase/migrations/` without
      bumping `src/version.js` fails the check, as does a version with no
      matching `CHANGELOG.md` section. It does not block the deploy — Vercel
      builds the same push regardless — so a red check means go back and add
      the entry, never that the business is down. `src/App.jsx.bak` is exempt,
      since rule 11 pushes it on its own.
    - The check exists because this rule was missed for fifteen commits between
      2026-09-02 and 2026-09-07 — the server-side OAuth rewrite, migrations 045
      to 051 and the SMS compliance work all shipped while the app reported
      1.10.1. Rule 14 was followed across those same commits, so the sessions
      had read this file. The difference is that rule 14 binds to the work
      ("not finished until") while rule 13 was a ritual at the end of a
      session, and the ritual is what got dropped. A git hook would not have
      helped: every Claude Code web session starts from a fresh clone, so
      `.git/hooks` is empty where most of the work happens.
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
  ApprenticeJobView.jsx — the only job screen an `apprentice`-tier user (or View-as apprentice) gets: no money, no edit controls
  CallRecordings.jsx — Lisa's call recordings: list + player on the estimate (admin), and the `/?call=<id>` modal the Call record email opens
  Messages.jsx       — Messages tab, plus `ClientThread` reused in the client profile and the estimate/invoice Messages tab (admin only)
  PriceBook.jsx      — price book picker
  WelcomePage.jsx    — `/welcome` invite onboarding (public route) and the Pending-setup screen (migrations 082-083)
  billTo.js          — bill-to / job-site address resolution
  competencies.js    — apprentice skill catalog + graduation math (migration 054)
  geTax.js           — GE license number, 0.5% GE half tax rate, isGeHalfTax() (migration 059)
  paymentMethods.js  — the eight payment method spellings, canonicalMethod(), one colour/glyph table (migration 061)
  backup.js          — manual backup export + restore
  aiAgent.js         — app-wide AI chat agent: tool loop + every tool executor
  contacts.js        — phone contact import (iOS)
  googleCalendar.js  — gcal sync helpers
  apiBase.js         — API base URL helper (rewrites /api for native builds)
  supabase.js        — Supabase client init
  version.js         — APP_VERSION + APP_BUILD_DATE, see hard rule 13
  main.jsx           — entry
api/                 — Vercel functions. **Hard limit: 12 nodejs routes — see below.**
  ai.js                    — per-invoice AI chat; `mode: 'agent'` relays one turn of the global chat agent
  ai-estimator.js          — structured estimate generation, AND the client extractor via `{ task: 'extract_client' }`
  extract-receipt.js       — receipt OCR to expense
  paypal-create-order.js / paypal-capture-order.js / paypal-webhook.js
  send-email.js / send-estimate.js / submit-signature.js / track-open.js
  public-invoice.js        — service-role read for /v/<token>
  register-device.js       — APNs token upsert
  vapi-call-ended.js       — Vapi end-of-call webhook + call record email; also `GET ?recording=<callId>` (admin session) for a call's recording link
  sms-inbound.js           — Twilio inbound SMS webhook; also the Messages tab reply box (POST with an admin Bearer token and no Twilio signature sends and logs one text)
  gcal.js                  — Google Calendar: server-side OAuth, callback, read/write, and attendee ops (`attendee`, `tech_email`) that invite the commission apprentice to a job's event (v1.27.5)
  eta.js / geocode.js      — travel time + address lookup
  _lib/notify.js           — APNs JWT + push fan-out
  _lib/sms.js              — Twilio send helper
  _lib/gcal.js             — Google token refresh + calendar helpers
  _lib/agent-tools.js      — global chat agent: model id, system prompt, tool schemas
  _lib/extract-client.js   — screenshot to client records (vision). A helper, not a route, to stay under the function cap
  _lib/call-recording.js   — links each Vapi call to its estimate (`vapi_calls`) and fetches a short-lived recording link from Vapi. A helper, dispatched from `vapi-call-ended.js`
public/
  estimator-test.html — standalone test harness for AI estimator + extractor
supabase/migrations/ — numbered SQL, applied by hand in the SQL editor
local-mirror/        — optional local Postgres replica, see its README
```

### The 12-function ceiling — read before adding anything to `api/`

Vercel's **Hobby plan allows 12 nodejs functions per deployment**, and this project sits at
**exactly 12**. Add a thirteenth and *every deploy fails*, with a failure mode that wastes
days: the build still succeeds, so `vite build` passes locally and in CI, the release check
goes green, and the only symptom is `status ● Error` at "Deploying outputs…" **with no error
message anywhere in the build log.** That is precisely what happened when
`api/schedule-request.js` landed on 2026-10-18: the site silently served a five-day-old
build until 2026-10-24, and the `/schedule` page it added never went live at all.

Count with:
```bash
for f in api/*.js; do grep -q "runtime: 'edge'" "$f" || echo "$f"; done | grep -v '^api/_' | wc -l
```

Three ways to add a route without breaking the deploy:
- **`runtime: 'edge'`** — edge functions do not count against the 12. Six already are
  (`ai.js`, `eta.js`, `extract-receipt.js`, `geocode.js`, `send-email.js`,
  `send-estimate.js`). Only works without node builtins (no `node:crypto`, no APNs signing).
- **Put it in `api/_lib/`** and dispatch from an existing route on a `task` field. This is
  how the client extractor works; its only caller was the test harness, so it never needed a
  public URL.
- **Upgrade to Pro (~$20/month)**, which removes the cap and raises the 10s function
  ceiling. Note `ai-estimator.js` asks for `maxDuration: 90` and has silently been getting
  **10s** all along, because Hobby clamps it.

### Where the other docs fit
Nothing below is duplicated in `CLAUDE.md`; see hard rule 14.

- **`HANDOFF.md`** — architecture patterns to preserve, the writers-outside-the-app
  table, optimistic locking, PayPal and notification flows, service credentials
  and setup, iOS/Capacitor, brand and styling. Also portable: it is written to be
  dropped into a tool that does not auto-load this file.
- **`CHANGELOG.md`** — the release log, one entry per version.
- **`NATIVE.md`**, **`DEV.md`**, **`PUSH_SETUP.md`** — native builds, local dev, APNs.
- **`local-mirror/README.md`** — optional local Postgres replica.

## Database schema (current through migration 075; migration 074 was a concurrent session's — see its own commit)
Most tables carry `owner_id uuid references auth.users(id)` with RLS scoped to
`owner_id = auth.uid() OR is_admin()`.

**The assigned tech is the second way in (migrations 053 and 069).** `invoices` SELECT allows
`assigned_tech_id = auth.uid()`, and since 069 so does UPDATE — but not DELETE, and the WITH
CHECK pins `assigned_tech_id = auth.uid() and deleted_at is null`, so an assigned tech cannot
trash a job, restore one, reassign it, or unassign himself.

**A job's parts are reached through the job, never through `owner_id`.** `invoice_items`,
`payments`, `invoice_versions`, `invoice_events` and `job_photos` are keyed on the parent
invoice via `is_my_assigned_job()`; `clients` and `client_versions` via
`is_my_assigned_client()`. `owner_id` on a child row is stamped by a trigger to whoever
inserted it, which makes it useless as an access key as soon as two people touch one job —
that is exactly what 069 fixed, and why 053 alone left an apprentice looking at a $0 job with
no line items and no phone number.

**Read access without write access is a bug, not a safe middle ground.**
`save_invoice_with_items` DELETEs and re-INSERTs the whole item and payment set on every save.
Grant SELECT on payments without DELETE and the caller reads them, sends them back, deletes
none (RLS filters it silently) and inserts copies — a duplicate payment row per save.

- `profiles` — id (FK auth.users), display_name, role ('admin'|'plumber'), tier ('pending'|'apprentice'|'service_tech'|'journeyman'|'admin'), created_at
  - **Employee tiers and what each is meant to do: see "Employee tiers" below.**
  - **`tier` is not `role`.** `role` drives `is_admin()` and therefore every RLS policy; `tier` (migration 054) is pay band and which Reports scorecard the person gets, and touches no policy. Never fold one into the other.
- `tech_competencies` — tech_id, skill_key, level 0–4, note, updated_at, updated_by, plus **self_level, self_note, self_updated_at (migration 071)**. `level` is the owner's sign-off and the only input to the graduation gate. `self_level` is the tech's own claim, writable only on his own rows, enforced by a BEFORE trigger (`guard_competency_signoff`) rather than RLS or a grant — RLS cannot restrict which columns an UPDATE touches, and a column grant would be per-role, which here is the same `authenticated` role as the owner. `skill_key` matches a `key` in `src/competencies.js` — the catalog is code, not a table, so it is versioned. A stored row whose skill has been removed from the catalog is orphaned and ignored, never deleted.
- `time_entries` — one clock-in/clock-out per person per visit (migration 072). `tech_id`, `invoice_id` (nullable — shop/drive/supply time has no job), `kind`, both clock timestamps, both raw lat/lng + accuracy, and **clock_in_m/clock_out_m/clock_in_on_site/clock_out_on_site/minutes — all computed by `tg_time_entry_compute()`, never accepted from the client.** A partial unique index on `(tech_id) where clock_out_at is null` caps one open shift per person. A non-admin may close his own open shift and nothing else: not reopen a closed one, not move its start, not touch anyone else's row. Self-or-admin read/write by RLS; delete is admin-only. `tg_time_entry_offsite_alert()` (migration 073) texts `settings.notify_to` via `send_owner_sms()` the moment either end of a shift computes off-site — verified delivering for real on 2026-10-26.
- `tech_pay` — tech_id (PK), hourly_rate, commission_pct (migration 075). Self-or-admin read, admin-only write — not on `profiles`, because `profiles_read` is deliberately `using (true)` and a pay rate stored there would be readable by any logged-in account.
- `invoices.commission_tech_id` / `invoices.material_cost` (migration 075) — who earns commission on this job (`NULL` = hourly only) and the parts cost, set by the owner alone. **Not a rule the database infers**: Jake's own three-part test (solo / he sold it / he collected it) is a judgment call he makes per job, not three tracked signals. "Collected it" is enforced by gating commission on `status = 'paid'`, not a column. A trigger (`guard_invoice_commission`) pins both fields against any non-admin, including during an otherwise-ordinary save of a job assigned to him.
- `clients` — name, email, email2, phone, address1/2/3, `addresses` jsonb (multi-property, each with its own admin notes), billing_address, notes, ge_half_tax (migration 059)
  - **GE half tax has no invoice column.** A client with `ge_half_tax` is a GC we sub for: picking them sets a new document's tax to 0.5%. An invoice is GE half tax exactly when `tax = 0.5` (`isGeHalfTax()` in `src/geTax.js`), and that alone decides whether the preview, customer link and PDF print the GE license number. The per-invoice toggle just flips the rate.
- `client_versions` — full client snapshots, mirrors invoice_versions
- `invoices` — id (`EST####`/`INV####`), type, client snapshot, job_address / billing_address jsonb, show_billing_address, status, tax, discount, converted_to_id, down_payment_pct, down_payment_invoice_id, view_token, internal_notes, source, late_fee_waived, gcal_date, gcal_event_id, gcal_duration_minutes, visits jsonb, assigned_tech_id, deleted_at, updated_at
  - **`owner_id` is not `assigned_tech_id`.** `owner_id` is whoever created the row; `assigned_tech_id` (migration 053) is who *ran* the job. Anything that pays or scores a tech must use `assigned_tech_id`. **Migration 069 stopped the restamping:** the `on conflict` branch used to set `owner_id = excluded.owner_id`, handing the document to whoever saved it last, which was survivable only while the owner was the sole writer. It is now `coalesce(public.invoices.owner_id, excluded.owner_id)`. Deliberate transfer goes through `claimInvoiceOwner()`.
- `invoice_items` — invoice_id, name, description, qty, price, unit, discount, taxable, sort_order
- `invoice_versions` — snapshots for the History tab (`sent_at`, **not** `created_at`)
- `invoice_events` — audit trail (`sent`, `opened`, …) with `created_at`
- `payments` — invoice_id, amount, surcharge, method, date, note, paypal_order_id, paypal_capture_id (unique)
- `saved_items` — line-item library. Reads are shared (migration 043): every plumber sees admin-owned items plus their own. Writes stay owner-scoped, so only the owner can change an item. Unique on `(owner_id, name)`.
- `client_messages` — id, client_id (nullable: rows logged before the client existed), owner_id, phone_number, direction (`inbound`|`outbound`), body, related_call_id (overloaded: Twilio SID, Vapi call id or null), media jsonb `[{url,type}]`, created_at, **read_at (migration 088; null on an inbound row = unread)**. RLS owner-or-admin. Written only through `log_client_message()`. The app matches a row to a client by `client_id`, else last 10 phone digits (`src/Messages.jsx`).
- `job_photos` — per-invoice photos
- `expenses` — receipt OCR output
- `notifications` / `device_tokens` — in-app bell + APNs
- `ai_chat_history` — user_id PK, messages jsonb (max 200); **RLS self-only, admins do NOT bypass**
- `settings` — key/value. Counters live here: `next_doc_num` is live, `next_num` and `next_estimate_num` are retired. `invoice_followup_live` (migration 055) gates every customer reminder the follow-up script sends; anything but `'true'` means preview only.
  - **Not readable by everyone any more (migration 070).** It used to be one policy, `for all using (true)`, so any account that could log in could read and write the Twilio and Vapi credentials, the webhook secrets, the kill switches and the alert destinations. `is_privileged_setting(key)` is the deny-list; admins read everything, a tech reads the rest. Writes are admin-only **except the three counter keys**, which `save_invoice_with_items` (SECURITY INVOKER) upserts at the end of every new-document save — without that carve-out a non-admin cannot create any document at all.
  - Add a new secret to `is_privileged_setting()`. Ordinary business config needs no migration; it is readable by default on purpose.
- `invoice_reminders` — invoice_id, tier (1/7/14/30), days_overdue, channel ('sms'|'email'), status ('sent'|'failed'), recipient, amount_due, message, provider_id, error, sent_at. Migration 055. Written only by `scripts/invoice_followup.py` in the AI-OS repo under the service role; admins read. A partial unique index on `(invoice_id, tier) where status = 'sent'` is the duplicate guard.
- `vapi_calls` — call_id (Vapi uuid, PK), invoice_id, phone, seconds, created_at. Migration 067. One row per Lisa call, written by `/api/vapi-call-ended` under the service role, admin-read only. No FK to invoices on purpose. **Holds no audio:** recordings stay in Vapi's private storage and are fetched on demand via `GET https://api.vapi.ai/call/{id}/mono-recording` (private key, `settings.vapi_private_key` or `VAPI_PRIVATE_KEY`), whose 302 `Location` is a short-lived signed URL the app plays directly. Read the redirect, never follow it with the Bearer header attached. Calls before 2026-10-27 are linked only where an abandoned-call note carried the id.
- `google_credentials` — the app's server-side Google OAuth refresh token, plus `calendar_id` (the write target, must match the receptionist's Apps Script) and `read_calendar_ids` (every calendar the Calendar tab displays). Migration 045/046.

### Helper functions and RPCs
- `is_admin()` / `is_admin_uid(uid)` — SECURITY DEFINER; the second breaks RLS recursion in profiles policies
- `is_my_assigned_job(invoice_id text)` / `is_my_assigned_client(client_id uuid)` — SECURITY DEFINER, STABLE, migration 069. The access key for every child row of an invoice. Definer on purpose: a policy on `invoice_items` that queried `invoices` directly would re-enter the invoices policies per row. Both answer one yes/no question about the caller's own assignments and leak nothing about anyone else's work.
- `is_privileged_setting(key text)` — IMMUTABLE, migration 070. The `settings` read deny-list.
- `admin_owner_ids()` — SECURITY DEFINER, migration 043. Admin user ids, used by the shared price book policy. Reading `profiles` under RLS from another table's policy can silently return nothing, hence the definer.
- `set_owner_id()` — trigger, stamps owner_id on insert. **Returns NULL under the service-role key** (`auth.uid()` is null), which is how down-payment invoices ended up invisible — see migration 037.
- `save_invoice_with_items(...)` — the main upsert. Redefined by seven migrations; rebuild it from its live definition, never from an old file.
- `default_assigned_tech()` — trigger, migration 058. A new invoice row with no `assigned_tech_id` gets its `owner_id`, so every document starts assigned to whoever created it (Jake for his own and for Lisa's leads, a plumber for theirs).
- `enforce_invoice_id_type()` — trigger, migration 039. An `EST` row is an estimate and an `INV` row is an invoice; blocks any write that would introduce a mismatch, grandfathers rows already mismatched.
- `bump_doc_num(n)` — advance-only shared counter, migration 040
- `canonical_payment_method(text)` + `payments_canonical_method()` — function and BEFORE INSERT OR UPDATE trigger on `payments`, migrations 061 and 064, **both applied and verified 2026-10-20** (trigger present in `pg_trigger`; folding proven on 28 inputs that match `canonicalMethod()` exactly; trigger proven to fire by an `update` inside a rolled-back transaction). Folds a method spelling to one of the eight canonical labels and **leaves an unrecognised value alone**. Mirrors `canonicalMethod()` in `src/paymentMethods.js`; change the two together. A trigger and not a check constraint on purpose, so restoring an old backup cannot fail hard on a label nobody anticipated. Never use `initcap()` here — it turns `PAYPAL` into `Paypal`.
- `visits[]` entries are `{ id, start, minutes, label, kind, eventId, builtBy, pending? }`. `kind` is `job` / `estimate` / `emergency` and drives the Google event colour; absent, it falls back to the document type, so nothing needed backfilling when it was added. `builtBy: "app"` marks an event this app created — only those get their description and location patched on a reschedule, so a booking from Lisa keeps the caller's own words. Both live in the jsonb, so neither cost a migration.
- `sync_first_visit()` — trigger, migration 044. Mirrors the earliest entry of `invoices.visits` into `gcal_date` / `gcal_event_id` / `gcal_duration_minutes`. Runs only when `visits` is a non-empty array, so the AI receptionist writing `gcal_date` directly on a lead is left alone.
- `create_estimate_from_lead(...)` / `capture_abandoned_call(...)` — AI receptionist. Since migration 065 a booked appointment is written as a one-entry `visits` array in the same INSERT (kind `estimate`, no `builtBy`, `eventId` null until `set_invoice_gcal_event()` fills it), and since 066 numbers come from `allocate_doc_number()`.
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
- **045–046** — server-side Google OAuth (`google_credentials`), and the shared Work calendar as the single write target
- **047** — the calendar callback writes into `visits` instead of `gcal_event_id`, which the `sync_first_visit` trigger was overwriting
- **048** — stop `save_invoice_with_items` restamping `gcal_date` as UTC
- **049–050** — lead timestamps in Hawaii time, and a backfill of the ten rows already written wrong
- **051** — inbound SMS media and alerts
- **052** — `push_invoice_to_calendar()` rewritten to match `buildCalendarEvent()` in `src/App.jsx`: title `Work · Client · Document`, the whole job site in the location field, line-item names as a SCOPE block, the document's real type instead of a hardcoded "Estimate", and a `colorId` in the webhook payload
- **053** — `assigned_tech_id` on invoices for the per-tech KPI scorecard: the column, a backfill from `owner_id`, a partial index, `save_invoice_with_items` taught to carry it, and `invoices_select` widened so a tech can see the jobs assigned to them. The update branch treats an absent or null key as "leave the assignment alone" and the literal string `'none'` as "clear it", so the AI receptionist's RPCs — which know nothing about the column — cannot blank out an assignment.
- **054** — apprentice competencies: `profiles.tier`, the `tech_competencies` table and its RLS. Pairs with `src/competencies.js`.
- **055** — `invoice_reminders` and the `invoice_followup_live` setting, for the daily overdue-invoice reminder script in the AI-OS repo
- **056** — declined estimates: `invoices.declined_at` / `declined_reason`, `set_estimate_declined()`, and the `estimate_valid_days` setting (30)
- **057** — the `bot_outbound_send_enabled` setting, the gate on the AI-OS bot sending a customer follow-up
- **058** — `default_assigned_tech()`, a BEFORE INSERT trigger (`zz_invoices_default_assigned_tech`, named to fire last) that fills a null `assigned_tech_id` from `owner_id`. Covers the writers that bypass `save_invoice_with_items`: the receptionist's RPCs, the PayPal down-payment insert, and converting an unassigned estimate. Insert only, so a job deliberately set to Unassigned stays that way.
- **059** — `clients.ge_half_tax`: per-client GE half tax (0.5%) default, see `src/geTax.js`
- **059 (second file)** — `059_save_invoice_internal_notes.sql`: `save_invoice_with_items` no longer drops `internal_notes`. **There are two 059 files.** `059_client_ge_half_tax.sql` sorts first and does not touch the function, so the order is harmless, but any tool that assumes one file per number will mis-order them. Do not renumber either — both are committed and applied.
- **060** — `allocate_doc_number()`: document numbers handed out by the database under a row lock, instead of computed in the browser from the snapshot loaded at app start
- **061** — **applied and verified 2026-10-20.** `canonical_payment_method()` and the `trg_payments_canonical_method` trigger on `payments`, so one payment method has one spelling no matter which writer stored it. Pairs with `src/paymentMethods.js`, which normalizes every read and write inside the app — the app was already correct without the trigger; this closes the writers that bypass it (the Telegram manager, ad-hoc REST or psql, a restore that skips `backup.js`). Its repair `update` touched 0 rows, as expected on a database repaired on 2026-10-16.
- **062** — `invoices.lead_channel`: where a lead came from, as a column you can group by, so marketing can be judged on revenue rather than lead counts. Deliberately does **not** reuse `invoices.source`, because `trg_notify_owner_of_lead` (026) and `trg_push_lead_appointment` (033) both key off `source = 'ai_lead'`.
- **063** — two bugs found by actually inserting a lead row: `create_estimate_from_lead` never set `owner_id`, so under anon/service_role auth (`auth.uid()` null) the estimate landed with a null owner, failed the `invoices_select` policy, and was invisible to Jake in his own app while still emailing him. Also fixes the lead appointment being stamped in the wrong zone.
- **064** — **applied and verified 2026-10-20.** Corrects one divergence in 061: `canonical_payment_method('   ')` returned `'   '` where the JS returns `''`, because 061 detected the blank and then handed back its argument instead of the trimmed value. A method of three spaces is worse than an empty one — it is falsy in neither language, so it survives `<> ''` guards while displaying as nothing. Parity is now exact on 28 inputs; `null` still returns `null`, which is deliberate and not a divergence.
- `20260515_job_photos.sql`, `20260515_price_book_seed.sql` — date-named, apply after the numbered set

- **065** — **applied 2026-10-27; visits and Hawaii time verified live, numbering was NOT** — its exact-text match on the numbering block missed the live definition (likely whitespace) and skipped it. 066 does that part. `create_estimate_from_lead` writes `visits` when Lisa books, so her jobs are visible to the calendar sync, the manager bot and the chat agent. Patches the live definition (041 pattern) because **062 and 063 were written from an old copy of the function** and, if that copy is live, undid 049 (Hawaii time) and the shared counter; 065 restores both, each only if the old text is present. Tested on a local Postgres 16 against the 063 text, a variant with 049 already applied, and a mismatched variant (aborts, nothing changed).

- **066** — **applied and verified 2026-10-27** (live definition calls `allocate_doc_number()` and no longer references `next_estimate_num`). Puts `create_estimate_from_lead` on `allocate_doc_number()`, finding the old numbering block by its first and last lines rather than exact text. Checked live before writing: the function still read `next_estimate_num`. Tested locally against a definition 065 had skipped.

- **067** — **written 2026-10-27, not yet applied.** `vapi_calls`, admin-read RLS, and a backfill of the call ids abandoned-call notes already carried. Tested locally, safe to re-run.

- **068** — `call_queue`: Lisa's outbound queue.
- **069** — assigned tech can work the job: line items, pricing, client record, photos and history keyed off `assigned_tech_id` (`is_my_assigned_job`, `is_my_assigned_client`). Also stopped `owner_id` restamping on conflict.
- **070** — `settings` no longer readable/writable by every login; `is_privileged_setting()` deny-list, counters carved out.
- **071** — competency self-assessment: `self_level` / `self_note`, with the `guard_competency_signoff` trigger.
- **072** — `time_entries`, the GPS time clock; distance and on-site computed server-side.
- **073** — owner SMS alert when a shift computes off-site (`send_owner_sms()`).
- **074** — `log_client_message` overload, from a concurrent session.
- **075** — `tech_pay` (hourly_rate, commission_pct), `invoices.commission_tech_id` / `material_cost`, `guard_invoice_commission`.

**On disk but not in this list:** `076_call_queue_suggested.sql` and `077_lead_name_phone_transfer.sql` are uncommitted drafts from a parallel session (applied state unchecked). `078_apprentice_hourly_rate.sql` sets the apprentice's $25/hr and is written but **not applied**: it raises until the Auth login for kmakaula23@gmail.com exists.

- **079** — **applied 2026-10-27.** Merged the duplicate Les Lee client: the "Missed call - no name given" row (bfe6491a) had 3 inbound `client_messages`; they now point at the real row 7a188e28 and the junk row is deleted. Guarded to delete only a `Missed call` placeholder with no email or phone.
- **080** — **applied 2026-10-27.** `tech_commission_tiers` (tech_id, threshold_cents, rate_pct; unique per tech and threshold; self-or-admin read, admin write). Apprentice seeded 0 -> 15%, $1,500 -> 18%, $3,000 -> 20%. **Read by `PayrollCard` since v1.27.4** (`src/commissionTiers.js`): thresholds are weekly (Mon-Sun) collected on the tech's paid commission jobs, the tier reached applies to the whole week (not marginal), commission = rate x (collected - parts cost). `tech_pay.commission_pct` is the flat fallback only when a tech has no tier rows.
- **081** — **applied 2026-10-27.** `invoice_items` is reachable only by admin (`invoice_items_admin`) or the assigned tech on a non-deleted job (`invoice_items_assigned`, 069). The `owner_id`-keyed `invoice_items_select` and `invoice_items_modify` are dropped, so a `commission_tech_id` who is not the assigned tech can neither read nor write that job's items.

- **082** — **applied 2026-10-27.** `profiles_tier_check` widened to `pending | apprentice | technician | service_tech | journeyman | admin`. A text CHECK, not a Postgres enum. Additive, touches no policy.
- **083** — **written and dry-run 2026-10-27, NOT applied** (apply when the `/welcome` build deploys). `handle_new_user()` files new logins as tier `pending`; `complete_my_onboarding(name)` lets a pending person set his own `display_name` (profiles has no self-update policy). Exercised as the test journeyman inside a rolled-back transaction: name set, self tier write refused, rollback left the live rows unchanged.
- **083** applied 2026-10-27 (with 078, Kaulana's $25/hr).
- **084** — **applied 2026-10-27.** Merged `technician` into `service_tech`: rows updated, `profiles_tier_check` is now `pending | apprentice | service_tech | journeyman | admin`, column default `service_tech`.
- **085** — **written, applied state unchecked.** Sets Kaulana (kmakaula23@gmail.com) to tier `apprentice`; raises if the row is missing.

- **086** — **applied and verified 2026-10-27.** `invoices_select` also admits `commission_tech_id = auth.uid()` (non-deleted). SELECT only: no write policy, and `invoice_items` stays assigned-tech/admin (081), so a commission-only tech sees the job but not its line items. The form is view-only for him (`commissionOnly` in `InvoiceForm`).
- **View-as is not impersonation.** `filteredData` in `App()` narrows data already loaded as the admin; RLS never runs as the viewed user. Its invoice match must mirror `invoices_select` (owner / assigned / commission) or a tech's view comes up empty (fixed v1.27.4).
- **087** — **applied 2026-10-27.** `invoices.material_entries` jsonb `[{id, desc, amount}]`; `material_cost` is their sum, written together by `db.setInvoiceMaterialEntries()`. `guard_invoice_commission` rebuilt from its live definition to pin the new column.

- **088** — **applied 2026-10-27.** `client_messages.read_at` for the Messages tab; backfilled read.

Next migration is `089_<short_description>.sql` (076 and 077 are taken on disk, 078 is written but unapplied). **Patching a live function: match on anchors (first and last line), not on a whole block of text** — 065's whole-block match silently missed on whitespace. **Check `ls supabase/migrations/` before picking a number** — this list has twice been behind the directory, which is how 059 ended up duplicated and how 064 was first written as a second 062.

**How 061 and 062 were applied**, since hard rule 6 assumes no programmatic access: through the Supabase **Management API**, `POST /v1/projects/<ref>/database/query` with `SUPABASE_ACCESS_TOKEN`, driven by `scripts/apply-migration.py` in the AI-OS repo. That is the only one of the three doors that runs DDL — PostgREST cannot, and this project's MCP server is pinned `read_only` in `.mcp.json`. Prefer it over pasting into the dashboard.

## Employee tiers (plan, 2026-10-27 — permissions NOT built)
`profiles.tier` is pay band and scorecard today, and since 083 also the onboarding gate. It touches no RLS
policy; `role` still decides `is_admin()`. Nothing below is enforced yet except where marked built.

| tier | meant to be able to do | state |
|---|---|---|
| `pending` | nothing: sees only the Pending-setup screen until Jake assigns a tier | built (gate in `App()`, set by 083 trigger) |
| `apprentice` | limited: works jobs assigned to him (migration 069), clocks in, fills own skill sheet, own hourly rate. No pricing authority, no commission | built as described |
| `service_tech` | solo jobs, create and price his own documents, see own financials (own `tech_pay`, own commission, own revenue scorecard). No other tech's money, no admin settings | partly built: scorecard and own pay rows exist; "own financials" screen does not |
| `journeyman` | nearly full access minus admin settings: all jobs and clients, pricing, reports, no Users/Settings secrets, no pay rates of others, no deleting history | not built: only the Settings button and the check value exist |
| `admin` | everything (`role = 'admin'`) | built |

**`technician` is gone (migration 084).** It was the original spelling of Service Tech; rows were moved to `service_tech`,
the CHECK no longer allows it, and the column default is `service_tech`. Do not reintroduce it.

**To build before the tiers mean anything:** a `my_tier()` SECURITY DEFINER helper for policies (like
`is_admin_uid`, to avoid profiles RLS recursion); journeyman policies on invoices/clients/payments/reports and a
deny on `settings`/`tech_pay`/`profiles` writes; hide admin-only tabs client-side by tier; an own-financials view
for service techs; and a rule for whether tier may ever be self-changed (today only admin can write profiles).

## Invite onboarding (`/welcome`)
Invite email -> `{{ .SiteURL }}/welcome?token_hash=...&type=invite` (template text in
`docs/invite-email-template.md`, pasted into the Supabase dashboard by hand) -> `WelcomePage` calls `verifyOtp`
(also handles PKCE `?code=` and an implicit-flow hash) -> `updateUser({ password, data })` -> `complete_my_onboarding`
-> `/`. The link deliberately skips Supabase's `/verify` so mail scanners cannot spend the one-time token.
Phone lives in auth `user_metadata` only; `profiles_read` is `using (true)` so a column there would be public.
The route is matched in `App()` before the auth gate, like `/sign` and `/v/`.

## AI features
All AI calls go to the Anthropic API via `api/*` (never OpenAI — the model ids
below are the source of truth, and `ANTHROPIC_API_KEY` is the only AI key set).

| Feature | Where | Model |
|---|---|---|
| Per-invoice chat (`AIChatPanel`) | `api/ai.js` | `claude-haiku-4-5-20251001` |
| Global chat agent (`GlobalAIModal`) | `api/ai.js` agent mode, `api/_lib/agent-tools.js`, `src/aiAgent.js` | `claude-sonnet-5-5`, effort medium, server-side fallback |
| AI estimator — job description + photos to a structured estimate | `api/ai-estimator.js` | `claude-sonnet-4-5-20250929` |
| Screenshot-to-client extractor (vision) | `api/_lib/extract-client.js`, via `api/ai-estimator.js` with `task: 'extract_client'` | `claude-sonnet-4-5-20250929` |
| Receipt OCR to expense | `api/extract-receipt.js` | `claude-sonnet-4-6` |

### Global chat agent (v1.14.0)
The header's AI button runs a tool-use agent, the same shape as the HI Grade
Manager Telegram bot in the AI-OS repo. `/api/ai` with `mode: 'agent'` relays
one model turn; `runAgentMessage()` in `src/aiAgent.js` runs the loop in the
browser, up to 12 model calls per message.

- **Tools run in the browser, on purpose.** Reads use the data the app already
  loaded plus the app's own `calcTotals`, so chat and screen always agree;
  `query_database` is a GET-only PostgREST read under the user's own JWT (RLS
  applies, fixed table allowlist). Writes go through `handleGlobalAIAction` in
  strict mode, so numbering, the optimistic lock and the calendar builder are
  the app's own. Do not move writes server-side; that would be a second writer
  with its own rules.
- **`handleGlobalAIAction` reads `dataRef.current`, not its closure,** and with
  `{ strict: true }` it throws on a failed save and returns the updated record.
  Without both, "create an estimate then add a line to it" in one message
  silently did nothing on the second step. Its writes go through
  `setDataNow`, which updates `dataRef` immediately: the agent runs a turn's
  tool calls back to back, before React re-renders, so a plain `setData` left
  the next call reading the pre-write copy and undoing the first write in
  state (v1.19.2, a booked visit vanishing from the Calendar tab).
- **The system prompt and tool list are frozen** so they cache. Anything per
  message (Hawaii date and time, who is signed in) goes in a `<context>` block
  at the top of the user message, stored on the message as `agentCtx`.
- **Within a message the conversation is append-only;** across messages only
  text is replayed, plus an `agentTrace` line per reply recording what the
  writes did. Never edit a `working` array mid-loop: it invalidates the
  model's reasoning between steps.
- The edge route writes a space every 4 seconds until the model answers, so a
  long think never hits the edge first-byte timeout; the client just calls
  `res.json()` (leading whitespace is legal JSON). Failures arrive as a 200
  with `{ error }`.
- A write to a document open in the form is refused (`openDocId`), because of
  the open-form overwrite below.
- **Scheduling with a `document_id` goes through the `add_visit` action,** which
  does what `ScheduleJobModal` does: appends to `invoices.visits` via
  `updateInvoiceVisits`, creates the Google event with `buildCalendarEvent`
  (location from the document's job site), marks the visit `pending` when
  Google is not reachable, and first seeds a legacy `gcal_date` appointment
  (a Lisa booking) into `visits` so the trigger does not overwrite it. Without
  a `document_id` it is a bare calendar event on no job.
- **Job sites:** `add_job_site` appends to `clients.addresses` in the same shape
  as the form's "Add property"; `create_document` sets `jobAddress`,
  `client_id` and `clientInfo` the way picking a client in the form does
  (named site, else the client's first).
- **Screenshots stay visible for follow-ups.** A user message's photos are
  replayed for `PHOTO_REPLAY_MESSAGES` (6) messages, newest first, at most
  `PHOTO_REPLAY_MAX` (4) images per request including the current one, rebuilt
  byte-identically to the original send so the cache still hits. Earlier photos
  drop to their text placeholder. Keep the cap: images count toward the edge
  function's request body limit.
- Tool names and descriptions in `agent-tools.js` must match what the executors
  in `aiAgent.js` actually do. The model believes the descriptions.
- **`web_search` is the one tool with no browser executor.** It is a
  server-side tool (`web_search_20260209`) that runs inside the model call,
  for the Honolulu market check in the pricing rules (v1.20.0). The loop skips
  its blocks and resumes a `pause_turn` by re-sending `working` unchanged.
  Results stay in `working`, which the browser re-sends every step, so keep
  `max_uses` low for the same body-limit reason as the photo cap.
- **Pricing order in `AGENT_SYSTEM`:** price book (always wins) -> materials
  plus 35% or the labor floor -> travel zone -> market check -> position in
  the upper part of the Honolulu range, never the cheapest. Same method as
  `api/ai-estimator.js`; change both together.

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

1. **iPhone: long-pressing a client's name selects it as text** — **fixed in
   v1.21.4, not yet confirmed on the phone** (it cannot be: Vercel has not
   deployed since 2026-10-18, see AI-OS `STATUS.md`).
   **What Jake actually reported, on 2026-10-23:** long-pressing the name in
   Clients "doesn't do anything, it just starts selecting it as text". The
   complaint is the selection itself, not the page moving. The old title
   ("drags the page") sent two sessions after the wrong defect.
   **Cause.** The client list row and the client detail header carried no
   `userSelect` / `WebkitUserSelect` / `WebkitTouchCallout: none`, while
   `InvoiceListCard` and `EstimateListCard` have carried all three since bug #6.
   The client cards were simply missed. Both are whole-card buttons, so a
   long-press could only ever produce an iOS selection and callout.
   **Scope of the fix.** Only the non-editable displays. `ClientEditFields`
   keeps its inputs fully selectable — you cannot edit a name you cannot put a
   caret in — and the detail **body** stays selectable on purpose, because
   copying an address or phone number out of it is useful on a job.

### Fixed, keep — a different defect found while chasing the above

- **Pull-to-refresh and edge-swipe-back armed inside text inputs** (v1.21.1).
  Both are document-level and non-passive and neither checked
  `e.target.tagName`, so a drag starting in any in-tree input at scroll top in
  the list view locked the gesture and `preventDefault`'d every move. Both now
  carry the same `INPUT`/`TEXTAREA`/`SELECT`/`isContentEditable` bail that
  commit `404696e` gave the tab swiper in May. **This is real and worth
  keeping, but it was not what Jake was hitting** — he tested it on live
  v1.21.1 and the selection behaviour was unchanged, which is the evidence that
  separated the two defects.
  **Ruled out while hunting, so nobody re-hunts them:** the global
  `touch-action: pan-y` in `index.html`, `S.input`'s
  `touchAction: "manipulation"`, the portaled `ClientPickerModal`, the
  invoice-form client-edit overlay, and `printablePdf.js`. Fourteen other
  candidates were raised and refuted.

### Fixed 2026-10-18 — do not re-open

- **Payment method spellings.** `payments.method` had fifteen spellings of
  eight methods until the rows were repaired on 2026-10-16, and every reader in
  the app was case-sensitive, so Revenue by Method split one method across
  several rows and three colour palettes disagreed. v1.21.0 moved the rule into
  `src/paymentMethods.js`, normalized the read and write chokepoints, put an
  enum on the `record_payment` tool (its description used to suggest "Card",
  which is not a method the app knows), and added the migration 061 trigger
  (corrected by 064), **both applied and verified 2026-10-20**, so a writer
  outside the app can no longer store a raw spelling either.
  **The unrecognised-value-passes-through rule is deliberate** — see the header
  of `src/paymentMethods.js` before "tidying up" a stray label.

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
- **The database session is UTC and the business is in Hawaii (UTC-10). Never render `now()` or `current_date` bare.** For the ten hours between 2pm and midnight local — exactly when the after-hours receptionist matters — the server is already on tomorrow's date. `create_estimate_from_lead` stamped lead notes "Sep 03, 08:07 AM" for a 10:07 PM Sep 2 call and dated the estimate a day ahead; all 10 lead rows written before migration 049 carry the wrong date. Use `now() at time zone 'Pacific/Honolulu'` and `(now() at time zone 'Pacific/Honolulu')::date`.
- **`gcal_date` and `visits[].start` are LOCAL wall-clock text, exactly `YYYY-MM-DDTHH:MM`.** They are TEXT columns holding Hawaii time with no offset, and the database runs UTC, so `::timestamptz` anywhere in a write path silently restamps a 6pm job as 6pm *UTC* — which reads back as 8am Hawaii. That is what `save_invoice_with_items` did until migration 048. Cast `::timestamp` (offset discarded) and `to_char(..., 'YYYY-MM-DD"T"HH24:MI')` on the way in. The bug hides well: the lead email cancels it out by rendering in the UTC session, `push_invoice_to_calendar` already casts `::timestamp`, and `App.jsx` renders by slicing characters — so three of the four consumers look correct while the stored value is wrong, and only an honest parse (JS `new Date()`, or `at time zone 'Pacific/Honolulu'`) shows the ten-hour error.
- **Never write `gcal_event_id`, `gcal_date` or `gcal_duration_minutes` directly on an invoice that has visits.** `invoices_sync_first_visit` is a BEFORE INSERT OR UPDATE trigger that rewrites all three from the earliest entry in `visits` on every update, so a direct write is undone inside the same statement with no error. `set_invoice_gcal_event()` — the receptionist's calendar callback — did exactly that and silently lost every event id it was handed (fixed in migration 047 by writing into the visit the trigger derives from). Symptoms if this regresses: the app cannot move or cancel a job Lisa booked, and `push_invoice_to_calendar()` re-pushes create duplicate calendar events because it only skips invoices that already have an id.
- **This project is at the Hobby plan's 12 Node Serverless Function cap.** Six routes in `api/` are `runtime: 'edge'` and do not count; the other twelve do. Adding a thirteenth Node route makes every deploy fail at `Deploying outputs...` **with no error line anywhere in the build log** — the build itself completes fine, so it reads like a platform glitch. This cost a full debugging session on 2026-09-02. Before adding a Node route, either make it `runtime: 'edge'` or fold it into an existing one, the way the OAuth callback lives inside `api/gcal.js` rather than its own file. Count with: `for f in api/*.js; do grep -L "runtime: 'edge'" $f; done | wc -l`
- **Both calendar writers must target the same calendar.** `google_credentials.calendar_id` is the app's write target and must equal the calendar the receptionist's Apps Script has hardcoded (the shared **Work** calendar). If they disagree, everything still appears to work — events are created, no errors are raised — but the two-way reconciliation compares unrelated calendars, matches nothing, and the app never sees a booking Lisa made. That was the state until migration 046. Check it before debugging a "reconciliation isn't working" report. `read_calendar_ids` is a separate list of every calendar the tab displays, and update/delete fall back across it so events left on `primary` by the old browser flow stay editable.
- **The Google OAuth consent screen must stay published to Production.** In "Testing" status Google expires refresh tokens after 7 days, which resurrects the disconnect bug on a weekly cycle instead of an hourly one. Same trap called out in the header of `033_calendar_webhook.sql`.
- **Only one calendar reconciliation may run at a time.** There are two callers — the startup sweep and the calendar's own fetch — and both fire on the same `gcalAuthed` change. Creating an event is the one step repeating cannot undo, so `runReconcile()` holds a lock, reads invoices from a ref rather than a closure, and claims a per-visit key *before* awaiting. Without all three, connecting Google mid-session created every unsynced event twice.
- **Calendar sync is two-way but not live.** `reconcileVisitsWithGoogle()` runs when the Calendar tab fetches events and once per session on app load (-30 to +90 days). Order matters: a visit marked `pending` never reached Google, so it is pushed rather than overwritten; a visit with no `eventId` is created, because `push_invoice_to_calendar()` is create-only and would skip the invoice; otherwise Google's times win, since that is where appointments actually get dragged around. A visit whose event was deleted in Google is left alone — absence from a range query is not proof of deletion. **Before creating, a visit with no `eventId` adopts an existing unclaimed event that names its document number** (same start, or the only one that day) — `findUnlinkedEventForVisit()`. Without that, a visit written by Lani without its event id got a second Google event and the original drew as a grey "Other" block (fixed v1.22.1). The calendar also hides an unlinked event naming a document that already has a job block at the same minute.
- **A job can have several visits.** `invoices.visits` is the source of truth; `gcal_date` and friends are *derived* from the earliest one by a trigger and must never be written by hand once visits exist. They stay because `push_invoice_to_calendar()`, the webhook trigger and `create_estimate_from_lead` all read `gcal_date` — removing it would reach into the AI receptionist.
- **`internal_notes`, `gcal_duration_minutes` and `visits` do not round-trip through `save_invoice_with_items`.** All three are written separately in `db.js` after the main save, deliberately — the RPC never names them, so a full save cannot clobber any of them. Add a column the same way rather than rewriting that function.
- **`invoice_versions` uses `sent_at`, not `created_at`.** `invoice_events` uses `created_at`. Getting this wrong aborts the whole SQL batch.
- **`save_invoice_with_items` has been redefined by seven migrations** and may carry edits made directly in the SQL editor. Rebuild it from `pg_get_functiondef`, never from an old migration file — migration 041 shows the pattern, with asserted replacements.
- **Do not reset the invoice form when backing out to the list.** That path clears `selected` too, and resetting there blanks the form mid-animation; the unmount flush then saves an id-less form and `autoSaveInvoice` mints an empty document. Reset only on an explicit new-document request.
- **Document-level touch handlers must stand down inside modals and nested scrollers.** Pull-to-refresh and edge-swipe-back both `preventDefault()`, which cancels the scroll the finger was about to perform, not just the browser gesture. Pull-to-refresh originally only checked `window.scrollY`, and on a screen whose content fits the page never scrolls — so it claimed every downward drag and nothing with its own scrollbar could be scrolled back up. `touchInOverlay()` and `touchInScroller()` near the top of App.jsx are the guards; any new document-level gesture needs them too.
- **A draft only loads into the document it came from.** `useDraftPersistence` takes an `expectedId` and discards (and deletes) any stored draft whose own `id` differs, on both read and write. The key is built from the `invoice` prop while the contents come from `form` state, and those are a render apart during a document switch — so a draft could be filed under the wrong document's key and then restored into it. That is what made EST1022 open showing INV1021. The backgrounding flush reads its key from a ref, since its listener is registered once at mount.
- **Every save path checks that the form's own `id` matches the row being written.** `flushAutoSaveRef`, `updateInvoice` and `partialSaveInvoice` all refuse when `form.id` is present and differs from the target. The id/type guard cannot see this: two documents of the same type have matching prefixes, so it waves the write through. This matters because **backing out of the form runs the auto-save flush on unmount** — a form displaying the wrong document turns into a corrupted row simply by leaving it.
- **Never write an auto-grow textarea as an inline `ref={el => ...}` callback.** A new arrow function each render makes React reattach the ref every render, and setting `height = "auto"` to measure collapses the element and clamps the scroll position. Use a stable ref plus a layout effect.
- **iOS Safari `SpeechRecognition.start()`** throws synchronously. Always wrap in try/catch.
- **localStorage chat history is a warm cache only.** The authoritative copy is `ai_chat_history`. Don't reintroduce migration logic that "claims" a legacy key — that made chat jump accounts.
- **Profiles table RLS recursion**: any policy on `profiles` that queries `profiles` infinite-loops. Use `is_admin_uid(auth.uid())`.
- **`form.jobAddress` is an object, not a string.**
- **An open invoice form overwrites any outside write to that invoice's line items, silently, within seconds.** `save_invoice_with_items` replaces the whole item set — it deletes every `invoice_items` row for the document and re-inserts from the payload, so every row gets a fresh uuid on every save. That is the tell when diagnosing: if the item ids changed but the contents did not, a full-set save ran. Combined with `partialSaveInvoice`'s self-heal, an open form beats any external writer. The optimistic lock fires `CONCURRENT_EDIT` as designed, and then [App.jsx:11795](src/App.jsx#L11795) re-fetches the fresh `updated_at` and retries **once with the same stale payload** — its own comment names "a bulk backend script" as an expected cause of the conflict. So bumping `updated_at` before an outside write makes things worse, not safer: it is the trigger for the retry that discards the write. Backing out of the form also flushes the auto-save on unmount, so leaving the screen is itself a full-set save. This cost three attempts to add one change-order line to INV0878 on 2026-09-29, each flattened 20 to 40 seconds later, with no warning shown to Jake and nothing in the logs to distinguish it from a failed insert. **Until this is fixed, an outside writer must have the document closed in every open client, and must not touch `invoices.updated_at`.** The real fix is for the retry to re-merge rather than replay: re-read the row it lost to and rebuild the payload, or make the item write a diff instead of a delete-and-replace.

## Workflow tips for the next agent
- Build before pushing: `npm run build`. It will **not** catch a reference to a variable you deleted — esbuild does not scope-check, so grep for leftovers after a refactor. That exact gap shipped a crash in the AI bulk-create path.
- Jake's phone is the primary device. Test at mobile widths before declaring something fixed.
- Pushing to `main` auto-deploys. Don't run `vercel` manually.
- Jake must hard-reload on his phone to pick up a new build; the service worker caches.
- The per-invoice AI chat's system prompt is near the top of `App.jsx` — search for `update_item`. The global chat's prompt is `AGENT_SYSTEM` in `api/_lib/agent-tools.js`.
- If the AI claims it did something but nothing happened, add a regex guard + retry like the one around `extractActionsJSON` in `AIChatPanel`.
- Another session may be pushing to `main` at the same time. Fetch before you start and rebase if the push is rejected.

— end of handoff —

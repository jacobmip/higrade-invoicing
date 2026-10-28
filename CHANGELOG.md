# HI Grade Invoicing — Changelog

## v1.39.3 — 2026-10-28

- Send Estimate/Invoice > Text Message no longer opens the native Messages app. It shows a preview with the message in an editable box and the destination number; "Send via Lisa" sends it from the business Twilio number through `/api/sms-inbound` (logged to `client_messages`, so it shows in the Messages thread). Failure shows the error in the modal and keeps it open. Success records the `sent` event (channel sms) and the `sms_sent` version snapshot.
- Sends with the signed-in admin session (same path as the AI chat's `send_sms`), not the webhook secret: the secret is unreadable to non-admins (migration 070) and should not be loaded into the browser. A non-admin gets the endpoint's refusal in the modal.

## v1.39.2 — 2026-10-28

- The ballpark text now carries a link to the full estimate (`/v/<view_token>`). `lead-estimate.js` reuses the row's `view_token`, or mints one (9 random bytes, base64url) and saves it only if still null. New layout: one line per item, total, the link, then the confirm-the-price sentence and the visit question. The Telegram approval shows the same text plus an "Estimate link in text" line. If the token cannot be saved the text goes without the link and Telegram says so.
- Known gap: the bot inserts the proposal's line items after the text is sent, so a customer who taps the link in the first seconds can still see the generic Service Call line.
- Not done: the Yelp responder (`AI-OS/scripts/yelp_autoresponder.py`) files no estimate and parses no phone, so there is no `invoice_id` to send to `propose_estimate`. Left unwired.

## v1.39.1 — 2026-10-28

- The AI ballpark now also runs for web-form leads. `api/schedule-request.js` calls `proposeInBackground()` after it has answered 200, only when the lead has a phone, agreed to texts, and `sms_outbound_enabled` is true. The form never waits on the model.
- New `op: 'propose_estimate'` on `/api/sms-inbound` (webhook-secret or admin session): `{ invoice_id, description }` queues `proposeLeadEstimate`. Not yet called by anything: the Yelp responder files no estimate and has no phone for the lead, so it has no `invoice_id` to send.
- The Telegram approval message now shows the exact draft SMS. The text is built once in `lead-estimate.js`, stored as `estimator_items.sms_body`, and sent verbatim by the manager bot on APPROVE (the bot falls back to its own wording for older proposals).

## v1.39.0 — 2026-10-28

- AI ballpark for web / SMS / Yelp leads, behind Jake's approval. When a text lead is filed (`sms-agent.js`), the estimator runs (price book first, no web search, 8s budget) and Jake gets a Telegram message: client, job, items, total range, `APPROVE EST####` / `DECLINE EST####`. Nothing goes to the customer until APPROVE. Phone leads never get one; the gate is `lead_channel`, since `source` is `ai_lead` for phone too. Skipped quietly (logged) when the estimator fails, the address or job description is missing, or the estimate already has real prices.
- On APPROVE the manager bot texts the customer the ballpark through `/api/sms-inbound` and replaces the generic Service Call line with the estimator's lines.
- Migration 100: `invoices.estimator_items` (jsonb) and `estimator_approval` (null | approved | declined).
- The estimator's prompt and model call moved to `api/_lib/estimator.js`; `/api/ai-estimator` behaves as before and gains `task: 'lead_estimate'`. No new route (still 12). Added `@vercel/functions` for `waitUntil`.

## v1.38.9 — 2026-10-28

- AI chat (per-invoice and global agent): asked to polish, rewrite or clean up a customer message, it now rewrites in Lisa's voice, shows it under "Polished message:", and uses send_sms (asking for the phone first if missing). Prompt change in `App.jsx` and `api/_lib/agent-tools.js`.
- Messages tab: the Polish button is now "Polish with AI", sits above the reply box with a helper line ("Rewrites your draft in Lisa's professional voice"). Send stays next to the textarea.

## v1.38.8 — 2026-10-28

- Inbound MMS: `rehostTwilioMedia` no longer returns an empty list when Twilio or service-role credentials are missing; every attachment now gets an entry (saved, or `failed` with its Twilio media sid), so a miss is visible instead of leaving `media` null.
- Re-host has a shared 7s budget and per-request timeouts, so a few large photos cannot run past Hobby's 10s limit and kill the function before the message is logged. `sms-inbound.js` also catches a throw from the re-host and still logs the message.
- Messages thread: tapping a photo opens it full screen (tap to close).

## v1.38.7 — 2026-10-28

- Opening a document from the Calendar tab now fetches its line items and payments (`db.loadInvoiceWithItems`) when the invoice in state lacks them, with a Loading overlay while it runs, instead of relying on the v1.38.6 null guards alone.

## v1.38.6 — 2026-10-28

- Fixed the crash "undefined is not an object (evaluating 'e.items.reduce')" when opening a document from the Calendar tab. `calcTotals` was the only `.reduce` over line items and assumed `items` was always an array. A document opened from the Calendar (or the notification bell) is now normalized to have `items` and `payments` arrays, the form normalizes them on init, and `calcTotals` tolerates a missing list.

## v1.38.5 — 2026-10-28

- The invoice/estimate form is wrapped in an error boundary: a render crash now shows the error message and a Close button instead of a white screen.
- Schedule card in the form no longer assumes every visit has a string `start`/`label`; malformed visits are skipped instead of throwing. Aimed at the white screen when opening an estimate from the Calendar tab. If it still happens, the boundary now shows the actual error to report.

## v1.38.4 — 2026-10-28

- Phone kickoff text reworded (Aloha greeting, free ballpark estimate from a photo). It no longer carries "HELP for help".
- Web leads from `/schedule` now get a follow-up text asking for the service address and photos. Sent only when the form's text-consent box was ticked, `sms_outbound_enabled` is true and the number is valid; otherwise skipped with a log line. Logged via `log_client_message` and snapshotted as `sms_sent` on the estimate.
- Both texts are guarded against double sends: a row with the same body already in `client_messages` for that phone (last 10 digits) skips the send. The check fails closed.
- Helpers `alreadySentMessage()` and `recordSmsSnapshot()` added to `api/_lib/sms.js`.

## v1.38.3 — 2026-10-28

- `/api/sms-inbound` send op also accepts the webhook secret as the Bearer token (Lani on Telegram), so her texts are sent and logged like the reply box's. The `sms_outbound_enabled` kill switch still applies, and `place_call` stays session-only. An optional `invoice_id` in the body writes an `sms_sent` snapshot on that document's History.

## v1.38.2 — 2026-10-28

- Quick View As switcher: admins tap the header subtitle (a "Viewing as [name]" chip when active, "View as..." otherwise) to open a bottom sheet listing every user with their tier, plus a "View as myself" reset. Reuses `allUsers` and `setViewAsUserId`, so it stays in step with the Settings picker.

## v1.38.1 — 2026-10-28

- On My Way message simplified: now reads "Aloha [name], Jake is on the way and will arrive in approximately X minutes. Mahalo!" — removed the "HI Grade Plumbing technician" prefix.

All changes to the app are logged here. Most recent version at the top.
Each entry is tagged with its version number and date so incidents can be traced to an exact release.
## v1.38.0 — 2026-10-28

- Lisa in the AI chat. Tell the chat "text John and say X" and it sends the text from Lisa's Twilio number at once, logged in that client's Messages thread (and as a "Text sent (Lisa)" entry in the document's History when a saved estimate or invoice is in context). Tell it "call Maria about the heater estimate" and it queues an outbound call in `call_queue`. It never dials: the AI-OS runner still needs Jake's APPROVE on Telegram, sent by the runner at dial time. A Telegram heads-up goes out when the call is queued, and the chat says plainly if outbound calls are switched off or the heads-up could not be sent. A repeat of the same queued call is not added twice.
- Both the global chat agent (new `send_sms` and `place_call` tools) and the per-invoice chat (new `send_sms` and `place_call` JSON actions) do this, through the new `src/lisaActions.js`. The system prompts tell the model to write texts in Lisa's voice (warm, brief, Aloha/Mahalo, no pricing unless Jake gave one) and to word the call's `about` as a one-sentence brief.
- Messages tab: a Polish button next to Send rewrites the draft in Lisa's voice through `/api/ai` and puts it back in the box. Nothing is sent until Jake taps Send.
- `api/sms-inbound.js` gains `op: 'place_call'` on its existing admin POST, and the same POST now accepts a bare 10-digit `to`. No new route; still 12 functions.

## v1.37.3 — 2026-10-28

- Tapping a notification now opens what it is about. A text notification opens that client's thread in Messages; any notification with an invoice or estimate (lead, payment, signed, opened) opens it; one with only a client opens the client profile. A notification with no target just closes the panel. The off-site clock alert is an SMS only and writes no notification row, so it has nothing to open yet.

## v1.37.2 — 2026-10-28

- Admin-only Undo button at the top of the Edit tab. Shown when the document has at least two saved versions and is not deleted. Tap, confirm "Undo last change?", and the form is restored to the version just before the latest one, using the same restore as the History tab's Restore button (one step only). A brief "Undone" toast confirms; the normal auto-save then persists it.

## v1.37.1 — 2026-10-28

- Non-admin users (apprentice, service tech) no longer see any GPS or activity wording: the activity category badge is gone from the clock banner and the Time Clock card, as are the on-site/off-site chips, the "N off site" weekly count, the location disclaimer under Clock in, and the "Getting your location" progress text. The "On the clock" timer, Clock in/out and Start/End Day are unchanged.
- Live Activity and Team Map in Reports confirmed admin-only. GPS polling (`activity.js`) still runs for everyone, so no data is lost.

## v1.37.0 — 2026-10-28

- Address autocomplete: the street field now suggests Hawaii-biased addresses from Google Places as you type (300 ms debounce, 3+ characters, up to 5 suggestions; arrow keys, Enter, Escape, tap outside to dismiss). Picking one fills the street line and the city, state and ZIP.
- Applies to the property street address and billing street address in the client editor (which is also the Bill To editor on an estimate or invoice), the new-client modal (job site and billing) and the Add Property form.
- `api/geocode.js` gains `?mode=autocomplete&input=...&sessiontoken=...`, returning the predictions array. Same file, still edge, no new function. New component `src/AddressAutocomplete.jsx`.
- Job-site coordinates are not saved at pick time; they are still geocoded and cached on first clock-in (migration 072).

## v1.36.1 — 2026-10-28

- Deleting an invoice or estimate now deletes its Google Calendar event(s). Migration 099 adds a database trigger on `invoices.deleted_at`, so it applies to every writer (app, chat agent, API, SQL), not just the Delete button. It collects `gcal_event_id` and every visit's event id, asks `/api/gcal` to delete them, then clears `gcal_event_id`, `gcal_date`, `gcal_duration_minutes` and `visits` on the row.
- An event still used by another live document is kept. Converting an invoice to an estimate moves the visits to the new estimate and then deletes the old invoice; without this check that would have removed the job's only calendar entry.
- `api/gcal.js` accepts the webhook secret as Bearer for the `delete` op only (all other ops still need a signed-in user). No new route; still 12 functions.
- Restoring a deleted document does not bring the calendar event back. Delete is fire-and-forget: if Google is disconnected at that moment the event is left in place.

## v1.36.0 — 2026-10-28

- Estimates now have their own status words: Draft (gray-blue), Sent (blue), Approved (green), Declined (red), Expired (gray), Converted (green). "Outstanding" never shows on an estimate: the list pill, the form header, the desktop preview badge and the Edit tab's status buttons (Draft / Sent / Approved) all use `estimateDisplay()`. New estimates are created as `draft`, sending one by email sets `sent` (never walks back approved, declined or converted), and a manual conversion marks the estimate `converted`. Expired is computed from age (30 days), not stored. Estimates saved before this carry `outstanding` and read as Draft, since nothing on the row says whether they were sent.
- Fix: approving and signing an estimate on the customer link never converted it. `api/submit-signature.js` only set `status = approved`; conversion existed only inside the PayPal deposit path. It now converts the estimate to an invoice (same number, status from its payments, `outstanding` if none), marks the estimate `converted` with `converted_to_id`, moves the visits and Google event ids to the invoice (kind `job`) and any deposits already recorded on the estimate, and texts Jake on Telegram. If conversion fails the signature is still saved and Jake gets a Telegram message saying to convert by hand.
- The conversion moved out of `api/paypal-capture-order.js` into `api/_lib/convert-estimate.js` so both paths share it (a helper, not a route; still 12 functions). PayPal deposits on an estimate already converted; they now also carry visits and deposits and send the Telegram message. Also fixes `require('node:crypto')` in an ES module, which would have thrown when minting the invoice's view token.
- Needs `TELEGRAM_TOKEN` in the Vercel env (the HI Grade Manager bot's token; `TELEGRAM_CHAT_ID` optional, defaults to Jake's). Without it the conversion still happens and the message is skipped with a log line. No migration.

## v1.35.4 — 2026-10-28

- Fix: "permission denied for table users" when converting an estimate to an invoice (and on any new admin-owned document). Not caused by v1.35.3: migration 094's `default_assigned_tech()` trigger checked the default apprentice with `select ... from auth.users`, which the signed-in role cannot read, so the invoice INSERT failed and only the local copy survived. Migration 098 checks `public.profiles` instead. Applied and exercised as Jake in a rolled-back insert: the row saves and `apprentice_id` is still stamped.

## v1.35.3 — 2026-10-28

- Fix: converting an estimate to an invoice no longer leaves two Google Calendar events. `convertInvoice` used to blank `visits`, `gcalDate` and `gcalEventId` on the new invoice (so a fresh event got pushed) while the estimate kept its own. Now the invoice takes over the estimate's visits and event ids with each visit's `kind` set to `job`, the estimate's schedule is cleared so two rows never share an event, and the existing Google event is PATCHed in place: colour flips to the job colour and the title drops the estimate label. The description is rewritten only for events the app built (`builtBy: "app"`); Lisa's bookings keep the caller's words but still get the new title and colour. Invoice to estimate is unchanged. No migration.

## v1.35.2 — 2026-10-28

- Fix: the Calendar tab showed a tech or apprentice all of Jake's calendar. The invoice list was already limited by RLS (owner, assigned, commission, apprentice), but `CalendarTab` also drew every unlinked Google event on the shared Work calendar as a grey "Other" block. That loop now runs for the admin only, including when the admin uses View-as, so a viewed tech sees what the tech sees. Job blocks still come from the user's own invoices. No migration.

## v1.35.1 — 2026-10-28

- Fix: `/api/vapi-call-ended` treated outbound calls as abandoned inbound calls. `capture_abandoned_call` ran on every end-of-call report, so a call we placed to a customer with no estimate filed created a new lead (a duplicate estimate). Outbound is now detected from `call.type === 'outboundPhoneCall'` or `call.direction === 'outbound'`. For outbound calls the lead capture and the kickoff SMS are skipped; the call is still logged to `vapi_calls` with direction `outbound` (phone from `call.customer.number`) and the call archive email is still sent. No migration.

## v1.35.0 — 2026-10-27

- New: admin-only Team Map card in Reports (below Live Activity). Tap Show to open a Leaflet / OpenStreetMap map centered on Honolulu, zoom 11. Leaflet loads from unpkg the first time the card is opened. One marker per clocked-in tech, green On Job, blue Driving, yellow Parts Run, gray Shop / Stationary. Tap a marker for name, category, job and client (On Job only) and last-updated time. Refreshes every 60 seconds while open. Anyone not clocked in does not appear.
- Data: the request's SQL named columns that do not exist (`start_time`, `location_lat` on `time_entries`). The map instead reads every open `time_entries` row (`clock_out_at` null) and takes position and category from that tech's open `time_activity` segment (migration 097); before the first 5-minute reading it falls back to the clock-in position, shown as Stationary. New `db.loadTeamPositions()`. No migration.
- Same limit as v1.34.0: positions only update while the tech's app is open.

## v1.34.0 — 2026-10-27

- New: automatic GPS activity tracking while clocked in. Every 5 minutes the phone's position is read and categorized: On Job (within 200 m of a job site assigned to the tech with a visit today, or the job the shift is clocked to), Parts Run (Ferguson Honolulu, Home Depot Pearl City, Home Depot Kapolei), Driving (over 10 mph since the last reading), Shop (within 200 m of `settings.home_base_lat/lng`, blank until set), otherwise Stationary. Haversine distance. Logic in `src/activity.js`.
- New: the tech sees a category badge in the clock banner and on the Time Clock card, updating every 5 minutes. Labels are text, not emoji.
- New: admin Live Activity card in Reports, above Hours: each tech's current category, last-seen time, and today's hours on job / driving / parts run / shop. Refreshes every minute.
- Migration 097: `time_activity` (segments inside a clock session, RLS self-or-admin, one open segment per tech). Not `time_entries`, which already exists as the payroll clock (072, 092) with a different schema; paid hours are unchanged.
- iOS: added NSLocationWhenInUseUsageDescription and NSLocationAlwaysAndWhenInUseUsageDescription to Info.plist.
- Limit: polling runs in the web view, so it pauses when the app is backgrounded or the phone is locked and catches up on return. True background tracking needs a native background-geolocation plugin.

## v1.33.0 — 2026-10-27

- New: Communications tab on the client profile (admin). One newest-first timeline of every text and call with that client. Texts are iMessage-style bubbles (outbound blue on the right, inbound gray on the left); calls show Incoming / Outgoing, duration, the call summary and a Play button.
- New: `GET /api/call-recording?id=<call id>` streams a call's audio through the server (admin session, call must be in `vapi_calls`, Range forwarded for seeking). Edge runtime, so the Hobby 12-function count stays at 12.
- Fixed: outbound calls. `vapi-call-ended` now reads the customer number from `call.customer.number` for outbound calls, so the recording links to the right client, and stores the call direction (from `call.type`) and the Vapi summary in `vapi_calls`.
- Migration 096: `vapi_calls.summary` (direction already existed from 093).

## v1.32.3 — 2026-10-27

- Fixed (for real): the clock-in banners still covered the top of some tabs. The header height was measured by an effect that ran once at mount, before the header existed (the splash and loading screens return first), so it never measured anything and the page offset stayed at the 64px default. The header is now tracked with a callback ref, so its real height, banner included, is observed and applied to the single root wrapper that every tab and the invoice form sit under.

## v1.32.2 — 2026-10-27

- Fixed: On My Way turned the screen gray and sent nothing. The confirmation modal (a fixed overlay inside the slide-animated form) could come up as an empty backdrop. The modal is gone: one tap now locks the button immediately (synchronous ref, so no double send), reads GPS if available, and sends. No GPS means the "arrive shortly" text; with GPS the server works out the ETA. Any failure shows as red text under the button instead of breaking the screen.

## v1.32.1 — 2026-10-27

- Fixed: a job's apprentice (`invoices.apprentice_id`) now sees that job in their job list and on their calendar. Before, only the assigned tech and commission tech did.
- Migration 095: `invoices_select` also admits `apprentice_id = auth.uid()` on non-deleted jobs. SELECT only; no edit rights, and line items, payments and the client record are unchanged.
- View-as filter in `App()` mirrors the new policy.

## v1.32.0 — 2026-10-27

- Added Default Apprentice. Settings (admin) has a Default Apprentice dropdown of all non-admin users; it saves `settings.default_apprentice_id`. Every new invoice or estimate owned by an admin gets `invoices.apprentice_id` filled from it automatically, with no extra step. The invoice form shows a small "Apprentice: name" line under Assigned Tech.
- Migration 094: `invoices.apprentice_id` (nullable, display only, grants no access), `default_assigned_tech()` extended to stamp it (covers the receptionist and every other writer), and the setting seeded to Kaulana Makaula.

## v1.31.0 — 2026-10-27

- Added Change Password to Settings (Account card) for non-admin users. A modal asks for a new password and confirmation (8 characters minimum, must match) and calls `supabase.auth.updateUser`. Admins do not see it; they manage passwords in the Supabase dashboard.

## v1.30.3 — 2026-10-27

- Fixed the clock-in banner overlapping content. The invoice/estimate form was pinned 64px from the top regardless of the header, so the "On the clock" and "Day started" banners covered its top. It now sits below the measured header height, so the banner pushes content down the same way on every screen.

## v1.30.2 — 2026-10-27

- On My Way can no longer double-send: it asks first, and after a successful send the button locks to "Sent" and cannot be tapped again.
- New confirm modal before sending: reads your GPS, gets the drive time from `/api/eta`, and shows "~X min away" (or "ETA unavailable") with the exact text the customer will receive. Nothing is sent until you tap Send.
- `api/on-my-way.js` now uses the `eta_minutes` the modal showed (0-600), so the text matches what was confirmed. Without it, behaviour is unchanged.
- Button row is now Call | On My Way | Navigate. Call dials the client's mobile, else phone, and says "No phone number on file" when there is none. Navigate opens Apple Maps on iPhone/Mac, Google Maps elsewhere.

## v1.30.1 — 2026-10-27

- Migration 093: `vapi_calls.direction` ('inbound' default, 'outbound'), and `call_queue.approval`, `approval_asked_at`, `notified`.
- Call recordings on an estimate now carry an Inbound / Outbound label. Outbound calls placed by `AI-OS/scripts/outbound_call.py` are filed in `vapi_calls` when `check` sees them end.
- Outbound runner (AI-OS repo): every live dial waits for a Telegram APPROVE, a call-summary email goes to the business inbox when a call finishes. The manager bot records the APPROVE/CANCEL reply.

## v1.30.0 — 2026-10-27

- Lisa no longer books blind. New edge route `api/availability.js` (`GET ?date=YYYY-MM-DD` or POST `{date}`) returns Jake's busy blocks for a Hawaii day and the free windows of 90+ minutes between 8am and 6pm. Busy time is read from every invoice's `gcal_date` and `visits[]` plus every Google calendar in `google_credentials` (personal and Work), so an appointment that is on no invoice still blocks.
- Fails closed: if Google cannot be read the route answers 502 and tells Lisa to promise a callback, never a partial list.
- Authenticated with the existing webhook secret (`SMS_WEBHOOK_SECRET` / `settings.sms_webhook_secret`); the service-role key never leaves the server. Edge runtime, so the Node function count stays at 12.
- Lisa's Vapi assistant gets a `checkAvailability` tool and a CRITICAL RULE in its prompt (applied through the Vapi API, not in this repo).

## v1.29.2 — 2026-10-27

- Removed the AI pill from the invoice/estimate form header (the AI tab is still in the tab bar).
- Removed the delete (trash) button from the form header, where it sat next to Done and was easy to hit by accident.
- Deleting a document is now long-press (500ms) on its card in Invoices or Estimates, then Delete in the sheet, then the existing confirm. The Delete entry is admin-only; other users still get the rest of the sheet.

## v1.29.1 — 2026-10-27

- Ghost-action guard broadened: if the AI says it did something ("I've added", "Done!", an action name, etc.) but emitted no JSON, the invoice/estimate chat retries once forcing JSON, then shows a warning. Previously only update_item phrasing was covered.
- Global AI assistant gets the same guard: a completion claim with no write tool called triggers one forced retry, then a warning.
- Per-invoice chat system prompt: stronger rules that every action must carry its JSON block.
- New "AI" pill in the invoice/estimate header opens the AI chat from any tab.

## v1.29.0 — 2026-10-27

- Day clock: a Start Day / End Day button at the top of the More sheet. It tracks the whole workday (drive time included) with no job attached, separate from the per-job clock. Both can be open at once.
- Non-admin users see a "Day started · Xh Ym" banner while their day clock runs; tapping it opens the Time Clock tab.
- Admin Hours tracker: each day cell shows day-clock hours, job hours and, when positive, the drive/other difference. Expanding a worker shows Day, Jobs and Drive/other totals for the range. A date with no day clock is paid on its job entries alone, as before.
- Paid hours are counted once: Payroll, the Time Clock "This week" total and the Hours tracker use the day clock for a date when one exists, instead of adding day and job time together.
- Migration 092: `time_entries.kind` accepts `day`, a day entry cannot carry an invoice, and the one-open-shift index is now one open day plus one open job-type shift per person.

## v1.28.9 — 2026-10-27

- On My Way now texts the client directly instead of opening the Messages app. The button reads the tech's GPS, works out the drive time, and sends "Aloha [first name], your HI Grade Plumbing technician [name] is on the way and will arrive in approximately [X] minutes" from the business Twilio number.
- New `api/on-my-way.js` (edge runtime, so it does not count against the 12-function cap). ETA uses Google Distance Matrix when a Maps key exists, otherwise OSRM; the job's `job_lat`/`job_lng` are used before geocoding the address.
- GPS denied: sends the "will arrive shortly" wording with no ETA. `settings.sms_outbound_enabled` off: the button shows "SMS disabled — enable in Settings" and nothing is sent.
- A successful send is logged to the client's Messages thread and records the `sms_sent` version snapshot.


---

## v1.28.8 — 2026-10-27

- **Admin hours tracker** in Reports, under Payroll (admin only). One row per worker with the week's total hours and a Mon-Sun daily breakdown; defaults to the current week.
- Prev/next arrows step by the range length; two date pickers jump to any custom range (daily columns show for ranges of 7 days or less).
- Tap a worker to list their clock entries (date, start, end, duration, job number or shift kind). Tap an entry to edit start and end; the saved row comes back from the database, so the corrected duration is the trigger's own. Blank end leaves the shift open.
- Open shifts show green with ACTIVE and live elapsed time. Entries corrected by an admin carry a pencil icon.
- New `src/HoursTracker.jsx` and `db.updateTimeEntryTimes()`. No migration: migration 072 already lets an admin update and flags `edited_by_admin`.

## v1.28.7 — 2026-10-27

- History tab: version snapshots now record the event that caused them. Four new tagged snapshots: line item added, line item deleted, email sent, text sent (manual text or On My Way). Each stores who did it (id, display name, tier).
- Migration 091: `invoice_versions.event_type`, `triggered_by`, `triggered_by_name`, `triggered_by_tier` (nullable, additive). Applied.
- `db.recordInvoiceVersion()` takes an optional event type; all snapshots still go through that one function.
- History cards show a readable label ("Line item added", "Email sent", "Text sent") with the actor. Email and text events draw in blue.
- History card dates read `sent_at` (the cards read a `created_at` column that does not exist).

## v1.28.6 — 2026-10-27

- **Clock in/out strip now shows for everyone.** It was gated on `!isAdmin`, so Jake never saw it. Any saved, non-deleted job shows it.
- **Commission techs can edit the job** (migration 090). Line items, pricing, history and photos on any job where the tech is assigned or named as commission tech, not just solo jobs. The commission-only view-only lock and hidden Edit tab are gone.
- **Apprentice limits (UI):** no delete, no Record Payment / Down Payment, no signature controls. Assigned Tech and Apprentice dropdowns were already admin-only. The database still allows payment writes because `save_invoice_with_items` rewrites the set on every save.
- **Tracked edits.** When a non-admin saves a change to line items, `db.upsertInvoice` logs an `items_edited` row in `invoice_events` (editor, tier, add / edit / delete with old and new values). The History tab shows it in purple with an "Edited by apprentice" badge.
- Migration 090: `is_my_assigned_job` / `is_my_assigned_client` also match `commission_tech_id`, `invoices_update_commission` policy, `guard_invoice_assignment` trigger pins `assigned_tech_id` for a commission-only editor. Applied and exercised as the commission apprentice in a rolled-back transaction: edit allowed; reassign (pinned), trash (refused), delete (0 rows), commission change (pinned), other jobs (0 rows).

---

## v1.28.5 — 2026-10-27

- Removed `ApprenticeJobView` and the apprentice-only layout. Every tier now uses the standard invoice/estimate form.
- Permissions live in the form: the assigned tech (apprentices included) and admin edit fully; a commission-only tech gets no Edit tab, no delete, no payment controls, no signature, no version restore. View-as follows the viewed person.
- Call / On My Way / Navigate moved to a compact row at the top of the Preview tab, for non-admin users.
- New clock in / clock out button under the tabs for non-admin users: Clock In, a green Clock Out with elapsed time on this job, or "Clocked in elsewhere" when the open shift is on another job. Uses new `startShift` / `endShift` in `timeclock.js`, which the Time Clock tab now shares.
- Removed the apprentice AI tab.

## v1.28.4 — 2026-10-27

- Apprentice who is the assigned tech on a job is solo: full Edit tab and line items. Commission-only apprentice stays read-only.
- Fixed Messages tab white screen on estimates/invoices: InvoiceForm referenced `clientRecord`, which only exists in another component (ReferenceError outside the error boundary). Now uses the form's selected client.
- Fixed AI tab doing nothing in the apprentice view: tab panels were positioned by a fixed index, so with the Messages tab present (View-as) the AI panel was collapsed. Messages is no longer part of the apprentice tab set.

## v1.28.3 — 2026-10-27

- Apprentice job header is a slim strip: client name with a small status chip, address and phone/time on one line each, and Call / On My Way / Navigate as a single row of compact pills. Internal notes keep their own small card.
- Messages tab on an estimate/invoice no longer risks a white screen. The thread scrolled itself with `scrollIntoView`, which also scrolls the form's overflow-hidden tab track and slides the panel out of view; it now scrolls its own box only. Added null guards on messages and media, and an error boundary so a render error shows a message instead of blanking the app.
- Session persistence: the Supabase client states `persistSession`, `autoRefreshToken` and a storage wrapper that cannot throw, keeping the default storage key so existing sessions survive. The app no longer drops a held session on any auth event except an explicit sign-out, and retries `getSession()` once before showing the login screen after a failed first read.

---

## v1.28.2 — 2026-10-27

- Apprentice job screen is the full read-only invoice again. It opens the normal Preview (line items, prices, totals, customer notes) with a block above it: status, client and address, scheduled time, internal job notes, and the Call / On My Way / Navigate buttons.
- Apprentice tabs are Preview, Photos and AI. Edit and History are hidden (History carries Restore and payment recording), Delete is hidden, Done just closes, and the auto-save flush is skipped so leaving the screen writes nothing.
- AI tab for apprentices is read-only: `AIChatPanel` takes a `readOnly` prop that tells the model not to emit actions and never runs any.
- `ApprenticeJobView.jsx` is now just the header block, rendered inside `InvoiceForm`; the separate full-screen apprentice component is gone from the `App()` render.

---

## v1.28.1 — 2026-10-27

- Texted photos and videos now reach the job. Root cause found by checking the live database: `job_photos_type_check` only allowed `before | after | other`, so `attach_media_to_recent_estimate()` (which inserts `photo` / `video`) failed on every attachment and `sms-inbound` logged and swallowed the error. Migration 089 widens the check. The `job-photos` bucket already had no size or MIME limit, so it needed no change.
- `rehostTwilioMedia()` (`api/_lib/sms.js`): attachments are fetched and uploaded in parallel (`Promise.all`), each retried once, extensions mapped properly (`video/quicktime` to `.mov`, `video/3gpp` to `.3gp`, `jpeg` to `.jpg`), and entries now carry `{ url, type, bytes, twilio_media_sid }`. After two failures the entry is `{ failed: true, twilio_url, type, twilio_media_sid }` instead of being dropped, so a later job can re-fetch it from Twilio. Failed entries are skipped by the estimate attach and the alert email, and the Messages thread shows "Attachment could not be saved".
- `JobPhotos.jsx`: videos render as a `<video>` tile with a play badge in the grid and a `<video controls>` in the full-size viewer; `photo` and `video` get badge colours.
- This does not recover quality lost before Twilio received the file (carrier MMS compression). Re-hosting stores exactly the bytes Twilio served.

## v1.28.0 — 2026-10-27

- Messages tab (admin only) in the bottom bar between Calendar and Clients, with an unread badge. Conversation list from `client_messages` (client name, last-message preview, relative time, unread dot, newest first); tap for an iMessage-style thread: Lisa/outbound blue on the right, client/inbound gray on the left, a time stamp whenever the gap is over an hour, images inline and videos in a `<video controls>`. Opening a thread marks its inbound messages read.
- Reply box in the thread. It posts to `/api/sms-inbound` with the admin session token (no new function, still at the 12 cap): the route checks `profiles.role = 'admin'`, honours `settings.sms_outbound_enabled`, sends through Twilio and logs the row.
- The same thread component (`src/Messages.jsx`) is now a Messages section in the client profile and a Messages tab on estimates/invoices (both admin only; the document tab shows the linked saved client's thread).
- Messages match a client by `client_id`, else by the last 10 digits of the phone, so rows logged before the client existed still show.
- Migration 088: `client_messages.read_at`, existing rows backfilled as read, partial index on unread inbound.

## v1.27.6 — 2026-10-27

- Simplified job screen for apprentices (`src/ApprenticeJobView.jsx`). When the effective user's tier is `apprentice` (the signed-in user, or the person an admin is viewing as), tapping a job shows job title + status, client name, tappable address and phone, scheduled time, job notes, and three buttons: Call, On My Way, Navigate. No line items, pricing, totals, tax, payments, signature or edit controls. Admins and other tiers still get the full form. Deleted-document previews are unaffected.
- On My Way opens the phone's Messages app with the pre-written text (`sms:` link, same pattern as `OnMyWay.jsx` and the send-by-text flow), not Twilio: outbound Twilio SMS is gated off pending A2P 10DLC and would fail silently. The buttons are plain text labels (no emoji, per house rules).

## v1.27.5 — 2026-10-27

- Apprentice on the Google Calendar event. Setting the Apprentice dropdown on a job that has a `gcal_event_id` adds his email as an attendee, so Google sends him the standard invite. Clearing or changing it removes the previous apprentice (Google sends the cancellation). Best effort: a failure is logged and never blocks the save.
- `updateCalendarAttendee(invoiceId, techEmail, prevEmail)` in `src/db.js`, called from `setInvoiceCommissionTech`. Two new named ops in the existing `/api/gcal` route (no new function, still at the cap): `attendee` reads the event's current attendees, adds/removes one, PATCHes with `sendUpdates=all`; `tech_email` looks the email up in auth (not on `profiles`, which is world-readable). Both admin only.
- Only the job's first event (`gcal_event_id`) is updated; later entries in `visits` are not.

## v1.27.4 — 2026-10-27

- View-as fix: it is a UI filter on already-loaded data (the queries still run as the admin), and it matched `ownerId` only. Jobs Jake created and assigned to Kaulana are owned by Jake, so "view as Kaulana" showed an empty list. It now mirrors `invoices_select`: owned, assigned (`assignedTechId`), or commission job (`commissionTechId`, non-deleted). Clients follow the assigned jobs. Migration 086 was confirmed live in `pg_policies`; the policy was never the problem.
- Tiered weekly commission in Payroll (reads `tech_commission_tiers`, migration 080). New "This Week" (Mon-Sun) period. Each week's collected total on the tech's commission jobs picks one rate for the whole week; commission is that rate times collected minus parts cost. Month and year sum per-week results. A tech with no tier rows falls back to the flat `tech_pay.commission_pct`. Card shows collected, tier hit, hourly, commission.

## v1.27.3 — 2026-10-27

- Apprentice visibility (migration 086): `invoices_select` now admits `commission_tech_id = auth.uid()` on non-deleted jobs. Verified as Kaulana in a rolled-back transaction: sees his 3 commission jobs and no others, sees no line items (081 unchanged), and an UPDATE touches 0 rows. The form opens view-only for him (Preview tab, Edit disabled, no auto-save, no delete, Done just closes).
- Material cost is now a list of entries (description + amount) with a running total and "+ Add material". New `invoices.material_entries` jsonb (migration 087); `material_cost` is written as their sum, so commission is unchanged. `guard_invoice_commission` pins the new column against non-admins.
- Removed the Saved button and panel from Line Items. It listed the same `savedItems` the Price Book already shows, so nothing was lost.
- Settings: the per-user commission field is relabelled "Base Rate % (flat fallback, overridden by tiers)". The note says plainly that the pay report still reads only this rate; `tech_commission_tiers` is not wired into it yet.

## v1.27.2 — 2026-10-27

- Edit tab: the commission dropdown is now labelled **Apprentice** and shows on any document that has an id (it also checks `form.id`, not just the prop and the auto-save id). Assigned Tech no longer requires more than one user.
- Apprentice lists only `apprentice` tier profiles; Assigned Tech lists `service_tech`, `journeyman` and `admin`. A value already set stays visible even if its tier no longer matches.
- Migration 085: Kaulana filed as `apprentice`.

## v1.27.1 — 2026-10-27

- Merged the `technician` tier into `service_tech` (migration 084). Settings, the roster and the scorecard fallbacks now use `service_tech`; `setUserTier` no longer accepts `technician`.
- Migrations 083 (new logins start as `pending`) and 078 (apprentice $25/hr) applied.

## v1.27.0 — 2026-10-27

### Employee onboarding page and the Journeyman tier (migrations 082, 083)

- **`/welcome`.** The invite email now links to the app, not raw Supabase. The page opens the invite
  with `verifyOtp`, asks for full name, phone and a password, then signs the person in. The link skips
  Supabase's `/verify` so email scanners cannot use up the one-time token. Template text to paste into
  the dashboard is in `docs/invite-email-template.md`.
- **Pending setup screen.** A new login is filed as tier `pending` (083) and sees only "Your account is
  being configured" until Jake picks a tier in Settings. The screen re-checks on focus and every 30s.
  Settings marks such people "Needs a role".
- **New tier values (082).** `journeyman`, `service_tech` and `pending` are accepted by `profiles.tier`.
  Settings gets a Journeyman button. No permissions change: the tier plan is written up in `CLAUDE.md`
  under "Employee tiers", and nothing enforces it yet.
- Migration 083 is written and dry-run but not applied; apply it when this build deploys.

---

## v1.26.0 — 2026-10-26

### Commission is a per-job call Jake makes, with pay rates kept private (migration 075)

- **One flag per invoice, not an automated rule.** Jake's own framing: "I can say which job he
  should get paid commission for." `commission_tech_id` names who earns it; `NULL` means
  hourly only. The three-part test he described — solo, he sold it, he collected it — is the
  checklist Jake runs before setting the flag, not three new tracked signals. "On the job"
  already has a field: a job assigned to Jake is a job Jake is on, by construction.
  "Collected it" is enforced by *when* commission counts, not a new column: it's realized only
  once the invoice is actually `paid`.
- **Material cost is a field Jake fills in per job**, by his own choice over auto-summing
  receipts. Commission pays on `calcTotals(invoice).total` minus this — the one function this
  app already uses everywhere else for a total, not a new copy of it.
- **Both fields are pinned at the database, not just hidden in the UI.** A trigger reverts any
  non-admin attempt to touch either one, even inside an otherwise-ordinary save of a job
  assigned to him. Verified by attacking it as the apprentice: stealing the flag for himself,
  zeroing the material cost, both while legitimately saving his own assigned job. Pinned to
  whatever Jake had set; Jake's own changes still go through.
- **Pay rates live in their own table, not on `profiles`.** `profiles` is deliberately world
  readable — every picker needs every display name — which would have made an hourly rate
  readable by anyone who can log in. `tech_pay` is self-or-admin only. Verified: the apprentice
  can read his own rate, reads zero rows of Jake's, and an attempt to raise his own rate is
  silently filtered to nothing.
- **A Payroll card in Reports**, This Month / This Year, hourly minutes from the time clock
  times the rate plus commission from paid, flagged jobs minus material cost times the
  percentage. Admin sees everyone; a tech sees only himself — reusing the same
  `users`-is-admin-only-populated workaround `TechScorecard` already needed, which a first pass
  missed and would have rendered nothing for a non-admin at all.
- Settings gets a $/hr and Commission % box next to each person's tier buttons, synced to the
  async-loaded rate via a keyed remount — a plain `defaultValue` would have shown blank even
  with a rate already on file, since it only applies on first mount.

## v1.25.0 — 2026-10-26

### Clock in and clock out on a job, with GPS at both ends (migrations 071, 072, 073)

- **A Time Clock tab.** One button. Pick a job — today's work sorts to the top — or clock on
  to Driving, a Supply run, Shop time or Other, because drive and shop hours are paid hours and
  a timesheet that can't hold them is one Jake fixes by hand every week. An open shift shows a
  running total in the header from every tab, so a forgotten clock-out can't quietly become a
  week-old argument.
- **The phone supplies its position and nothing else.** Distance to the job, whether that
  counts as on site, and how many minutes a shift ran are all computed by a database trigger.
  Proven by sending a deliberately false payload — 480 minutes and 0 metres on an off-site
  clock-in — and watching every value get recomputed and discarded.
- **Off site clocks in anyway, and texts Jake immediately.** Jake's call: a bad GPS fix in a
  crawlspace must not lock a man out of his own timesheet. The entry is stamped with the
  distance, flagged for review, and the database texts Jake through Twilio.
- **No GPS fix reads as unknown, never as off site.** Three states, not two. An unknown
  location raises no alert and accuses nobody.
- **What a tech cannot do:** be on the clock twice at once, reopen a closed shift, backdate his
  own start, log hours against anyone else, or delete a shift. Each one attempted as a
  non-admin and refused. Jake can edit any entry; an edited one is marked as edited.
- **The geofence centre is the geocoded job address,** cached on first use so a clock-in in a
  dead zone needs no network. A tech may fill it in when it's empty and cannot move one that's
  already set. A weak geocode is rejected rather than stored — Google answers an unrecognised
  address with the middle of a zip code, and a geofence that size would call everywhere on site.
  `/api/geocode` now returns coordinates; no new Vercel function, so the 12-function cap holds.
- **Radius is `settings.geofence_radius_m`, default 150m,** so the first long driveway or condo
  tower that throws a false flag is a one-line fix, not a migration.

### The database can text Jake (migration 073)

- **`send_owner_sms()` sends through Twilio from Postgres,** using the `http` extension, since
  Twilio needs form-encoded parameters that pg_net cannot produce and no API route here relays
  SMS. SECURITY DEFINER: an apprentice triggers the text but cannot read the credentials that
  send it, which migration 070 had just taken away from him.
- **It records Twilio's own message SID and status rather than assuming.**
  `references/a2p-10dlc.md` warned that Twilio answers 201 on a message a carrier later drops —
  exactly how the old error-30034 failures looked like successes for a week.
- **First real send verified 2026-10-26.** Twilio's record came back `delivered`, no error code.
  That also closes the open item in `a2p-10dlc.md`: the app's own send path had never sent
  anything until now.

### An apprentice fills out his own skill sheet (migration 071)

- **Two numbers per skill, not one.** `level` is Jake's sign-off and is still the only thing the
  graduation gate reads. `self_level` is the apprentice's own claim, which he writes himself.
  They're useful exactly where they disagree: claims Solo but signed at Assisted means check
  him; signed at Solo but claims Watched means he doesn't know he's trusted yet. Jake's view
  flags only a claim that runs *ahead* of the sign-off.
- **Enforced by a trigger, not a policy or a grant.** RLS can't restrict which columns an UPDATE
  touches, and column grants are per-role — the owner is the same `authenticated` role as the
  apprentice, so revoking table UPDATE to grant the self columns would have stopped Jake
  writing `level` too.
- **Verified by attacking it as the apprentice:** raising one level, raising all sixty at once,
  raising one through an upsert, creating a brand-new row pre-signed at Solo, forging the
  sign-off trail, and deleting a row to erase a sign-off. All refused or neutralised; only the
  claim lands. Jake's sign-off still works and still stamps who signed it.
- Commission is no longer described as starting at Service Technician — it's a per-job test now
  (solo, sold it, collected it), so the copy that said otherwise was wrong.

## v1.24.0 — 2026-10-26

### An apprentice can actually work a job you assign him (migrations 069, 070)

- **The gap.** Migration 053 let an assigned tech *see* the invoice row and stopped there.
  Checked against production by assuming a non-admin account's identity: the line items, the
  client record, the payments and every write were all still gated on `owner_id`. Assigning a
  job to an apprentice gave him a client name, an address and a calendar slot — no scope of
  work, a $0 total, no phone number, and no way to save anything.
- **Access to a job's parts now follows the job, not whoever typed them in.** Line items,
  payments, photos, history and the client's contact record are reached through the parent
  invoice via two new linkage helpers, `is_my_assigned_job()` and `is_my_assigned_client()`.
  `owner_id` on a child row is set by a trigger to whoever inserted it, which makes it
  useless as an access key the moment two people touch one job.
- **He can:** read and edit the jobs assigned to him, including pricing and payments, update
  that client's contact details, add photos, and create his own documents under his own name.
- **He cannot:** trash a job, restore one, reassign it, unassign himself, or see any job that
  is not his — verified by attempting each one as a non-admin and being refused.
- **Read without write would have been worse than nothing.** `save_invoice_with_items` does a
  DELETE-then-INSERT of the whole payment set on every save, and RLS silently filters a DELETE
  to zero rows instead of erroring. A tech who could read payments but not delete them would
  have inserted a duplicate payment row on every single save.
- **A save no longer transfers ownership of the document.** The RPC ended with
  `owner_id = excluded.owner_id`, which is whoever saved last — migration 053's own header
  called this out. Harmless while only the owner could write; with an assigned tech who can
  write, Jake's job would have changed hands the first time the apprentice saved it.

### The settings table is no longer readable by anyone who can log in (migration 070)

- **`settings` had one policy: `for all using (true)` to every authenticated user.** Confirmed
  against production that a non-admin account could read `twilio_sid`, `twilio_token`,
  `vapi_private_key` and `lead_secret`, and could have flipped `outbound_calls_enabled`.
  Theoretical while Jake was the only login; not theoretical once an employee has one.
- **Credentials, webhook secrets, kill switches and the alert destinations are admin-only now.**
  A deny-list, not an allow-list, so a new piece of ordinary business config keeps working for
  a tech without a migration — a new *secret* is the thing that has to be named.
- **The document counters are carved out and that carve-out is load-bearing.**
  `save_invoice_with_items` is SECURITY INVOKER and ends by upserting `next_num`, so without
  the exception a non-admin creating any document at all would have failed on the last
  statement of the save. Exercised for real: a non-admin new-invoice save now completes.
- **The four shop-config cards in Settings are admin-only in the UI to match.** Writes to those
  keys fail *silently* (RLS filters the row rather than erroring), so a tech would have seen a
  successful save that did nothing.
- **Job photos are scoped to the jobs you can see.** Was 222 photos of every customer's house
  to any account that could log in. The public estimate page is unaffected — it reads
  server-side under its own key.

## v1.23.0 — 2026-10-27

### Play Lisa's call recordings in the app (migration 067)

- **"Call recordings · Lisa" on the estimate.** Under Internal Notes, admins see every call
  linked to the job with its time and length, and a Play button. Shows on the converted
  invoice too. Nothing appears on a job with no calls.
- **The Call record email's "Listen" button now opens the app's player** (`/?call=<id>`),
  with the Vapi dashboard kept as a secondary link.
- **How it works.** `/api/vapi-call-ended` now saves each call's Vapi id against its estimate
  in the new `vapi_calls` table. Pressing Play asks the same route (`GET ?recording=<id>`,
  admin session required) for a short-lived link from Vapi's recording endpoint. No audio
  is stored by us, and no new function was added, so the 12-function cap still holds.
- **Older calls:** only abandoned calls had their call id saved, so those are linked by the
  migration. Calls Lisa completed before today stay reachable from their Call record email.

## v1.22.4 — 2026-10-27

### Lisa back on the shared document counter (migration 066)

- 065 was meant to move `create_estimate_from_lead` onto `allocate_doc_number()` and
  skipped it: its exact-text match missed the live function. Checked live afterwards, Lisa
  still minted from `next_estimate_num`, so an estimate she filed could take a number whose
  paired `INV` already existed, and conversion would then give it a different number.
- 066 finds the block by its first and last lines and must match exactly once, or nothing
  changes. The visit and Hawaii-time changes from 065 are verified live and untouched.

## v1.22.3 — 2026-10-27

- Migration 065 now stops, changing nothing, if more than one `create_estimate_from_lead`
  signature exists, instead of patching whichever one Postgres lists first. Not yet applied,
  so nothing to re-run.

## v1.22.2 — 2026-10-27

### Lisa's bookings now land as a real visit (migration 065)

- **`create_estimate_from_lead` writes `visits`.** An appointment Lisa books used to be
  stored only in `gcal_date`, which since migration 044 is derived from `visits`. So the
  manager bot, the chat agent and the app's calendar sync could not see or move her jobs.
  The visit is written in the same insert, so the Google push is unchanged, and the
  calendar callback (047) already writes the event id into that visit.
- **Two regressions restored in the same function.** Migrations 062 and 063 were written
  from an old copy of it, which dropped the Hawaii time fix (049: calls after 2pm were
  dated tomorrow) and the shared document counter. 065 restores both, only where missing.
- SQL only. No app code changed.

## v1.22.1 — 2026-10-27

### Calendar: a job no longer shows twice (blue Job plus grey "Other")

**What was happening.** The calendar already hides `gcal_date` when a job has `visits`,
so the grey block was not `gcal_date`. It was a second Google event. When a writer
outside the app (Lani) stored a visit with no `eventId` while a Google event for that
booking already existed, the sync created a fresh event for the visit. The original was
then linked to nothing and drew as grey "Other" next to the blue job.

- **The sync adopts the existing event instead of creating a duplicate.** A visit with no
  `eventId` first looks for an unclaimed Google event that names its document number,
  at the same start time (or the only one on that day). The link is saved to the visit.
- **The calendar folds that event into the job** even before the sync has saved the link.
- **Duplicates made before this fix stop drawing.** An unlinked event naming a document
  that already has a job block at the same minute is hidden. It still exists in Google
  Calendar until deleted there.

## v1.22.0 — 2026-10-24

### Unblock deploys: back under Vercel's 12-function limit

**The site had been serving a five-day-old build since 2026-10-18.** Every deploy since
then failed, and the failure was close to invisible: the build succeeded, `vite build`
passed locally and in CI, the release check went green, and the deployment just read
`status ● Error` at "Deploying outputs…" with no message in the build log.

The cause was Vercel's **Hobby limit of 12 nodejs functions per deployment**. The project
had been sitting on exactly 12 and `api/schedule-request.js` made it 13. Nothing was wrong
with the code, which is why nothing found in the code fixed it.

- **The client extractor moved to `api/_lib/extract-client.js`** and is reached through
  `POST /api/ai-estimator` with `{ task: 'extract_client' }`. Files under `api/_lib/` are not
  deployed as routes, so this frees the slot. It cost nothing: its only caller has always
  been `public/estimator-test.html`, never the app, so it never needed a public endpoint.
- Six routes are already `runtime: 'edge'` and do not count toward the limit. That is the
  other way to add one safely.
- **`CLAUDE.md` now carries the ceiling, the count command and the symptom**, because the
  expensive part of this was not the fix but the five days of looking in the wrong place.

Also worth knowing: `ai-estimator.js` asks for `maxDuration: 90` and has been silently
clamped to **10s** the whole time it has been on Hobby.

## v1.21.4 — 2026-10-23

### Long-pressing a client's name no longer selects it as text

The actual bug behind the long-standing "iPhone customer-info text-selection"
report, which two sessions had been chasing as a page-drag problem.

- **The client list row and the client detail header had no selection guard.**
  `InvoiceListCard` and `EstimateListCard` have carried
  `userSelect` / `WebkitUserSelect` / `WebkitTouchCallout: none` since bug #6;
  the client cards were missed. Both are whole-card buttons that open the
  client, so a long-press could only ever produce an iOS selection and callout
  over a name nobody wanted to copy.
- **Only the non-editable displays changed.** `ClientEditFields` keeps its
  inputs fully selectable, since you cannot edit a name you cannot put a caret
  in, and the client detail **body** stays selectable on purpose — copying an
  address or a phone number out of it is useful on a job.
- **The v1.21.1 touch guard stays.** It fixed a real and separate defect:
  pull-to-refresh and edge-swipe-back both armed inside text inputs. Jake
  testing it on live v1.21.1 and seeing no change is what told the two defects
  apart.

## v1.21.3 — 2026-10-21

### Renumber the canonicalizer fix to 064, and document the two migrations that were missing

Bookkeeping only. No schema change, no app change.

- **The blank-handling fix shipped as a second `062`.** `062_lead_channel_attribution.sql`
  and `063_lead_owner_and_local_appointment.sql` had already landed, but neither was added
  to the migrations list in `CLAUDE.md`, so the list still said 062 was next. Renamed to
  `064_canonical_method_trims_blank.sql`. The SQL was already applied under the old name and
  is `create or replace`, so this is naming only.
- **062 and 063 are now in the migrations list**, which is what would have prevented this.
  The list has now been behind the directory twice — it is also how there came to be two
  `059` files — so the "next migration" note says to check `ls supabase/migrations/` first.

## v1.21.2 — 2026-10-20

### Migrations 061 and 064 applied, and the canonicalizer now matches the app exactly

The v1.21.0 trigger finally ran, and testing it against the JS turned up one
real divergence, fixed in 062.

- **061 applied and verified.** `trg_payments_canonical_method` is present in
  `pg_trigger`, and it was proven to actually fire rather than merely exist: an
  `update` setting a method to `'  cHeCk  '` inside a rolled-back transaction
  came back as `'Check'`. Its repair `update` touched 0 rows, as expected.
- **064 fixes a blank-handling bug in 061.** (Written as 062, renumbered: 062 and 063
  had already landed from another session without reaching the migrations list in
  `CLAUDE.md`, so the list said 062 was free when it was not.)
  `canonical_payment_method('   ')` returned `'   '`, where the JS returns `''`.
  061 detected the blank correctly and then returned its argument instead of
  the trimmed value. Three spaces is strictly worse to store than an empty
  string: it is falsy in neither SQL nor JS, so it survives every `<> ''` guard
  while rendering as nothing at all.
- **Parity is now proven, not asserted.** All 28 inputs — the eight labels, the
  three aliases, the uppercase legacy spellings, the pass-through values, blank
  and whitespace-only — produce byte-identical output from
  `canonical_payment_method()` and `canonicalMethod()`. `null` still comes back
  as `null` from SQL and `''` from JS, which is deliberate: the column stays
  honestly null while the app hands callers a string to apply their own
  fallback wording to.
- No app code changed. The version moves because `supabase/migrations/` is in
  the release-check path set.

## v1.21.1 — 2026-10-18

### Pull-to-refresh and edge-swipe no longer arm inside a text field

Likely the long-standing "iPhone customer-info text-selection drags the page"
bug, open and unreproduced since 2026-08-26. **Not confirmed on a device** —
see the caveat below — but correct on its own merits either way.

- **Two document-level, non-passive touch handlers had no text-field guard.**
  Pull-to-refresh (`onStart`) armed on any single-finger touch while the page
  was at scroll top in the list view, checking only for modals and nested
  scrollers. Clients > a client > Edit is the one screen where customer-info
  inputs are plain page content, at scroll top, with `view` still `'list'` —
  `ClientsTab` is mounted ungated, so editing a client never changes `view`.
  A long-press in Name/Email/Phone and any downward drag past 8px therefore
  locked the gesture, ran `preventDefault()` on every subsequent move, and
  pulled the refresh spinner down while the user was trying to extend a
  selection.
- **The same guard was added to the edge-swipe-back handler**, which arms
  within 22px of the left edge. The edit page's inputs start at x=16, so a
  touch in an input's left padding could arm it, and a rightward drag fires
  app-back, which `ClientsTab` handles by clearing the draft. Less likely to
  trigger, worse when it does.
- **This is not a new idea.** Commit `404696e` ("Fix iPhone text-selection drag
  in inputs", bug #6) added exactly this guard to the tab swiper in May, after
  the same behaviour was seen on a real device shoving the chat box around. It
  was never applied to these two handlers. The code added here is that guard.

**Caveat, stated plainly.** No device was available, so this was found by
reading. The arming conditions, the missing guard and the field positions are
all verified in the source, but two things are inferred: whether iOS keeps
dispatching cancelable `touchmove` through a long-press selection rather than
firing `touchcancel`, and the report's literal wording — the handler moves the
fixed spinner and cancels the native gesture rather than translating page
content. To confirm or kill it: long-press the Name field in Clients > a client
> Edit at scroll top and drag down. The bug stays open in `CLAUDE.md` until
that is done.

## v1.21.0 — 2026-10-18

### One spelling per payment method, everywhere (migration 061)

`payments.method` is plain text with no constraint, and until 2026-10-16 the
table held fifteen spellings of eight methods — "CHECK" on 207 rows, "Check"
on 41, "check" on 1, plus "PAYPAL", "CASH", "OTHER", "CREDIT CARD" and three
labels inherited from the old app. Those rows were repaired on 2026-10-16, but
every reader in the app was still case-sensitive, so the defect was latent
rather than gone: one free-text write and the same mess came back.

- **New `src/paymentMethods.js`** — one canonical vocabulary, one
  `canonicalMethod()`, one colour-and-glyph table. Two rules, in order: fold
  case against the eight methods, then leave an unrecognised value alone.
  Passing an unknown value through is deliberate — relabelling a method we do
  not recognise would quietly rewrite what was actually recorded, and a
  payment is money. The case-insensitive match that v1.16.1 added inside the
  payment modal is now the shared rule instead of a local one.
- **Revenue by Method was splitting one method across several rows.** The
  Reports tab grouped on the raw stored string, so "CHECK", "Check" and
  "check" were three rows that each understated their total and their
  percentage, and the chart's ordering was wrong. Replayed against the
  pre-repair snapshot, the fix collapses 15 rows to 10 and consolidates Check
  from three rows into one, with the overall total unchanged.
- **Three colour palettes collapsed into one.** The invoice form, the Payments
  tab and the Reports tab each carried a near-duplicate map. This changes no
  pixel — only the Reports copy had an explicit `Other` key, but the other two
  fell through to the same grey and the same glyph — so it is a
  one-place-to-add-a-method change, not a rendering fix.
- **The AI chat was being told to write an invalid value.** The
  `record_payment` tool described its method as "Cash, Check, Venmo, Zelle,
  Card, PayPal, ..." — and "Card" is not a method the app knows. It is now an
  enum of the eight real ones, which was the only method vocabulary any model
  ever saw. `recordPayment` canonicalizes what comes back regardless.
- **Normalized at the chokepoints**, not at each render: both payment mappings
  in `db.js`, and the public-viewer mapping that feeds the customer-facing
  PAYMENT HISTORY block in both the desktop and mobile layouts. The paid-in-full
  receipt email no longer says "Paid by CHECK".
- **A backup restore can no longer undo the repair.** `importBackup` upserts
  raw snapshot rows straight past `db.js` and the save RPC, and the pre-repair
  snapshots are still on disk — one restore would have put all fifteen
  spellings back. It canonicalizes payment rows on the way in now.
- **Migration 061 makes it durable below the app**: a `before insert or update`
  trigger on `payments` mirroring `canonicalMethod()` exactly, so the Telegram
  manager, a REST write and a restore all land canonical. A trigger rather than
  a check constraint, so an unrecognised label is kept rather than rejected.
  Deliberately not `initcap()`, which turns 'PAYPAL' into 'Paypal'.
- Also fixed: the invoice history timeline rendered "undefined payment
  received" for a payment with no method.

## v1.20.0 — 2026-10-12

### AI chat prices estimates from the book, then checks the market
- The chat agent can search the web (`web_search`, server-side, up to 4
  searches per call, located in Honolulu). It uses it to check what Oahu
  plumbers charge for a job with no saved price over about $500, for any
  multi-line job, and when asked whether a price is right.
- Pricing rules in `AGENT_SYSTEM`: price book first and always wins; then
  materials plus 35% or the labor floor ($185 / $400 / $800); travel zones
  rolled in; then a market check. Target is the upper part of the Honolulu
  range, never below the middle and never the cheapest. A saved price that
  looks low against the market is kept but flagged to Jake.
- Bigger jobs get one line item per distinct piece of work instead of a
  single flat line. Simple jobs stay one line. Assumptions go in the reply,
  not on the customer's document.
- `search_price_book` matches on any word, best match first, instead of
  requiring every word. "toilet angle stop" now finds "Toilet Repair".
- The agent loop resumes a `pause_turn` from the server-side search.

---

## v1.19.2 — 2026-10-12

### AI chat bookings show on the job right away
- When the assistant booked a visit and made another change to the same
  document in the same step (set the job site, for one), the second change
  started from a copy taken before the booking and put the document back
  into the app without its visit. The Calendar tab then showed the Google
  event as "Other" instead of on the estimate until the next reload. The
  database had the visit the whole time. `handleGlobalAIAction` now updates
  `dataRef` the moment it writes, so each step sees the one before it.
- A full save of a document no longer drops a visit's `kind`, `builtBy` or
  `pending` (`upsertInvoice` in `src/db.js`). An Emergency visit kept its
  colour only until the next edit.

---

## v1.19.1 — 2026-10-07

### Unsent tab on the estimate list
- Estimates get the same **Unsent** tab, between Open and Closed, using the
  same rules as the invoice list (`unsentIdsFor`). An estimate whose converted
  invoice was sent does not show. The year filter still applies.

---

## v1.19.0 — 2026-10-07

### Unsent tab on the invoice list
- New **Unsent** tab between Outstanding and Paid: invoices never sent to the
  client. Same rules as the SQL Jake uses: no `sent` row in `invoice_events`,
  not paid or void, no payments, not converted from an estimate, and (for an
  estimate) its converted invoice was not sent.
- `loadAll` reads the ids of every sent document once, separately from the
  main load so a failure only empties this tab. Sending a document removes it
  from Unsent right away, no reload needed.

---

## v1.18.1 — 2026-10-07

### Fix: GE number label read "GE GE-..."
- The GE half tax line printed the label and the number's own prefix back to
  back. It now reads "Tax ID GE-187-330-7136-01" on the preview, customer link
  and PDF.

---

## v1.18.0 — 2026-10-07

### GE half tax per client
- New **GE half tax (0.5%)** switch on the client edit screen, for general
  contractors we sub for. Needs migration 059 (`clients.ge_half_tax`); until it
  runs, client saves still work and the switch just doesn't stick.
- Picking a GE client on a new invoice sets tax to 0.5%. Moving to a non-GE
  client puts 4.712% back. Turning the switch on or off while editing the
  client from inside an invoice applies to that invoice too.
- The invoice form shows a **GE half tax** toggle under Tax % when the client
  has it on (or the invoice is already at 0.5%), so one invoice can go back to
  4.712%.
- A 0.5% invoice prints the GE license number (GE-187-330-7136-01, labelled "Tax ID") on the
  in-app preview, the customer link (both layouts) and the PDF.
- AI-created documents for a GE client default to 0.5% too.
- No invoice column: an invoice is GE half tax exactly when its rate is 0.5
  (`src/geTax.js`).

---

## v1.17.2 — 2026-10-02

### Fix: job photos missing from the customer link on desktop
- `PublicViewerPage` has two layouts. The mobile one renders through `PDFPreview` and
  showed photos; the desktop one (900px and wider) builds its own sheet and had no photo
  section at all, so a customer opening their link on a computer never saw them.
- The desktop sheet now has a Job Photos section after Notes: Before and After side by
  side, everything else under Additional Photos in a two-column grid. Untyped photos are
  shown there rather than dropped.

---

## v1.17.1 — 2026-10-02

### Fix: opening an invoice blanked the whole app
- The Clear billing address button added in v1.17.0 read `bill`, a variable that only
  exists in `PDFPreview`, not in `InvoiceForm`. Opening any document whose client has
  at least one property threw a ReferenceError on render and React unmounted the app,
  leaving a white screen. `InvoiceForm` now resolves its own billing lines
  (`formBill`, via `resolveBillTo`). The build did not catch it because esbuild does not
  scope-check; an eslint `no-undef` pass over `src/App.jsx` now comes back clean.

---

## v1.17.0 — 2026-10-02

### Document numbers are issued by the database, not the browser (migration 060)
- **`mintDocId` now calls `allocate_doc_number()`** instead of incrementing a counter
  seeded from the snapshot loaded at app start. That counter was only ever right for
  a single tab, and the app is not the only writer: a second device, the Telegram
  manager bot, the AI receptionist and direct SQL all create documents. Whoever read
  it second issued a number the first had already taken.
- **The damage was to estimate/invoice pairing, not to ids.** `convertInvoice` reuses
  the estimate's number, so EST1040 becomes INV1040 — but only while INV1040 is free.
  Once an unrelated job holds it, conversion mints a fresh number and that pair is
  mismatched for good. EST1035 (took 1035, already held by INV1035) and EST1040
  (re-issued to another client the next day) are both exactly this. Neither can be
  repaired: INV1035, INV1036 and INV1040 have all been sent and opened.
- **The allocator takes a row lock on `settings.next_doc_num`**, so callers queue
  instead of each reading the same value, and it is clamped to one above the highest
  number in use — soft-deleted rows included — so a stale or hand-edited counter
  cannot re-issue a number already printed on something a customer has seen.
  `SECURITY DEFINER` with a pinned `search_path`, and `EXECUTE` revoked from `anon`,
  which Supabase grants by default and `REVOKE FROM PUBLIC` does not take back.
- **Falls back to the local counter if the call fails.** A plumber under a house with
  no signal still has to be able to write an invoice, and a rare collision beats a
  blocked job. The local ref is advanced past whatever the server issued.
- Still outstanding: `create_estimate_from_lead` mints by scanning `max(id)` rather
  than calling the allocator, so the AI receptionist remains an independent writer.

### Fix: a billing address that only restates the job site is no longer kept
- A client created with the complex **name** in `billing_address` ("Makani Kai") had
  it inherited onto a document by the autosave, and the PDF then split in two and
  printed "Billing Address: Makani Kai" — a building name, not somewhere a cheque can
  go. The lines differ as strings, so the old equality check for "same place typed
  twice" never caught it. `isJobSiteEcho()` now recognises both shapes.
- Applied at save, so one is never written onto a document again, **and** at render,
  so documents already carrying one stop printing the block without anyone having to
  go repair the data. A real billing address at a different street still splits.
- **New "Clear billing address" button** next to the Show billing address checkbox.
  The checkbox only ever hid the block while the value stayed on the document and in
  the client record, so a wrong billing address could not be removed from that screen
  at all — which is how EST1040 got fixed by hand in SQL five times, each one
  overwritten by the open form's next autosave.

### Fix: saving a document no longer drops internal notes (migration 059)
- `internal_notes` has been a column on `invoices` for a while but was never in
  `save_invoice_with_items`'s insert column list, so every caller that passed it lost
  the value with no error and no warning. Found while writing EST1040: the
  assumptions behind a ballpark quote went in, the RPC returned success, and the
  field came back null.
- An absent key preserves, an explicit empty string clears. The app's editor sends
  the whole document so it can still clear the field by saving an empty box; the
  manager bot patches a few fields at a time and must not wipe notes typed on the
  phone.

### Competency catalog wording
- A skill label no longer carries an owner's name. The apprentice sees this catalog
  in the app, and the hire-facing docs are written in company voice.

## v1.16.2 — 2026-10-02

### New documents default the assigned tech to whoever created them (migration 058)
- A new invoice or estimate opens with the Assigned Tech set to you instead of
  Unassigned. Documents made by the chat agent show it right away too.
- Lisa's leads and the PayPal down-payment invoice used to land Unassigned,
  because they bypass the app's save. A new database trigger fills a missing
  assigned tech from the document's owner on insert, so they now default to
  Jake. A plumber's own documents default to that plumber.
- The PayPal down-payment invoice carries the estimate's assigned tech.
- Existing jobs are untouched; one set to Unassigned on purpose stays that way.

## v1.16.1 — 2026-10-01

### Fix: editing a payment always showed Cash
- The payment edit modal now pre-selects the saved method. Payments written by the
  AI agent or outside writers can store the method in a different case (`"check"`),
  which matched none of the select's options, so it fell back to Cash and a save
  would have overwritten the real method. The match is now case-insensitive, and
  an unrecognised method shows as its own option instead of being replaced.

## v1.16.0 — 2026-09-30

### Estimates can be marked declined (migration 056)
- **"Customer declined" on the estimate long-press menu**, with a reason picker
  (too expensive, went with someone else, job cancelled, never heard back,
  doing it themselves, or skip). A declined estimate drops off the open list and
  shows a red "Declined" pill. The same menu item becomes "Put back in play" to
  undo it. Until now the only way to stop chasing an estimate was to type a
  phrase into the notes for the follow-up script to grep.
- **Declined does not count as closed-won.** The Close Rate and Closed figures
  on the estimates KPI strip now use won (approved or converted) rather than
  closed, so turning a job down can no longer raise the close rate.
- **Written through a narrow RPC, `set_estimate_declined`, not
  `save_invoice_with_items`.** That function enumerates and overwrites its
  columns on every save, which is how `owner_id` ends up restamped to whoever
  saved last. A dedicated RPC means an ordinary edit to a declined estimate
  cannot silently revive it. It refuses an invoice, a missing id, and an
  estimate already converted to an invoice.

### Estimates expire after 30 days
- **New `estimate_valid_days` setting, 30 by default.** Past that window an
  estimate shows an orange "Expired" pill instead of "Open", because the price
  is stale and the job wants redoing or repricing rather than another nudge.
- The daily follow-up briefing in the AI-OS repo reads the same setting, so the
  app and the morning list can never disagree about what has gone cold.

## v1.15.2 — 2026-09-30

### Database: invoice reminders (migration 055)
- **New `invoice_reminders` table** for the automated overdue-invoice
  reminders, which run as a daily script in the AI-OS repo rather than in the
  app. One row per invoice per tier (1, 7, 14, 30 days past due); a tier can
  only be recorded as sent once, so a double run cannot double-text anyone.
- **New `invoice_followup_live` setting**, `false` by default. Until it is
  flipped, the script sends Jake a Telegram preview of every message and
  nothing reaches a customer.
- No app code changed. Docs note that the script mirrors `calcTotals` and
  `calcLateFee`, so the two must stay in step.

## v1.15.1 — 2026-09-30

### Chat agent: screenshots
- **A screenshot stays readable for the next few messages.** Before, the chat
  saw an image only on the message it came with, so answering its follow-up
  question ("which address?", "yes, book it") left it working from memory of
  the picture. Up to 4 recent images now ride along for 6 messages.
- **Screenshot playbook in the prompt.** Reads name, phone, address, the work
  and the agreed time (latest time both sides agreed to, not one only
  proposed); looks the person up by phone first, then name. A screenshot with
  instructions is acted on directly. A screenshot on its own gets a one-line
  summary and proposed actions to confirm with a yes. Cut-off or unreadable
  details are called out instead of guessed.

---

## v1.15.0 — 2026-09-30

### Chat agent: job sites and scheduling onto the job
- **Add a job site from chat.** "Add 742 Kapahulu Ave to Karen as the
  Kapahulu rental" saves a property on the client, same format as Add
  Property in the app. Refuses to add the same street twice.
- **New documents get a job site.** Estimates and invoices created from chat
  used to have no job address or client link, so they printed without one and
  a booking on them had no calendar location. They now take the named job site
  (by name, nickname or street), or the client's first one, like the form. If
  a name matches two properties it asks which.
- **Move a document to another job site** from chat.
- **Booking attaches to the job.** Scheduling used to drop a bare Google event
  that no estimate or invoice knew about, so it never showed on the job and
  could not be moved from the app. With a document it now adds a visit to that
  job, exactly like the Schedule button: shows in the app's schedule, uses the
  job site as the location, several visits per job allowed. An appointment Lisa
  booked is kept, not overwritten. If Google Calendar is not reachable the
  visit is still saved and syncs later, and the chat says so instead of
  calling it booked.

---

## v1.14.0 — 2026-09-30

### The app-wide AI chat is now a real agent
The chat behind the header's AI button now works the way the Telegram agent
does: it calls tools, sees what came back, and keeps going until the job is
done. Before, it was one model call that had to type its "action" as JSON in
its reply, looking at a pasted snapshot of 20 invoices; it could not look
anything up, never learned whether an action worked, and could not chain
steps.

- **Looks things up before answering.** Search documents, read any document in
  full, find a client (name, phone or email) with their open balance, search
  the price book, read the schedule, and add up invoiced / collected / unpaid
  for any date range. A live read-only database query covers the rest, e.g. a
  lead the receptionist filed since the app loaded.
- **Multi-step requests in one message.** "New client Mike Tanaka, 808-555-1234,
  estimate for a water heater swap, book him Thursday 9am" runs find, create
  client, price-book check, create estimate and schedule in a row.
- **Honest results.** A failed save now reaches the model as an error (the
  handler used to log and carry on), so it cannot report success on a write
  that did not land. A document open in the editor is refused rather than
  written and then overwritten by the form.
- **Remembers what it did.** Each reply stores a one-line trace of its writes
  (EST1043, $402.12), replayed on later messages.
- **New:** edit or remove a line item by number, change status / notes /
  discount / due date, record a payment, delete one document (with a confirm
  dialog). Sending an email still stops at the Confirm Send card.
- **Model:** `claude-sonnet-5-5` at medium effort, with server-side fallback so a
  false-positive safety decline is retried on another model instead of
  returning nothing. The per-invoice chat is unchanged (Haiku).
- Shows what it is doing while it works ("Looking up Karen...").
- Replies keep their line breaks.
- Dates in the agent use Hawaii time, not UTC.

Files: `src/aiAgent.js` (new), `api/_lib/agent-tools.js` (new), `api/ai.js`,
`src/App.jsx`, `src/supabase.js`. No migration.

---

## v1.13.0 — 2026-09-29

### Apprentice competency tracker
The revenue scorecard shipped in v1.12.0 measures things an apprentice does
not control: billed, avg ticket, close rate. Scoring a learner at zero against
the owner is the wrong instrument, so an apprentice now gets a different board
entirely.

- **`profiles.tier`** (migration 054) — `apprentice` | `technician` | `admin`.
  Deliberately separate from `profiles.role`, which drives `is_admin()` and
  every RLS policy in the database; overloading `role` with a pay band would
  quietly change authorization. Tier is presentation and pay band only.
- **`tech_competencies`** — one row per (tech, skill), level 0 to 4. Admin-only
  writes: a tech grading themselves would make the graduation gate meaningless.
  A tech can read their own record.
- **`src/competencies.js`** — the catalog: 60 skills across 12 domains (safety,
  truck and materials, copper, PEX, DWV, fixtures, water heaters, gas, sewer,
  code and permits, customer, paperwork). It is code rather than a table so it
  is versioned and reviewable. Skill `key` strings are permanent; renaming one
  silently resets that skill for everyone who had it signed off.
- **Graduation gate** — 21 of the 60 are gate skills that must reach Solo
  before anyone runs their own van, plus 80% of the whole catalog at Supervised
  or better. Both bars must clear. Reports shows what is still open.
- **Apprentice Progress card** in Reports, above the revenue scorecard, with a
  per-domain breakdown and a tap-through editor. Levels save optimistically and
  roll back on failure — tapping through sixty skills against a round trip each
  would be unusable on a phone.
- **Tier selector** in Settings → Users. Flipping someone from Apprentice to
  Service Tech is the graduation, and it is the moment they move onto the
  revenue scorecard and commission.
- Apprentices are filtered out of the revenue scorecard so they no longer drag
  the team average they cannot yet contribute to.

Colors stay keyed to a tech's stable roster position, so adding an apprentice
above someone in the list does not repaint them.

**Safe to deploy before migration 054 runs.** `getMyProfile` and `listAllUsers`
ask for `tier` and fall back to the pre-054 column set if the database does not
have it yet. Without that fallback PostgREST 400s on the unknown column, the
profile resolves to null and the admin loses admin in the UI — push is deploy on
this project, so the app must not be hostage to migration ordering for a purely
additive column. Until 054 runs, the tier selector and the apprentice card are
simply inert.

---

## v1.12.0 — 2026-09-29

### Per-tech KPI scorecard (Reports tab)
First piece of the 2026 scale plan — the tech scorecard the apprentice hire
depends on.

- **New `invoices.assigned_tech_id`** (migration 053) — who actually *ran* the
  job. This is a new column rather than a reuse of `owner_id` on purpose:
  `owner_id` records who created the row, and `save_invoice_with_items`
  restamps it to whoever saved last, so an admin editing a plumber's invoice
  silently takes ownership. Paying a bonus off `owner_id` would credit the
  wrong person. Backfilled from `owner_id`, so all existing history is intact.
- **Tech Scorecard card in Reports** — per tech: billed, collected, avg ticket,
  paid rate, estimate close rate, jobs count. MTD / YTD toggle. An "Unassigned"
  row surfaces jobs with no tech set so they cannot quietly vanish from the
  board.
- **Relative score (100 = team average)** — weights are billed 40%, avg ticket
  20%, jobs 20%, paid rate 20%, defined in one place (`SCORE_WEIGHTS` in
  `src/App.jsx`). Deliberately relative rather than against fixed dollar
  targets, which go stale the first time pricing moves. Shows `—` until two
  techs have jobs, because a team average of one is not a comparison.
- **Assigned Tech picker on the job form** — admin-only, appears once there is
  more than one profile. A plumber cannot reassign their own jobs.
- **`invoices_select` RLS widened** to `assigned_tech_id = auth.uid()` so a
  tech can see the jobs assigned to them and their own scorecard. SELECT only;
  write access for an assigned tech is a separate decision and was not granted.
- Scorecard reads the unfiltered invoice set, not the View-as-filtered one —
  narrowing to a single user would collapse the board to one row and make
  every comparison meaningless.

Two measures (billed and collected) share one dollar axis; series color keys to
the tech's stable roster position, not their rank, so climbing the board does
not repaint anyone.

---

## v1.11.2 — 2026-09-14

### Changes
- **The receptionist's Apps Script is now mirrored in `apps-script/`.** It ran in a Google Apps Script web app in Jake's Google account and existed nowhere else — lose the account and Lisa's calendar booking could not be rebuilt. The folder holds `Code.gs`, the `appsscript.json` manifest and a README covering where the live project is, the deploy steps (an edit does nothing until the existing deployment is redeployed as a new version), and how to test with `select push_invoice_to_calendar('EST0807');` instead of placing a real call. Credentials are placeholders because this repo is public; the README names where each real value lives. It is a mirror, not the source of truth — change one side and change the other.

---

## v1.11.1 — 2026-09-14

### Changes
- **The app colours Lisa's bookings itself, so the Apps Script needs no edit.** v1.11.0 sent a `colorId` in the webhook payload, which meant the Apps Script behind `settings.gcal_webhook_url` had to be changed to use it — a web app that exists only in Jake's Google account, with a redeploy step, for one line. The calendar reconciliation now compares each linked event's colour against its visit's kind and patches it when they differ. One write per event, once, rather than on every sweep. The `colorId` in the webhook payload stays: harmless, and it saves the repair trip if the Apps Script is ever updated.

---

## v1.11.0 — 2026-09-14

### Changes
- **One calendar event format, used by every writer.** Five places created Google Calendar events and each built its own body, so an appointment read differently depending on whether the schedule modal, the sync sweep, the AI assistant, the follow-up modal or Lisa's server-side push had made it. `buildCalendarEvent()` in `src/App.jsx` is now the only builder on the app side, and migration `052` rewrites `push_invoice_to_calendar()` to match it field for field.
- **New event title: `Work · Client · Document`.** Was `Client - ID - label`. The work leads because that is what a week has to be read for — spotting every water heater at a glance is what makes one parts run instead of three. The work description falls back from the visit label, to the first line item's name, to "Plumbing", so a title is never just a name and a number. Long item names are cut at their spec dash and capped at 30 characters.
- **The job site is no longer truncated.** The Location field got `job_address.line1` alone, dropping the unit, city and zip — right street number, potentially the wrong block when tapped for directions. It now carries line1, line2 and line3.
- **Line items in the event body.** A `SCOPE` block lists up to six line-item names, then `…and N more`. Names only: the per-item description is the customer-facing scope of work and far too long for a calendar entry.
- **Estimates pushed from the server are no longer all labelled "Estimate".** `push_invoice_to_calendar()` hardcoded the word regardless of `invoices.type`, so invoices read as estimates. It reads the document now.
- **Job / Estimate / Emergency per visit.** A picker at the top of each visit in the Schedule Job modal, stored as `visits[].kind`. Defaults from the document type, so nothing needs backfilling and `visits` being jsonb means no schema change. Emergency had no representation anywhere before this.
- **Colour coding, matched between the app and Google.** Job is Peacock, Estimate Tangerine, Emergency Tomato, Follow-up Banana, everything else Graphite. The app's hex values are the colours Google actually draws for those palette ids, so the key means one thing in both places.
- **A key on the Calendar tab, and tapping a chip filters that kind** out of every view including the month dots. The choice persists.
- **New Agenda view.** A rolling list of everything scheduled from today forward, in date order, with no grid above it — the first job is the first thing on screen. Days with nothing on them are skipped.
- **Swipe left and right to change period**, on every view but the agenda. A swipe has to be decisive and mostly horizontal so a flick down the hour grid does not jump the week.
- **Pinch to resize the grid.** Scales the hour rows in the time views and the cell height in the month view, between 0.6x and 2.2x. Persists.
- **Month cells start shorter** (36px, was 46) so the day list below them clears the fold on a phone.
- **Editing a job now reaches its calendar event.** A reschedule patched times and title only, so changing the notes or the line items never showed up on the calendar. Events this app created are stamped `builtBy`, and only those get their text patched — a booking from Lisa still keeps the caller's own words, which was the reason for the blanket rule.

### Migration
- `052_calendar_event_format.sql` — rewrites `push_invoice_to_calendar()` to match the app. Also sends a `colorId`; the Apps Script behind `settings.gcal_webhook_url` needs `if (p.colorId) event.setColor(p.colorId);` for that half to take effect, and ignores the field harmlessly until then.

---

## v1.10.4 — 2026-09-11

### Changes
- **Hard rule 13 is now enforced by CI.** `.github/workflows/release-check.yml` fails any push to `main` that changes `src/`, `api/` or `supabase/migrations/` without bumping `src/version.js`, and any version with no matching `CHANGELOG.md` section. It deliberately does not block the deploy — Vercel builds the same push regardless, so a red check is a note to go back, never a reason the business is down. `src/App.jsx.bak` is exempt so rule 11's standalone backup push stays clean.
- **The 2026-09-02 to 2026-09-07 gap is recorded** as an unversioned changelog section, reconstructed from commit history. Fifteen commits shipped there with no version bump, so the app reported 1.10.1 while the server-side OAuth rewrite, migrations 045–051 and the SMS compliance work all went live. Those releases are not renumbered — rewriting version numbers that already shipped to a phone would be worse than recording the gap honestly.
- **CLAUDE.md brought current**: schema through migration 051, the `google_credentials` table, migrations 045–051 in the list, the next migration number, and `api/gcal.js` and `api/_lib/gcal.js` in the source layout.

---

## v1.10.3 — 2026-09-11

### Bug Fixes
- **A document could open showing a different document's contents.** EST1022 opened with INV1021's client and line items while the header still read EST1022. The app keeps a per-document draft in the browser so a reload doesn't lose unsaved edits, but the draft's key is built from the invoice being opened while its contents come from form state — and those two are a render apart during a document switch. A draft could therefore be filed under the wrong document's key, and was then restored into it on every open, surviving reloads. Drafts now carry their own id and are only restored into the document they came from; a mismatched one is deleted rather than left to resurface. The same check applies on write, so one can't be misfiled in the first place.
  - The stored data was never affected — EST1022's own client and items were intact throughout. The v1.10.2 guard is what kept it that way, since backing out of the form runs the auto-save flush.
  - The iOS backgrounding flush now reads its key from a ref. Its listener is registered once at mount, so it had been writing under whatever document was open at the time.

---

## v1.10.2 — 2026-09-11

### Bug Fixes
- **A form showing the wrong document can no longer overwrite the right one.** All three save paths — the auto-save flush, Done, and the partial save — now refuse to write when the form's own `id` differs from the row being targeted. Previously only the id *prefix* was checked against the document type, which catches an invoice's contents landing on an `EST` row but is blind to two documents of the same type. This matters more than it sounds: backing out of the form runs the auto-save flush on unmount, so a document that merely *displayed* wrong became a corrupted row just by being closed.

### Note
This is a containment fix, not the root cause. It stops the wrong contents being written; it does not yet explain why the form shows a stale document in the first place. That investigation is ongoing.

---

## Unversioned — 2026-09-02 to 2026-09-07

**Fifteen commits shipped here without a version bump or a changelog entry.**
The app reported `1.10.1` throughout, so anything that went wrong in this window
cannot be traced to a release. Reconstructed from commit history on 2026-09-11
and left unversioned deliberately — renumbering releases that already shipped to
a phone would be worse than recording the gap honestly. A CI check now fails any
push that changes app code without bumping the version, so this cannot recur.

### 2026-09-02 — Google Calendar moved to server-side OAuth
- Google Calendar now holds a **server-side refresh token** in `google_credentials` rather than a browser access token, ending the disconnect-every-hour behaviour that v1.5.0 could only soften. `src/googleCalendar.js` became a thin client for `/api/gcal` and holds no Google credential of its own. Migration 045.
- The OAuth callback was folded into `api/gcal.js` instead of getting its own route — the project is at the Hobby plan's 12 Node function cap, and a thirteenth makes every deploy fail at `Deploying outputs...` with no error line in the log.
- Google client credentials are read from the env vars Vercel already had.
- **Both calendar writers now target the same calendar.** The app's write target (`google_credentials.calendar_id`) must equal the one the receptionist's Apps Script uses — the shared Work calendar. While they disagreed everything appeared to work, but reconciliation compared unrelated calendars and never saw a booking Lisa made. Migration 046.
- **The calendar callback was losing every event id it was handed.** `set_invoice_gcal_event()` wrote `gcal_event_id` directly, and the `invoices_sync_first_visit` trigger rewrites that column from `visits` on every update — so the write was undone inside the same statement, with no error. It now writes into the visit the trigger derives from. Migration 047.
- **`save_invoice_with_items` was stamping `gcal_date` as UTC.** `gcal_date` is local wall-clock text with no offset and the database runs UTC, so a `::timestamptz` cast restamped a 6pm job as 6pm UTC — 8am Hawaii. It hid well: three of the four consumers cancelled the error out. Migration 048.
- **Lead timestamps were stamped in the server's UTC, not Hawaii time.** For the ten hours between 2pm and midnight local — exactly when an after-hours receptionist matters — the server is already on tomorrow's date. A 10:07pm Sep 2 call was logged "Sep 03, 08:07 AM" and its estimate dated a day ahead. Migration 049, with 050 correcting the ten lead rows already written.
- A call record with the full transcript is now emailed after every receptionist call, with the summary at the top.

### 2026-09-05 — SMS compliance
- The first SMS a customer receives discloses STOP and HELP.
- Outbound SMS uses the business's legal name rather than the name Lisa speaks on the phone.

### 2026-09-07 — Inbound texts
- Inbound customer texts are surfaced in the app, and photos customers send are kept rather than discarded. Migration 051.
- Caption-less photos were being dropped by the route as well as the RPC; both now keep them.

---

## v1.10.1 — 2026-08-27

### Bug Fixes
- **Connecting Google Calendar after scheduling created every event twice** — introduced in v1.10.0. Connecting flips `gcalAuthed`, which fires both reconciliation callers at once: the startup sweep and the Calendar tab's own fetch. Both read the same visit with no event id, and both created before either had saved a result. Three guards, because one alone wasn't enough: only one reconciliation runs at a time, invoices are read from a ref rather than a stale closure, and each visit's key is claimed *before* the create is awaited so the loser of a race skips instead of duplicating. A failed push releases its claim so a later sweep can retry.

---

## v1.10.0 — 2026-08-27

### New Features
- **Calendar changes now flow both ways.** Move a job in Google Calendar and the app picks it up; move it in the app and Google updates immediately, as before. Reconciliation runs whenever the Calendar tab fetches events — no extra API call, it uses the events already in hand — and once on app load across a wider window (30 days back, 90 forward) so a job moved three weeks out isn't missed just because you were looking at this week.
  - **A change made while Google was disconnected is never overwritten.** Those visits are marked pending, and the sweep pushes them to Google rather than reading Google's older time back over them. Local intent wins; Google wins everywhere else.
  - **A visit that never reached Google is now created automatically** instead of needing you to open Edit and save. Nothing server-side would ever do it: `push_invoice_to_calendar()` is create-only and skips any invoice that already has an event id, so a second visit would have stayed missing indefinitely.
  - A visit whose Google event has been deleted is deliberately left alone — absence from a range query isn't proof of deletion, and both guesses (recreate, or unschedule) would be wrong. A later edit self-heals it.

### Changes
- The event body is now built in one place, `buildCalendarEvent()`, shared by the schedule modal and the reconciliation. Two copies would have meant the calendar looking different depending on which one happened to write last.

### Known limitation
This is not live sync. Nothing pushes from Google to the app, so a job moved in Google won't reach anything server-side — Lisa's alert emails, the webhook — until the app has been opened. Making it live needs a Google push channel and a server endpoint to receive it.

---

## v1.9.3 — 2026-08-27

### Changes
- **Appointments booked in the app now look identical to ones Lisa books** — same title (`Client - EST1004`), the job address as the event location, and contact details plus internal notes in the body. The app previously used a different template entirely: `Client – Job Title`, the line-item text, and no location at all, which is why the two never matched. `eventFor()` now mirrors `push_invoice_to_calendar()`. Instant confirmation is unchanged — this is all still done directly from the app.
- **A visit that never reached Google Calendar now says so** on the invoice's schedule card, with what to do about it. This happens when a visit is added while Google is disconnected, and nothing fixes it on its own: the server-side function is create-only and skips any invoice that already has an event id, so it will never repair a missed visit. Opening Edit and saving adds it.

---

## v1.9.2 — 2026-08-27

### Bug Fixes
- **Rescheduling a job Lisa booked destroyed its calendar event** — changing the date in the app didn't move the Google Calendar event, it deleted it and created a new one. Events booked by the AI receptionist come from the Apps Script webhook with a proper title, the caller's own notes in the description and the job address as the location; recreating them threw all of that away and replaced it with the app's bare template, which is why the title changed and the details vanished. The app now sends a partial update that moves the times and leaves everything else alone.
  - The title is only rewritten if you actually edited the visit's label.
  - The description is never overwritten on an existing event — on a receptionist booking it holds the caller's own words, which are worth more than the line-item text the app would put there.
  - If the event has since been deleted in Google, or lives on a calendar the app can't reach, it falls back to creating a replacement rather than losing the booking silently. Both failure paths now log instead of being swallowed.

---

## v1.9.1 — 2026-08-27

### Bug Fixes
- **The schedule card went blank after saving visits** — introduced in v1.9.0. The card read `form.gcalDate`, but the modal only sends `visits` now; the database trigger fills `gcal_date` in from those, so the form didn't learn about it until a reload and the job looked unscheduled. The card is built from `visits` directly, and the modal also mirrors the earliest visit locally using the same rule the trigger uses, so the two agree straight away.

### New Features
- **Every visit is listed on the invoice**, numbered, with its label underneath — so you can see how many trips a job takes with the invoice open, without going to the calendar.
- **Tap a visit to jump to that day on the calendar.** It opens the Calendar tab focused on that date with the day selected.
- **Visit labels can run to several lines.** The first line becomes the Google Calendar event title (Google strips newlines from a title) and the whole label goes into the event description, where it stays readable. Calendar blocks show the first line.

---

## v1.9.0 — 2026-08-27

### New Features
- **A job can be scheduled across several visits** — for work that takes more than one trip. Schedule Job is now a list: add as many visits as the job needs, each with its own date, time, duration and label ("Rough-in", "Fixtures", "Final"). Each visit becomes its own Google Calendar event titled with its label, and each appears separately on the calendar. Removing a visit removes its Google event. Requires migration 044.
  - Adding a visit defaults to 9am the day after the last one, which is usually what a multi-day job wants.
  - Saving only touches Google for visits that actually changed, so re-saving doesn't churn the calendar or reissue event ids for appointments nobody edited.
  - Existing scheduled jobs are backfilled as one-visit jobs, so nothing looks unscheduled after the migration.
  - `visits` is the source of truth; `gcal_date`, `gcal_event_id` and `gcal_duration_minutes` are now *derived* from the earliest visit by a trigger. They stay because `push_invoice_to_calendar()`, the webhook trigger and `create_estimate_from_lead` all read `gcal_date` — every existing reader keeps working and sees the first appointment.

### Bug Fixes
- **Duplicating an invoice cloned its Google Calendar event** — the copy carried the original's `gcal_event_id`, so two documents pointed at the same appointment and unscheduling either one deleted the other's event. This existed before visits and would have got worse with them. A duplicate now starts unscheduled, as does a converted document.

---

## v1.8.0 — 2026-08-27

### New Features
- **Tap a calendar event to open its document** — works on the blocks in the Day/3 Day/Week grid, on follow-up reminders in the all-day strip, and on the rows in the agenda list underneath. Scheduled jobs open their invoice or estimate; follow-up reminders open the document they belong to. Google Calendar events that aren't tied to a document stay unclickable, as there's nothing to open.
  - The agenda rows now show the document number (`INV1004`), so it's clear at a glance which entries lead somewhere.
  - Opening from the calendar deliberately leaves the tab alone, so backing out of the document returns you to the calendar rather than dropping you on the Invoices list.
  - A document that has since been deleted says so instead of opening a blank form.

---

## v1.7.2 — 2026-08-27

### Bug Fixes
- **The calendar grid now covers the full 24 hours** — it was cropping to roughly 7am–7pm. The window was sized to fit whatever was already booked, with a 7am–7pm floor, which meant any hour with nothing in it was simply not drawn: you could not scroll to 5am to look at it, because 5am did not exist on the grid. Emergency call-outs don't keep office hours. It runs midnight to midnight now.
- The grid still opens scrolled to the working day rather than to midnight, and if something is booked earlier than that it opens there instead so it isn't off-screen.

---

## v1.7.1 — 2026-08-27

### Bug Fixes
- **Scroll down, then unable to scroll back up** — in the calendar and in modals. Pull-to-refresh listens on `document` and called `preventDefault()` on any downward drag, which cancels the scroll the finger was about to perform rather than merely suppressing the browser's own gesture. Its only guard was that the *page* sat at scroll-top — but on a screen whose content fits, such as the calendar, `window.scrollY` is permanently 0, so the guard was always satisfied. Scrolling a nested area down and dragging back up read as a pull-to-refresh every time. It now stands down when the touch begins inside a modal or anything with its own scrollbar. This was not a calendar bug; it affected every modal with a scrollable sheet.
- **Edge-swipe-back could fire from inside a modal**, navigating the app backwards while a sheet was open.
- A flick that reaches the end of the calendar grid no longer continues into the page behind it.

---

## v1.7.0 — 2026-08-27

### New Features
- **One shared price book** — every plumber now reads the admin's saved items, and only the owner of an item can change or delete it. Previously `saved_items` was scoped per user and the price book was seeded to Jake's uuid alone, so a journeyman signing in got an empty Saved Items tab and an empty Price Book picker, and would have typed prices by hand. Requires migration 043.
  - The AI receptionist already worked this way: `create_estimate_from_lead` hardcodes the admin's uuid and prices every lead from his book whoever is on shift. This makes the app agree with what the business already does.
  - Plumbers can still save their own personal items. Those carry their own `owner_id` and stay private.
  - Reads widen, writes do not. The migration adds a SELECT policy alongside the existing ones rather than replacing anything — migration 017 set up the current policies and its file is not in the repo, so nothing here drops a policy it cannot see.

### Bug Fixes
- **The Saved Items tab offered a delete button on items you cannot delete** — every row had a ×, with no ownership check. With a shared book that would have let a journeyman try to delete the price book, failing silently against RLS. The button now appears only on your own items, and shared ones are labelled as such.
- **The AI "save item" action could try to edit somebody else's item** — it matched purely on name, so a shared admin item with the same name would have been updated, which the owner-scoped write policy rejects. It now only ever updates an item you own.
- **View-as showed an empty price book** — the filter narrowed saved items to the viewed user alone, which no longer reflects what that plumber actually sees. It now shows their own items plus the shared book.

---

## v1.6.1 — 2026-08-27

### Bug Fixes
- **A scheduled job's duration is now saved** — `ScheduleJobModal` asked how long a job would take, used it to build the Google Calendar event, then discarded it. `invoices` had `gcal_date` and `gcal_event_id` and nowhere to record a length, so the only copy lived inside Google. Any job booked while disconnected — including during the hour-long token gap fixed in v1.5.0 — had no duration recorded anywhere. Requires migration 042.
- **The app and the AI receptionist no longer disagree about job length** — the modal defaulted to 2 hours while the receptionist's `gcal_default_minutes` was 90, so the same unrecorded job was drawn at two different lengths depending on who booked it. Both now read the same setting. Duration options are in minutes rather than whole hours, since 90 could not be expressed before.

### Changes
- The calendar picks a job's length in this order: what was saved on the invoice, then the length of its Google event, then `settings.gcal_default_minutes`. Jobs booked before this migration have no stored value and fall back, exactly as they did.

---

## v1.6.0 — 2026-08-27

### New Features
- **Calendar time-slot views: Day, 3 Day, Week, Month** — a Google-style grid with hour rows down the side and one column per day. Events are drawn as blocks positioned and sized by their real start and end rather than listed as text. The chosen view is remembered between sessions, there's a Today button, and the arrows step by the length of the view rather than always by a month.
  - Overlapping events sit side by side, and the split is worked out per cluster of overlapping events — a lone 4pm job stays full width even if two others collide at 9am.
  - A red line marks the current time, on today's column only.
  - Follow-up reminders and Google all-day events get their own strip above the grid instead of being forced to a time.
  - The grid opens scrolled to the working day, and the visible hours stretch to fit anything scheduled early or late.
  - Google events are now fetched for the range on screen rather than always a whole month.

### Bug Fixes
- **A scheduled job appeared twice** — once from the invoice and again from the Google Calendar event it created. As dots on a month grid that was invisible; as blocks it would have drawn two bars on top of each other. The two are now matched on `gcalEventId` and merged, keeping the invoice's label and taking the real start and end from the Google copy.
- **Google event times are read in Hawaii time** rather than the device's timezone, so an event can't land on the wrong day or hour when the phone is travelling.

### Known limitation
A job that never synced to Google has no stored duration — `ScheduleJobModal` asks for one but only uses it to build the Google event, then discards it. Those blocks are drawn as 2 hours, matching that modal's own default. Jobs that did sync show their true length. Storing the duration on the invoice would need a new column.

---

## v1.5.1 — 2026-08-27

### Changes
- **Calendar moved into the bottom bar, Expenses moved into More** — the bottom row is now Invoices · Estimates · Calendar · Clients. Expenses keeps everything it had, including the floating **+** to add a receipt; it is now reached through More rather than the bottom bar.

---

## v1.5.0 — 2026-08-27

### Bug Fixes
- **Google Calendar stopped logging itself out** — the connection dropped after about an hour, or whenever the app was closed and reopened, and had to be reconnected by hand. Google's implicit OAuth flow returns an access token that expires in one hour and no refresh token, and `gcalAuthed` was initialised straight from that stored token, so an expired one put the Connect button back. Consent is remembered by Google, so the app now asks for a fresh token silently on startup — no prompt, no popup, nothing on screen. If there is no Google session it falls back to the Connect button exactly as before.
- **The Connect button could do nothing, forever** — Google's sign-in script was loaded with an `onload` handler and no `onerror`, so a blocked or failed script left the promise pending with no error anywhere and the button simply did not respond.
- **Sign-in popup was blocked on iOS** — `requestToken` awaited the script load before calling `requestAccessToken`, which breaks the user-gesture chain that Safari requires to allow a popup. When the client is already warm the request now goes straight through with nothing awaited in front of it.
- **A rejected token had no way back** — a revoked or clock-skewed token surfaced as a bare "Invalid Credentials" until the browser's storage was cleared. A 401 from Google now clears the stored token and retries once through the silent refresh.
- Sign-in failures now report something useful (cancelled, unreachable, unavailable) instead of a raw error object.

---

## v1.4.4 — 2026-08-27

### Changes
- **Split the two handoff docs so nothing is documented twice, and added hard rule 14 to keep them current.** `CLAUDE.md` now owns the schema, migrations, numbering, invariants and sharp edges; `HANDOFF.md` owns architecture patterns, the writers-outside-the-app table, and service/native setup. Neither repeats the other.
- **Corrected HANDOFF.md, which was worse off than CLAUDE.md.** Its schema section still described the single-tenant database from before migration 017 — no `owner_id`, no `profiles`, no `job_photos` or `client_versions` — so it has been replaced with a pointer plus the material that lives nowhere else (optimistic locking, the unique indexes, the Realtime publication, and why a migration file is not proof of what is live). Also fixed: the claim that AI runs on OpenAI, `OPENAI_API_KEY` in the env list, and App.jsx at 7,500 lines.
- **Replaced two sections that were guaranteed to rot** — the App.jsx line-number table (every entry stale after ~2,800 lines of growth) is now a grep recipe and a component list, and the roadmap's "pending setup" list no longer asserts things the repo cannot verify.
- **Hard rule 14**: a change to the schema, a migration, numbering, an invariant, an endpoint or an AI model id is not finished until the doc is updated in the same commit. This is the rule that was missing — `version.js` and `CHANGELOG.md` never drifted because rule 13 forces them.

---

## v1.4.3 — 2026-08-26

### Changes
- **CLAUDE.md brought current** — it had drifted to roughly migration 018 while the repo moved to 041. Corrected: App.jsx size (8,500 → 10,300 lines), the AI providers (it claimed OpenAI/gpt-4o-mini; every AI call is Anthropic, with the four model ids now listed per endpoint), the full source and API layout, the schema through 041, the migration history including that 017's file is missing from the repo, the connector and env-var list, and the UI specs. Adds sections on shared document numbering, the AI receptionist, and the fact that the app is not the only writer to `invoices`. The commit list was replaced with a short summary of the current state, since a hardcoded list goes stale the moment it is written. Hard rules and the queued bugs list were left untouched. No app changes.

---

## v1.4.2 — 2026-08-26

### Bug Fixes
- **Line item editor snapped back to the top, putting Done out of reach** — with a long description the edit sheet jumped to the top every time you tried to scroll down, so the Done button could not be reached and changes could not be saved. The description's auto-grow ran as an inline `ref={el => ...}` callback, which React re-invokes on *every* render because the arrow function is a new identity each time. Each pass set the height to `auto` before measuring, momentarily collapsing a tall textarea to a single row — the sheet's scrollable height collapsed with it and the browser clamped `scrollTop` to the new maximum. Restoring the height did not restore the scroll position. The resize now runs in a layout effect keyed on the description text, with the sheet's scroll position captured and restored around the measurement. The duplicate per-keystroke resizing in `onChange` and `onInput` is gone; one place owns it.

---

## v1.4.1 — 2026-08-26

### Changes
- **Handoff doc: queued bugs list rewritten against the code** — six of the eight listed bugs were already fixed and were sending agents to chase work that no longer existed (secondary email, job site nickname on the PDF and on screen, the property selector gate, client and per-property notes, and the version history UI — all verified present in the source). Two remain genuinely open: the saved-items sharing model, which is a product decision rather than a defect, and the iPhone text-selection drag, which needs reproducing on a device before anyone writes code. Also records the states that must not be "fixed" (EST0767's deliberate mismatch, legacy documents having no paired numbers) and the one blind spot the id/type guards cannot cover. No app changes.

---

## v1.4.0 — 2026-08-26

### New Features
- **Estimates and invoices now share one number** — a converted estimate keeps its number instead of taking a new one, so EST1000 becomes INV1000. Both types draw from a single sequence, which is what makes the pairing collision-proof: a number is handed out once, to a job, so the invoice side can never land on one the estimate side already issued. Requires migration 040 (see below).
  - **Invoice numbers are no longer contiguous.** Three estimates then an invoice gives EST1000, EST1001, EST1002, INV1003. Gaps are normal for GET filing; this was an explicit trade-off for a rule with no exceptions.
  - **Documents below 1000 are unaffected.** The old scheme ran two independent sequences, so INV0767 and EST0767 are both real, unrelated documents. Reusing a legacy number would collide with something already sent to a customer, so conversion checks whether the paired id is free and falls back to a fresh number when it isn't. Those pairs stay linked by the cross-link button, which never depended on matching numbers.
  - The starting line is computed from the data (`greatest(1000, highest number in use + 1)`) rather than hardcoded, so a document neither old counter knew about still can't cause a number to be reissued.
  - The online down-payment conversion in `/api/paypal-capture-order` follows the same rule.

### Bug Fixes
- **Converting an already-converted estimate is now blocked** — it would have minted a second invoice for the same job, and under shared numbering asked for a number already taken. It now opens the existing invoice instead.
- **AI bulk-create could crash on a failed write** — the rollback path in `handleGlobalAIAction` still referenced the old per-type counter, which no longer exists. It builds cleanly and throws only when a database write fails, so it would have surfaced as a mystery error during a bulk create.

### Changes
- **Migration 040** — seeds the shared counter and adds `bump_doc_num()`, an advance-only helper called after each new document is saved. Deliberately a separate function rather than an edit to `save_invoice_with_items`: that function has been redefined by seven migrations and may carry changes made directly in the SQL editor, so rewriting it wholesale to add four lines risks silently reverting one. Must be applied by hand in the Supabase SQL editor.
- `next_num` and `next_estimate_num` are retired but left in place as the record of where the old sequences stopped. Nothing mints from them.

---

## v1.3.5 — 2026-08-26

### Bug Fixes
- **An in-flight save could drag a new document onto the previous one's row** — auto-save is async, and its completion block writes `autoSavedId` and the optimistic-lock token. A save started just before you tapped **+** resolved *after* the form had already reset, re-pointing the fresh document at the id of the one you just left and handing it a stale lock token. That is the v1.3.2 fix defeated by timing alone. The form now carries an epoch that bumps whenever it switches documents; a save that resolves against a stale epoch still counts as saved, but its bookkeeping is discarded.
- **The last edits before tapping + were silently dropped** — auto-save debounces for 800ms and the reset cleared the pending timer, so anything typed in that window never reached the database. The outgoing document is now flushed before the form is wiped.
- **An abandoned new-document draft could restore into the wrong kind of document** — every unsaved new document shared the draft key `new`, so a half-written invoice would reappear inside the next new estimate. The draft key is now scoped by type. This is the same state-bleed that produced EST0767, and notably one the id/type guards cannot catch: the minted id matches the wrong type it was handed, so the row looks perfectly consistent.

---

## v1.3.4 — 2026-08-26

### Changes
- **Handoff doc: SQL hand-off rules** — one query per code block, always include the Supabase SQL editor link, and a note that the editor only returns the last statement's result in a multi-statement batch. No app changes.

---

## v1.3.3 — 2026-08-26

### Changes
- **Migration 039 — the id/type rule is now enforced by the database** — an `EST####` row is an estimate and an `INV####` row is an invoice, held by a trigger on the `invoices` table. The v1.3.2 guards were client-side only, so the PayPal endpoints, the AI receptionist RPCs, the SQL editor and any future code path all bypassed them. A trigger is the only place that catches every writer. It blocks a write only when it would *introduce* a mismatch: rows that are already inconsistent (EST0767) stay editable, and setting one back to its correct type is always allowed. Must be applied by hand in the Supabase SQL editor.
- **Rejected writes now explain themselves** — `db.upsertInvoice` refuses outright to create a new row whose id contradicts its type, and translates the trigger's exception into a typed `ID_TYPE_MISMATCH` error. The invoice form turns that into a plain-language message instead of a raw Postgres exception.

---

## v1.3.2 — 2026-08-26

### Bug Fixes
- **A new document could overwrite the one you just left** — the invoice form stays mounted for 300ms after you leave it so the slide-out animation can finish. Tapping **+** inside that window reused the previous document's state, including the id auto-save writes to, so the new document's fields were saved onto the previous document's row. Because the save RPC upserts on id with `type = excluded.type`, that rewrote what the old document *was*: EST0767 became an invoice while keeping its estimate number, and was then emailed to a customer that way. The form now resets whenever **+** asks for a new document, tracked by a counter so two new documents in a row still reset. Backing out to the list deliberately does not reset — that path would blank the form mid-animation and mint an empty document on the way out.
- **Guard against id and type ever disagreeing again** — an `EST####` row is an estimate and an `INV####` row is an invoice. Auto-save now refuses to write anything that contradicts the id's own prefix, so no future bug can silently change what an existing document is. Rows already mismatched stay editable so they can be repaired.

---

## v1.3.1 — 2026-08-25

### Changes
- **Migration 037 — backfill orphaned down-payment invoices** — repairs the invoices already created with `owner_id` NULL before the v1.3.0 fix landed. Each one is claimed by the owner of the estimate it came from, with a sweep for any whose estimate is also orphaned or deleted. Includes a preview query to run first and a verification query to run last. Must be applied by hand in the Supabase SQL editor.

---

## v1.3.0 — 2026-08-25

### New Features
- **Estimate ↔ invoice cross-link button** — once an estimate has been converted, the "→ Invoice" button on the form turns into a jump button showing the counterpart's number (e.g. `→ INV0456`). Open that invoice and the same button reads `← EST0123` and takes you straight back. Works for both conversion paths: the in-app Convert button and the automatic conversion that fires when a customer pays a down payment online. Any pending edit is auto-saved before the form swaps over.

### Bug Fixes
- **Down-payment invoice was invisible after an online payment** — when a customer paid a down payment through the estimate link, `/api/paypal-capture-order` created the new INV#### row using the service-role key. `auth.uid()` is NULL there, so the `set_owner_id` trigger left `owner_id` NULL and RLS hid the row. The invoice existed in the database but never appeared in the app, so the estimate looked like it had never converted. The new invoice now inherits the estimate's `owner_id` (plus a PATCH backfill in case the insert trigger clobbers it).
- **Auto-created invoice lost the job site and internal notes** — the same server-side conversion never copied `job_address`, `billing_address`, `show_billing_address`, `internal_notes`, or `source`, so the resulting invoice printed with no address and dropped every private note the estimate carried. All of them now carry across.
- **Converted invoice inherited the estimate's down-payment settings** — `convertInvoice` copied `downPaymentPct` and `downPaymentInvoiceId` onto the new document, so a freshly converted invoice still thought a deposit was outstanding and pointed at another invoice. Both are now reset on the invoice side.

---

## v1.2.13 — 2026-08-17

### Bug Fixes
- **Keyboard auto-opens on line item edit modal** — removed `autoFocus` from the item name field so the keyboard no longer pops up automatically when the modal opens on mobile.

---

## v1.2.12 — 2026-08-17

### Bug Fixes
- **Line item description box too small** — textarea now starts at 100px (~5 lines) and auto-grows as you type. No more scrolling through the text.

---

## v1.2.11 — 2026-08-17

### New Features
- **"Show billing address" toggle** — a checkbox appears below the client info card on the invoice edit form whenever a client has job site properties. Checked by default. Unchecking hides the billing address from the on-screen preview and printed/downloaded PDF. The setting is saved with the invoice. Requires migration 019 (see below).

---

## v1.2.10 — 2026-08-17

### Bug Fixes
- **Phone/email position on invoice** — client phone and email now appear directly below the client name in the on-screen preview, public viewer, and printed PDF. Previously they appeared after the address block.

---

## v1.2.9 — 2026-08-17

### Changes
- **Job site UI cleanup** — on the invoice edit form, the client info card no longer shows the address when a client has job site properties (the address is already shown via the job site dropdown). For homeowner clients with no properties, the address still appears in the client info card as before. The job site section is hidden entirely when a client has no properties. The preview card below the dropdown has been removed; the internal nickname now appears as a single small italic line directly below the dropdown (admin-only).

---

## v1.2.8 — 2026-08-08

### Reverted
- Removed nickname from the invoice Preview tab bill-to section (v1.2.6). Nickname stays admin-only in the edit form job site card only.

---

## v1.2.7 — 2026-08-08

### New Features
- **Job site preview card on invoice edit form** — selecting a job site from the dropdown now shows a small card below it with the full address details: property name in bold, internal nickname in muted italic (admin only), and all three address lines. Makes it easy to confirm you have the right property selected without switching to the Preview tab.

---

## v1.2.6 — 2026-08-08

### Bug Fixes
- **Job site nickname missing from invoice preview** — the internal nickname was not appearing in the on-screen bill-to preview. Now shows in muted italic below the property name in both split and single address modes. Does not affect the printed PDF or customer-facing public viewer (nickname stays admin-only there).

---

## v1.2.5 — 2026-08-08

### New Features
- **Multi-recipient email send** — the Send modal now lets you add unlimited email addresses. Client saved emails (email + email2) appear as toggleable chips. Below them an "Add another email…" input + "+" button lets you add any extra addresses on the fly; added addresses show with a × to remove them. First recipient is "TO", all others are "CC".
- **Admin copy toggle** — a blue "Send me a copy" checkbox in the Send modal controls whether higradeplumbing@gmail.com is BCC'd. Checked by default (same as previous behavior); uncheck to send without a copy to admin on that specific send.

---

## v1.2.4 — 2026-08-08

### Bug Fixes
- **Job site defaulting to first address on reopen** — `jobAddressId` is a session-only field that is never stored in the database; only the full `jobAddress` JSON snapshot is persisted. On reopen, `jobAddressId` was always `undefined`, causing the dropdown, `resolvedJobAddress`, and autosave to all fall through to `clientAddresses[0]` instead of the saved address. Fixed by computing `effectiveJobId = jobAddressId || jobAddress?.id` and using it everywhere the ID is needed, so the snapshot's embedded id is honored without requiring a separate DB column.

---

## v1.2.3 — 2026-08-08

### New Features
- **Property internal nickname** — each job-site property now has two name fields: "Name" (shown on invoices — what was previously called "Nickname") and "Internal Nickname" (admin-only, dashed border, never printed on invoices). Both are saved to the addresses[] JSON. The internal nickname appears in both the full client-edit modal and the quick "Add Property" form on invoices.

---

## v1.2.2 — 2026-08-08

### Bug Fixes
- **Billing Address / Job Site split incorrect for property managers** — when a client had no explicit billing address, `resolveBillTo` was falling back to the legacy `address1/2/3` flat fields and treating that old job-site address as the billing address. For any client with addresses in those flat fields plus a different job site selected, this caused a false split showing the flat-field address labeled "Billing Address". Fixed by removing the flat-field fallback from the split-decision path. The flat fields are still used as a last-resort for the *single* address display (homeowner clients who pre-date the addresses[] system), but they no longer trigger a split.

---

## v1.2.1 — 2026-08-08

### New Features
- **Job site nickname on invoices** — when a property has a nickname (e.g. "Rental Unit B"), it now appears in bold above the address lines on the on-screen invoice preview, the printed/downloaded PDF, and the customer-facing public viewer link.

---

## v1.2.0 — 2026-08-08

### New Features
- **Job photos: batch select / relabel / delete** — tap "Select" in the Photos tab to enter select mode. Circle checkboxes appear on each photo. Tap to select, then use the action bar at the bottom to relabel all selected photos as Before / After / Other, or delete them all at once.
- **Job photos: multi-upload** — file picker now accepts multiple photos at once. Button shows "Uploading X / Y..." progress when uploading a batch.
- **Job photos: relabel after upload** — tapping a photo opens a full-size view; below the image are Before / After / Other buttons. Tapping one saves the new label to the database immediately.
- **Version tracking system** — `src/version.js` is the single source of truth for the version; `CHANGELOG.md` logs every change. Both are updated by the agent before every push to main.

### Bug Fixes
- **Photo modal clipped by tab swipe transform** — full-size photo viewer was being cut off by the tab container's CSS transform. Fixed by rendering the modal via a React portal directly on `document.body`.
- **Notifications dropdown hidden behind modals** — the bell panel was rendering at z-index 201 inside the page stacking context, placing it behind the invoice form and other overlays. Fixed by rendering via portal at z-index 9001 so it always floats on top of everything.
- **Duplicate address on invoice** — entering a single address caused it to appear as both "Billing Address" and "Job Site Address". Root cause: `normAddr()` in `billTo.js` joined address lines with `|` so the same address in two different formats compared as unequal. Fixed by joining with a space.

### Other
- **App version display** — Settings tab footer now shows version + build date (e.g. `HI GRADE INVOICING v1.2.0 · 2026-08-08`).

---

## v1.1.0 — 2026-07-07

### New Features
- **Job photos: multi-upload + relabel** (initial implementation, superseded by v1.2.0 batch editing).

### Bug Fixes
- **AI `create_client` drops address** — AI claimed to add an address but left `address1` blank in the JSON. Fixed with tightened system prompt CRITICAL rules and a guard in the GlobalAI handler that shows a warning when the AI summary mentions an address but the JSON has none.
- **AI refuses `update_client`** — AI sometimes said "I cannot go back and update the client." Added explicit CRITICAL rule to prompt.
- **Geocoding wrong Hawaii city names** — Nominatim returned "East Honolulu 96828" instead of "Honolulu HI 96815". Switched to Google Maps Geocoding API via a new Vercel Edge function (`/api/geocode.js`).
- **Quick-add client address vanishes after refresh** — `handleSaveNew` was not building the `addresses[]` array. Fixed.
- **Stale localStorage draft overwrites new address fields** — old draft keys were being restored over new field names. Fixed by migrating keys in the `useDraftPersistence` restore callback.
- **`addresses[0]` with empty city/state/zip blocks flat column fallback** — `toClient()` in `db.js` was not backfilling from flat columns when `addresses[]` existed but had empty location fields. Fixed.

### Other
- Separate city / state / zip inputs added across all client entry forms.
- Street address field auto-geocodes city/state/zip on blur.
- `address_unit` column added to `clients` table (migration 022).

---

## v1.0.x — 2026-06-06 through 2026-06-25

### Features Added
- **Text zoom** — global header button cycles through 1x, 1.3x, 1.6x text sizes.
- **Split Billing Address / Job Site** on invoice preview and printed PDF.
- **Line item discount strikethrough** — original price shown crossed out when a discount is applied.
- **Client edits propagate to all invoices** — editing a client's name or address now updates all outstanding invoice snapshots.
- **AI scheduling improvement** — `schedule_job` no longer asks for a job-site address when one is already on file; address is placed in the calendar event's location field.
- **Global AI chat full-screen** — modal opens full-screen for easier use on mobile.
- **Auto-save failure alerts** — visible alert shown when an auto-save fails silently.

### Bug Fixes
- **Invoice owner_id not set after global AI create** — `claimInvoiceOwner` RPC called after GlobalAI creates an invoice. Migration 020 also fixed a broken estimate counter and orphaned `owner_id` rows.
- **Navigate button opens blank tab on iOS** — changed `window.open` to `window.location.href` for the Google Maps navigation link.
- **Client address mixing** — client snapshot at invoice-select time was pulling the wrong address fields.
- **Job-site addresses not shown to scheduling AI** — `clientInfo` passed to the AI prompt now includes all stored addresses.

---

## v0.x — Prior to 2026-06-06

Initial development: Supabase schema, auth, invoice/estimate CRUD, PDF generation, AI chat panel, AI estimator, screenshot extractor, On My Way / ETA, Google Calendar sync, multi-user with admin role, `ai_chat_history` server-side persistence, job photos (initial implementation), daily Google Drive backup.

---

> **For Claude Code agents:** Before every `git push origin main`, bump `src/version.js` (patch for fixes, minor for features, major for architecture) and prepend a new `## vX.Y.Z — YYYY-MM-DD` section to this file describing what changed.

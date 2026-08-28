# HI Grade Invoicing — Changelog

All changes to the app are logged here. Most recent version at the top.
Each entry is tagged with its version number and date so incidents can be traced to an exact release.

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

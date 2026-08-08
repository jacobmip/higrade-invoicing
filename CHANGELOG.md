# HI Grade Invoicing — Changelog

All changes to the app are logged here. Most recent version at the top.
Each entry is tagged with its version number and date so incidents can be traced to an exact release.

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

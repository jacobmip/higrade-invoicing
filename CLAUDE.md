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
7. **Never use the words "scrape" / "scraping" / "crawl" / "crawling".** Use "extract" / "fetch" / "read".
8. **No emoji in chat or code output.** (The ⚠️ in the AI chat fallback is the only intentional one.)
9. Jake works mostly from his phone — keep replies short, no long diagnostic detours.
10. **Verify Jake is logged into the right account before destructive RLS / chat-history work.** Past bug: chat history got moved to the wrong account because we didn't check first.
11. **Before committing any changes to `src/App.jsx`, first copy it to `src/App.jsx.bak` and commit that backup as a separate commit with message "Backup App.jsx before [description of change]".** Push the backup commit before making any code changes. This gives Jake a one-command restore point: `cp src/App.jsx.bak src/App.jsx`.
12. **Push directly to `main` — no feature branches, no PRs, no merge step.** Vercel auto-deploys from `main`, and Jake prefers commits to land live without an extra merge. Only work on a separate branch if Jake explicitly asks in that session. (If a session is launched pinned to a development branch, that pin overrides this for that session, but it is not the default Jake wants.)

## Stack
- **Frontend**: Vite + React (single-file `src/App.jsx`, ~8500 lines). No component split yet.
- **DB**: Supabase Postgres, project ref `cwhgcxxszyvevjpbnnkc`.
- **Auth**: Supabase Auth, email + password.
- **Hosting**: Vercel, project `jacobmips-projects/higrade-invoicing`. Auto-deploys on push to `main`.
- **Live**: https://higrade-invoicing.vercel.app
- **Test harness**: https://higrade-invoicing.vercel.app/estimator-test.html
- **Repo**: https://github.com/jacobmip/higrade-invoicing.git
- **Supabase SQL editor**: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new
- **Supabase Auth Users**: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/auth/users

## Source layout
```
src/
  App.jsx            — everything: routing, all modals, AI chat, invoice form, client list (~8500 lines)
  apiBase.js         — API base URL helper
  backup.js          — manual backup export
  contacts.js        — phone contact import (iOS)
  db.js              — Supabase queries (clients, invoices, items, payments, saved items, chat history)
  googleCalendar.js  — gcal sync helpers
  printablePdf.js    — jsPDF invoice/estimate generator
  supabase.js        — Supabase client init
  main.jsx           — entry
public/
  estimator-test.html — standalone test harness for AI estimator + screenshot extractor
supabase/migrations/ — numbered SQL migrations, applied manually in SQL editor
```

## Database schema (post-migration 018)
All tables have `owner_id uuid references auth.users(id)` with RLS scoped to `owner_id = auth.uid() OR is_admin()`.

- `profiles` — id (FK auth.users), display_name, role ('admin'|'plumber'), created_at
- `clients` — name, email, email2, phone, address1/2/3, addresses jsonb (multi-property), notes
- `invoices` — number, client_id, client snapshot fields, jobAddress jsonb, items, totals, status, version, photos
- `invoice_items` — invoice_id, name, desc, qty, price, taxable
- `invoice_versions` — full snapshots for history view
- `invoice_events` — audit trail
- `payments` — invoice_id, amount, method, ref, paid_at
- `saved_items` — reusable line-item library, scoped per user
- `ai_chat_history` — user_id PK, messages jsonb (max 200), updated_at; **RLS self-only, admins do NOT bypass** (chat is private)

### Helper functions
- `is_admin()` — SECURITY DEFINER, checks current user
- `is_admin_uid(uid uuid)` — SECURITY DEFINER, breaks RLS recursion in profiles policies
- `set_owner_id()` — trigger, auto-stamps owner_id on insert
- `propagate_client_to_invoices(client_id, name, addr_jsonb, contact_jsonb)` — RPC for live client edits

## Migrations applied (in order)
- 001–016: foundational schema, items, payments, saved items, photos, versions, events, RPCs
- **017**: multi-user — profiles, owner_id everywhere, RLS scoping, admin role, View-as. Includes the `is_admin_uid` helper added later to fix profiles policy infinite recursion.
- **018**: ai_chat_history table + self-only RLS + updated_at trigger.

When writing the next migration, name it `019_<short_description>.sql` and paste the SQL inline in chat for Jake to run.

## AI features
- **Per-invoice chat panel** (`AIChatPanel` in App.jsx) — line-item edits, mark paid, change client, set date, etc. Uses Haiku 4.5 for general chat.
- **Global AI modal** (`GlobalAIModal`) — create invoices/estimates from scratch, bulk operations, client lookups. Same model.
- **AI estimator** — Sonnet 4.6, takes a job description (+ optional photos), outputs structured estimate with markup logic.
- **Screenshot-to-client extractor** — Sonnet 4.6 vision, parses screenshots of contact lists into structured client records.

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

## Connectors / external services Jake uses
- **Vercel** — auto-deploy from main, project `jacobmips-projects/higrade-invoicing`
- **GitHub** — repo above
- **Google Drive** — daily backup destination
- **Google Calendar** — invoice → event sync
- **Supabase** — DB + auth + storage

## Daily backup (recurring task in Perplexity Computer)
Cron `0d900b36`, runs `0 4 * * *` UTC:
1. Runs `python3 /home/user/workspace/higrade_backup.py` which dumps every row from every Supabase table to `higrade-backup-YYYY-MM-DD.json`.
2. Uploads the JSON to Jake's Google Drive via the connector.
3. Silent on success; sends a notification on failure.
This is read-only and runs outside Claude Code. Do not duplicate it in this repo.

## Locked UI specs
- Dark navy header, orange Done button.
- Estimate / invoice tabs: Edit · Preview · History.
- Quick-actions row above line items: Reorder · AI · Saved · +.
- Client search modal (quick add) lives in App.jsx around the search bar; the full edit modal is much larger.
- Edit-client modal already has `email2`. The quick-add modal does **not** — that's a queued bug.

## Queued bugs (in priority order)
1. **Secondary email rollout** — quick-add client modal, AI `create_client`, AI `update_client`, auto-CC on send-invoice. The full edit modal already supports `email2` and Excel import maps it. (Paused at Jake's request to avoid mid-workday breakage.)
2. **Job site nickname on printed invoice** — `form.jobAddress` is an object `{id, label, line1, line2, line3}`, but `printablePdf.js` (around line 176) treats it as a string, so the nickname has been silently invisible on PDFs. Render `label` as the heading and the three address lines under it.
3. **Property selector always visible** — currently the dropdown only renders when a client has 2+ addresses (App.jsx ~line 3071). Show it whenever the client has ≥1 address so Jake can switch and use "Add property" inline.
4. **Render job site nickname on the on-screen invoice** (parallel to #2).
5. **Notes field on client and per-property** — admin-only visibility, gate codes, water shutoff location, tenant info.
6. **iPhone customer-info text-selection drags the page** — known iOS Safari issue, needs touch-action / user-select tweak on the affected inputs.
7. **Version history UI** for `invoice_versions` (data exists, no view yet).
8. **Saved items model for plumbers** — currently scoped per-user, so journeymen start with empty saved items. Decide whether admin's saved items should be shared.

The user explicitly chose to **keep `addresses` as JSON** rather than break it out into a separate `properties` table — the migration risk wasn't worth it for a system he runs his business on. Re-evaluate only if cross-property reporting becomes a real need.

## Recent commits (most recent first)
- `c3580f7` — Force update_item JSON for line edits + auto-retry guard
- `ddafb04` — Server-side AI chat history (migration 018)
- `8aee424` — Recover stranded chat to admin
- `9f8ab40` — Auto-cleanup of corrupted chat
- `d7d58f3` — Removed bad auto-migration
- `5be45c5` — Per-user localStorage namespacing (caused the chat-leak bug, since fixed)
- `9fac19d` — Multi-user (owner_id, admin role, View-as) — pairs with migration 017
- `c57750e` — Mic crash fix + paperclip in global AI
- `99e1e8d` — Photo upload + client propagation phase 1
- `79812f6` — Auto-grow chat input
- `53f4304` — Travel zones
- `3a5147c` — Tighten extractor notes
- `edd4059` — Vision + screenshot extractor
- `09dab1d` — Tighten estimator
- `47aa759` — AI estimator + test harness

## Known sharp edges
- **iOS Safari `SpeechRecognition.start()`** throws synchronously. Always wrap in try/catch — the mic button crashed the app once already.
- **localStorage chat history is now a warm cache only.** Authoritative copy is in `ai_chat_history`. Don't reintroduce migration logic that "claims" a legacy key — that caused chat to jump accounts.
- **Profiles table RLS recursion**: any policy on `profiles` that queries `profiles` will infinite-loop. Use `is_admin_uid(auth.uid())` (SECURITY DEFINER) instead.
- **`form.jobAddress` is an object, not a string**, in the invoice form state. PDF renderer currently has a stale string-comparison check.
- **App.jsx is one ~8500-line file.** Use grep, not full reads, to navigate.

## Workflow tips for the next agent
- Build before pushing: `npm run build` in `higrade-invoicing/`.
- Jake's phone is the primary device. Test on mobile widths in the browser before declaring something fixed.
- When you write a migration, **paste the SQL in chat** — don't assume any direct DB access.
- Don't run `vercel` deploys manually; pushing to `main` auto-deploys.
- If you suspect a system-prompt regression in the AI chat, the prompt lives near the top of `App.jsx` (search for `update_item`, ~line 246).
- If the AI starts claiming it did something but nothing happened, check for a new failure mode and add a guard like the one around `extractActionsJSON` in `AIChatPanel`.

— end of handoff —

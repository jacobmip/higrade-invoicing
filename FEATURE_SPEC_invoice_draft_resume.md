# Feature Spec: Invoice Draft Auto-Save & Resume

**Goal**: Plumbers in the field never lose an in-progress invoice when the phone locks, the app backgrounds, or they switch apps to look up a part.

**Branch strategy**: Build on `feature/invoice-draft-resume` cut from `main`. Do NOT build on `vps-deploy`. Merge to `main` first (Vercel auto-deploys), then merge `main` into `vps-deploy` to push to the VPS.

---

## User stories

1. Halfway through an invoice, phone locks. Reopen app, resume exactly where I left off.
2. Spotty cell service: draft saves locally first, syncs to Supabase when connectivity returns.
3. Start on iPhone, continue on Mac mini — same draft visible.
4. Tab switch / back button does not lose typed input.
5. Drafts list page lets me resume or discard unfinalized invoices.

---

## Database (Supabase)

Migration file: `supabase/migrations/<timestamp>_invoice_drafts.sql`

```sql
create table public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  payload jsonb not null,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  device_id text
);

create index invoice_drafts_user_idx on public.invoice_drafts (user_id, updated_at desc);
alter table public.invoice_drafts enable row level security;

create policy "drafts owner" on public.invoice_drafts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_invoice_draft_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger invoice_drafts_touch before update on public.invoice_drafts
  for each row execute function public.touch_invoice_draft_updated_at();
```

---

## Frontend layout

```
src/features/draft-resume/
  hooks/useDraftAutosave.ts      // debounced save
  hooks/useDraftList.ts          // list open drafts
  hooks/useDraftResume.ts        // hydrate form
  components/ResumeBanner.tsx    // dashboard banner
  components/DraftsList.tsx      // drafts page
  components/SyncStatusBadge.tsx // Saved / Saving… / Offline
  lib/draftStorage.ts            // localStorage w/ versioning
  lib/draftSync.ts               // Supabase sync, last-write-wins
  lib/types.ts
```

## Behavior

- Debounce form changes by 800ms; on each change write localStorage synchronously, queue Supabase upsert async
- On `visibilitychange=hidden` and `beforeunload`, force-flush both stores
- On mount after auth: query top 5 drafts, merge with localStorage (local wins if newer)
- Show `ResumeBanner` on dashboard if any draft within last 7 days
- Offline: queue upserts in IndexedDB (idb-keyval), drain on `online` event
- Conflict: last-write-wins keyed on `client_updated_at`. If both devices edited, show diff modal
- Cleanup: delete draft on invoice finalize; drafts >30d old auto-deleted by Supabase scheduled function or daily Vercel cron

## Edge cases

- Different user signs in: scope localStorage keys by userId
- Schema evolution: include `schemaVersion` in payload; migrate or discard with toast
- Multi-tab in same browser: `BroadcastChannel('invoice-drafts')` to sync
- Mobile: use Capacitor `Preferences` plugin as primary store; listen `appStateChange` and `pause` to flush

## Tests

- Unit: draftStorage save/load/clear with version migration
- Unit: draftSync upsert with mocked Supabase client
- E2E: fill form → reload → banner → resume → fields hydrated
- E2E offline: throttle to offline → type → reload → still there → online → Supabase row exists

## Rollout

1. PR 1: migration only. Apply via Supabase CLI or dashboard.
2. PR 2: draft-resume feature + form integration. Merge to main → Vercel auto-deploys to higrade-invoicing.vercel.app for testing.
3. Once stable, merge main → vps-deploy to push to https://app.higradeplumbing.com.

---

## Building it with Claude Code

On your Mac mini:

```bash
cd ~/path/to/higrade-invoicing
git fetch origin && git checkout main && git pull
git checkout -b feature/invoice-draft-resume
claude code
```

Paste this entire spec as the first message to Claude Code, then iterate. It can read your existing form, write migrations, run `npm run dev`, run tests, and commit.

## Done definition

- [ ] Migration applied to Supabase project cwhgcxxszyvevjpbnnkc
- [ ] Auto-save fires within 800ms of last keystroke
- [ ] Resume banner appears if recent draft exists
- [ ] Drafts list page works
- [ ] Offline edits survive reload and sync when back online
- [ ] Multi-tab edits don't conflict destructively
- [ ] Capacitor build verified on iPhone
- [ ] Vercel deploy at higrade-invoicing.vercel.app passes regression
- [ ] VPS deploy at app.higradeplumbing.com receives feature after vps-deploy merge

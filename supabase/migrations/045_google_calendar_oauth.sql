-- 045_google_calendar_oauth.sql
-- ─── Server-side Google Calendar OAuth (offline refresh token) ─────────────
--
-- Replaces the browser implicit flow in src/googleCalendar.js, which asked
-- Google Identity Services for an access token in the page. That flow issues a
-- token good for one hour and NO refresh token, kept in localStorage. Result:
-- the calendar disconnected roughly hourly, per browser and per device, and
-- silentRefresh() only papered over it while a live Google session cookie
-- existed. Safari and the Capacitor shell block that cookie, so on the phone it
-- never worked at all.
--
-- Google only issues a refresh token to a server-side code exchange
-- (access_type=offline). So the exchange moves to /api/gcal-auth and the
-- credential lives here. Connect once, on any machine, and every other machine
-- and the iOS build are connected too, because the grant is in the database
-- rather than in one browser's localStorage.
--
-- WHY NOT settings: db.js does `supabase.from('settings').select('*')` on load,
-- so every row in that table is shipped to every signed-in browser. A refresh
-- token there would be readable from devtools by any user, including the test
-- plumber account. This table has RLS on and NO policies, so PostgREST denies
-- anon and authenticated outright and only the service-role key used by the
-- /api routes can read it.
--
-- STILL REQUIRED after applying this: the Google Cloud OAuth consent screen
-- must be published to Production. Left in "Testing", Google expires refresh
-- tokens after 7 days and the same disconnect symptom returns weekly — the
-- trap already called out in the header of 033_calendar_webhook.sql.

create table if not exists public.google_credentials (
  id                       text primary key default 'google_calendar',
  refresh_token            text,
  access_token             text,
  access_token_expires_at  timestamptz,
  scope                    text,
  google_email             text,
  -- Which calendar the app reads and writes. Defaults to 'primary', but the
  -- AI receptionist's Apps Script writes to the shared Work calendar, so the
  -- app must point at the same one or the two-way reconciliation added in
  -- "Reconcile visits with Google Calendar in both directions" compares two
  -- unrelated calendars and never matches anything.
  calendar_id              text not null default 'primary',
  connected_at             timestamptz,
  updated_at               timestamptz not null default now(),
  constraint google_credentials_singleton check (id = 'google_calendar')
);

alter table public.google_credentials enable row level security;

-- No policies on purpose. RLS with zero policies denies every request that
-- comes through PostgREST with the anon or authenticated role; the service
-- role bypasses RLS entirely. Do not add a policy here.

insert into public.google_credentials (id, calendar_id)
values ('google_calendar', 'primary')
on conflict (id) do nothing;

comment on table public.google_credentials is
  'Single-row Google OAuth grant for the calendar sync. Service-role only — never expose through PostgREST or the settings table.';

-- 012_auth_lockdown.sql
-- Switches every app table from "anon can do anything" to "only authenticated
-- users can read/write." After applying this, the web + iOS app will refuse
-- to load until the user signs in via Supabase Auth.
--
-- The /v/<token> public viewer keeps working because it's been refactored
-- to fetch through /api/public-invoice (server-side, service-role key).
-- Server-side endpoints (paypal-*, track-open, submit-signature, register-
-- device, public-invoice, _lib/notify) all use the service-role key which
-- bypasses RLS, so webhooks keep working.
--
-- HOW TO APPLY:
--   1. In Supabase dashboard SQL editor, paste this whole file and Run.
--   2. Then go to Authentication > Users and click "Add user" to create
--      your account. Use jacobmip@gmail.com and a strong password.
--   3. Authentication > Providers: turn OFF "Enable signups" so nobody else
--      can create accounts. (Settings > Auth > User signups.)
--   4. Reload the app. You'll see the login screen. Sign in.

-- Loop over every app table and replace its "anon" policy with one
-- scoped to authenticated users.
do $$
declare
  t text;
  app_tables text[] := array[
    'invoices',
    'invoice_items',
    'payments',
    'clients',
    'saved_items',
    'expenses',
    'settings',
    'invoice_versions',
    'invoice_events'
  ];
begin
  foreach t in array app_tables
  loop
    -- Make sure RLS is on (cheap, idempotent).
    execute format('alter table public.%I enable row level security', t);

    -- Drop old anon policy if it exists. Names vary between historical
    -- migrations so we drop a few likely candidates.
    execute format('drop policy if exists "anon_all" on public.%I', t);
    execute format('drop policy if exists "%s_anon_all" on public.%I', t, t);
    execute format('drop policy if exists "auth_all" on public.%I', t);

    -- Single permissive policy for any signed-in user. Single-tenant app,
    -- so we don't need per-row owner checks.
    execute format(
      'create policy "auth_all" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end$$;

-- Notifications table from migration 011 already has the right policies
-- (anon read/update for the bell icon, no anon insert/delete). Tighten the
-- read/update to authenticated too so the bell icon is owner-only.
alter table public.notifications enable row level security;
drop policy if exists notifications_anon_read on public.notifications;
drop policy if exists notifications_anon_update on public.notifications;
create policy notifications_auth_read on public.notifications
  for select to authenticated using (true);
create policy notifications_auth_update on public.notifications
  for update to authenticated using (true) with check (true);

-- device_tokens stays service-role only (already configured in 011).

-- Sanity: nothing should remain on the 'anon' role for these tables.
-- If a stray policy is found, this raises a notice in the SQL editor so
-- we know to clean it up.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('invoices','invoice_items','payments','clients','saved_items','expenses','settings','invoice_versions','invoice_events','notifications')
      and 'anon' = any(roles)
  loop
    raise notice 'WARNING: anon-role policy still present: %.% -> %', r.schemaname, r.tablename, r.policyname;
  end loop;
end$$;

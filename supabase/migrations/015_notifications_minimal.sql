-- ─── In-app notification feed (minimal) ─────────────────────────────────────
--
-- BACKGROUND:
--   Migration 011_notifications was authored but never applied — first because
--   we hadn't built the bell-icon UI, then because 012_auth_lockdown was
--   modified to remove its notifications policy block. As a result, the
--   PayPal capture handler's notifyAll() call has been silently failing every
--   payment because public.notifications does not exist. The fetch returns a
--   PGRST205 ("table not in schema cache") and the row is dropped — the user
--   never gets an in-app alert that money came in.
--
-- WHAT THIS DOES:
--   Creates public.notifications only. Skips device_tokens (APNs) since push
--   credentials aren't configured yet — when push is set up later, add the
--   token table in a separate migration. RLS is set up so the authenticated
--   user (single-tenant) can read + mark-read; only the service role inserts.
--
-- AFTER APPLYING:
--   The next PayPal payment will write a row here. The bell-icon UI in the
--   app reads from this table via the existing supabase client.

create table if not exists public.notifications (
  id          bigserial primary key,
  type        text not null,
  title       text not null,
  body        text not null,
  invoice_id  text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists notifications_created_idx on public.notifications(created_at desc);
create index if not exists notifications_unread_idx on public.notifications(read_at) where read_at is null;

alter table public.notifications enable row level security;

-- Authenticated user can read + mark-as-read. Inserts only via service role
-- (used by /api/paypal-capture-order, /api/paypal-webhook, etc.).
drop policy if exists notifications_auth_read on public.notifications;
create policy notifications_auth_read on public.notifications
  for select to authenticated using (true);

drop policy if exists notifications_auth_update on public.notifications;
create policy notifications_auth_update on public.notifications
  for update to authenticated using (true) with check (true);

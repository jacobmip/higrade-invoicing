-- 011_notifications.sql
-- Adds the in-app notification feed + APNs device token registry.
--
-- The Capacitor iOS app calls /api/register-device on launch to upsert
-- a row in device_tokens. Server-side payment / open / signature events
-- insert a row into notifications and fan a push to every active token.
-- The web app reads notifications directly via the existing anon client
-- so the bell icon works in both web and the WKWebView wrapped app.

create table if not exists public.device_tokens (
  id          bigserial primary key,
  token       text not null unique,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  bundle_id   text,
  app_version text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_tokens_platform_idx on public.device_tokens(platform);
create index if not exists device_tokens_last_seen_idx on public.device_tokens(last_seen_at desc);

alter table public.device_tokens enable row level security;

-- Only the service role writes/reads tokens. The Capacitor app posts
-- through /api/register-device which uses the service key; the front-end
-- never touches this table directly.
drop policy if exists device_tokens_no_anon on public.device_tokens;
create policy device_tokens_no_anon on public.device_tokens
  for all using (false) with check (false);


create table if not exists public.notifications (
  id          bigserial primary key,
  type        text not null,             -- 'payment' | 'invoice_open' | 'estimate_signed' | etc.
  title       text not null,
  body        text not null,
  invoice_id  text,                      -- optional FK-ish reference (kept loose; invoice ids are app-level strings)
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists notifications_created_idx on public.notifications(created_at desc);
create index if not exists notifications_unread_idx on public.notifications(read_at) where read_at is null;

alter table public.notifications enable row level security;

-- Single-tenant app: anon role can read + mark-read. Inserts only via service role.
drop policy if exists notifications_anon_read on public.notifications;
create policy notifications_anon_read on public.notifications
  for select using (true);

drop policy if exists notifications_anon_update on public.notifications;
create policy notifications_anon_update on public.notifications
  for update using (true) with check (true);

drop policy if exists notifications_no_anon_insert on public.notifications;
create policy notifications_no_anon_insert on public.notifications
  for insert with check (false);

drop policy if exists notifications_no_anon_delete on public.notifications;
create policy notifications_no_anon_delete on public.notifications
  for delete using (false);

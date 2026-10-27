-- 088_client_messages_read_at.sql
-- Read state for the Messages tab. NULL read_at on an inbound row = unread.
-- Existing rows are backfilled as read, so the first open is not a flood of
-- unread badges. The app only counts inbound rows with a null read_at.
-- No policy change: client_messages_modify (owner or admin, ALL) already
-- allows the admin to UPDATE read_at.
begin;

alter table public.client_messages add column if not exists read_at timestamptz;

update public.client_messages set read_at = created_at where read_at is null;

create index if not exists client_messages_unread_idx
  on public.client_messages (created_at desc)
  where direction = 'inbound' and read_at is null;

commit;

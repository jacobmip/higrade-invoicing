-- ============================================================
-- 019_client_versions.sql
-- Full snapshot history for every client save/update.
-- Mirrors the invoice_versions pattern.
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new
-- ============================================================

create table if not exists client_versions (
  id             uuid        primary key default gen_random_uuid(),
  client_id      uuid        references clients(id) on delete cascade,
  version_number integer     not null,
  snapshot       jsonb       not null,
  note           text,
  owner_id       uuid        references auth.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists client_versions_client_id_idx
  on client_versions (client_id, version_number desc);

alter table client_versions enable row level security;

-- Only the owning user (or an admin) can read/write their client versions.
drop policy if exists "client_versions_owner" on client_versions;
create policy "client_versions_owner" on client_versions
  for all to authenticated
  using  (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

-- Auto-stamp owner_id on insert using the existing set_owner_id trigger function.
drop trigger if exists trg_client_versions_owner on client_versions;
create trigger trg_client_versions_owner
  before insert on client_versions
  for each row execute function set_owner_id();

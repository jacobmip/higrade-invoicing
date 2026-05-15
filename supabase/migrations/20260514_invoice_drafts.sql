-- supabase/migrations/20260514_invoice_drafts.sql
-- Auto-save / resume storage for in-progress invoices.

create extension if not exists "pgcrypto";

create table if not exists public.invoice_drafts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  invoice_number  text,
  client_name     text,
  total           numeric(12,2) default 0,
  payload         jsonb not null default '{}'::jsonb,
  finalized       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists invoice_drafts_user_updated_idx
  on public.invoice_drafts (user_id, updated_at desc);

create index if not exists invoice_drafts_unfinalized_idx
  on public.invoice_drafts (user_id, finalized, updated_at desc);

-- updated_at trigger
create or replace function public.invoice_drafts_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_invoice_drafts_updated_at on public.invoice_drafts;
create trigger trg_invoice_drafts_updated_at
  before update on public.invoice_drafts
  for each row execute function public.invoice_drafts_set_updated_at();

-- RLS: each user can only see their own drafts.
alter table public.invoice_drafts enable row level security;

drop policy if exists invoice_drafts_select_own on public.invoice_drafts;
create policy invoice_drafts_select_own on public.invoice_drafts
  for select using (auth.uid() = user_id);

drop policy if exists invoice_drafts_insert_own on public.invoice_drafts;
create policy invoice_drafts_insert_own on public.invoice_drafts
  for insert with check (auth.uid() = user_id);

drop policy if exists invoice_drafts_update_own on public.invoice_drafts;
create policy invoice_drafts_update_own on public.invoice_drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists invoice_drafts_delete_own on public.invoice_drafts;
create policy invoice_drafts_delete_own on public.invoice_drafts
  for delete using (auth.uid() = user_id);

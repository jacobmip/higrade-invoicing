-- Invoice Draft Auto-Save & Resume
-- Branch: vps-deploy
-- Apply via: supabase db push  (or paste into Supabase SQL editor)

create extension if not exists "pgcrypto";

create table if not exists public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid null,                -- null = brand-new draft; set when linked to a real invoice
  client_id uuid null,
  title text null,
  payload jsonb not null default '{}'::jsonb,
  client_rev bigint not null default 0, -- monotonic counter from the client for conflict detection
  device_id text null,                  -- which device last wrote
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoice_drafts_user_updated_idx
  on public.invoice_drafts (user_id, updated_at desc);

create index if not exists invoice_drafts_invoice_idx
  on public.invoice_drafts (invoice_id);

-- updated_at trigger
create or replace function public.tg_invoice_drafts_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists invoice_drafts_touch on public.invoice_drafts;
create trigger invoice_drafts_touch
  before update on public.invoice_drafts
  for each row execute function public.tg_invoice_drafts_touch();

-- RLS: single-tenant style, each user only sees their own drafts
alter table public.invoice_drafts enable row level security;

drop policy if exists "invoice_drafts_select_own" on public.invoice_drafts;
create policy "invoice_drafts_select_own"
  on public.invoice_drafts for select
  using (auth.uid() = user_id);

drop policy if exists "invoice_drafts_insert_own" on public.invoice_drafts;
create policy "invoice_drafts_insert_own"
  on public.invoice_drafts for insert
  with check (auth.uid() = user_id);

drop policy if exists "invoice_drafts_update_own" on public.invoice_drafts;
create policy "invoice_drafts_update_own"
  on public.invoice_drafts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "invoice_drafts_delete_own" on public.invoice_drafts;
create policy "invoice_drafts_delete_own"
  on public.invoice_drafts for delete
  using (auth.uid() = user_id);

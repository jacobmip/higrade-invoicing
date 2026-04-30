-- HiGrade Invoicing — Schema repair + invoice_versions
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql
--
-- ROOT CAUSE OF DATA DIVERGENCE
-- ─────────────────────────────────────────────────────────────────────────────
-- The deployed Supabase schema is a partial / older version of the one in
-- migration 001. Several columns the client code writes do NOT exist on the
-- server, so writes fail with PGRST204 ("column not found in schema cache"),
-- the JS throws, and the app silently falls back to per-device localStorage.
-- That's why Safari (home-screen) and Chrome show different data.
--
-- Missing on the live DB (verified via REST probes):
--   invoices:       client_name, discount_type, gcal_date, gcal_event_id,
--                   follow_up_date, follow_up_event_id, signature_data,
--                   signed_at, client_info
--   invoice_items:  discount_type
--   payments:       note
--   tables:         expenses, settings, invoice_versions
--
-- This migration is idempotent — safe to run multiple times.

-- ─── invoices: add missing columns ────────────────────────────────────────────

alter table invoices add column if not exists client_name         text;
alter table invoices add column if not exists discount_type       text default '$';
alter table invoices add column if not exists gcal_date           text;
alter table invoices add column if not exists gcal_event_id       text;
alter table invoices add column if not exists follow_up_date      date;
alter table invoices add column if not exists follow_up_event_id  text;
alter table invoices add column if not exists signature_data      text;
alter table invoices add column if not exists signed_at           timestamptz;
alter table invoices add column if not exists client_info         jsonb;

-- ─── invoice_items: add missing columns ───────────────────────────────────────

alter table invoice_items add column if not exists discount_type text default '%';

-- ─── payments: add missing columns ────────────────────────────────────────────

alter table payments add column if not exists note text;

-- ─── expenses (was missing entirely) ──────────────────────────────────────────

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  date date,
  merchant text,
  amount numeric,
  category text,
  description text,
  receipt_data text,
  created_at timestamptz default now()
);

-- ─── settings (was missing entirely) ──────────────────────────────────────────

create table if not exists settings (
  key text primary key,
  value text
);

insert into settings (key, value)
values ('next_num', '753')
on conflict (key) do nothing;

-- ─── invoice_versions — snapshots created every time an invoice is sent ──────

create table if not exists invoice_versions (
  id uuid primary key default gen_random_uuid(),
  invoice_id text references invoices(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  sent_to text,
  sent_at timestamptz default now(),
  note text
);

create index if not exists invoice_versions_invoice_id_idx
  on invoice_versions (invoice_id, version_number desc);

-- ─── Open RLS policies for the anon role on all app tables ────────────────────
-- This is a single-tenant business app with the anon key shipped in the client.
-- Read/insert/update/delete are intentionally allowed for the anon role.
-- If you ever add per-user auth, replace these with auth.uid()-scoped policies.

do $$
declare
  t text;
  tables text[] := array[
    'clients',
    'invoices',
    'invoice_items',
    'payments',
    'saved_items',
    'invoice_history',
    'expenses',
    'settings',
    'invoice_versions'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all" on %I', t);
    execute format(
      'create policy "anon_all" on %I for all to anon using (true) with check (true)',
      t
    );
  end loop;
end $$;

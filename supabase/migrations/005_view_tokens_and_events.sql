-- 005_view_tokens_and_events.sql
-- Trackable links + activity events.
--
-- Adds:
--   1. invoices.view_token  — random short token used in public viewer URLs
--      (https://higrade-invoicing.vercel.app/v/<token>). Auto-generated for
--      new rows; existing rows get tokens lazily on first send.
--   2. invoice_events       — a unified event log. Each row records something
--      that happened to an invoice/estimate: it was sent, the recipient
--      opened the public viewer, etc. Used by the History tab UI and by
--      the /api/track-open endpoint (de-dup window for opens).
--
-- This migration is idempotent — safe to re-run.

-- ─── invoices.view_token ──────────────────────────────────────────────────────

alter table invoices add column if not exists view_token text;

create unique index if not exists invoices_view_token_uniq
  on invoices(view_token)
  where view_token is not null;

-- ─── invoice_events ───────────────────────────────────────────────────────────

create table if not exists invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id text references invoices(id) on delete cascade,
  kind text not null,                       -- 'sent' | 'opened' | future kinds
  recipient text,                           -- email address for 'sent' events
  meta jsonb,                               -- e.g. { user_agent, ip_hash } for opens
  created_at timestamptz default now()
);

create index if not exists invoice_events_invoice_id_idx
  on invoice_events (invoice_id, created_at desc);

-- ─── RLS — single-tenant; same policy as the other tables ─────────────────────

alter table invoice_events enable row level security;
drop policy if exists "anon_all" on invoice_events;
create policy "anon_all" on invoice_events
  for all to anon
  using (true)
  with check (true);

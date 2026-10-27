-- 067_vapi_calls.sql
-- ─── One row per Lisa call, linked to its estimate ─────────────────────────
--
-- Lisa's recordings live in Vapi. To play one from the app we need the Vapi
-- call id, and nothing stored it against the estimate: create_estimate_from_lead
-- takes no call id, and only an abandoned call wrote one, as text inside
-- internal_notes.
--
-- /api/vapi-call-ended now writes a row here at the end of every call. It
-- already learns the estimate from capture_abandoned_call(), which returns the
-- estimate_id both when it files one and when it finds the one Lisa filed
-- during the call. The app lists these rows on the estimate, and the audio is
-- fetched from Vapi on demand by api/_lib/call-recording.js, so no audio is
-- stored here.
--
-- A table rather than a column on invoices: a customer can call more than once
-- about the same job, a call can belong to no estimate (no caller id), and a
-- separate table keeps this out of save_invoice_with_items entirely.
--
-- No foreign key to invoices on purpose: a hard-deleted estimate should not
-- make the webhook's insert fail, and an orphan row is harmless.
--
-- Writes: service role only (the webhook). Reads: admins. Recordings of
-- customers are more sensitive than anything else in this database.
--
-- Run in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

create table if not exists public.vapi_calls (
  call_id     text primary key,
  invoice_id  text,
  phone       text,
  seconds     int,
  created_at  timestamptz not null default now()
);

create index if not exists vapi_calls_invoice_id_idx on public.vapi_calls (invoice_id);

alter table public.vapi_calls enable row level security;

drop policy if exists vapi_calls_admin_read on public.vapi_calls;
create policy vapi_calls_admin_read on public.vapi_calls
  for select to authenticated
  using (public.is_admin());

revoke all on public.vapi_calls from anon;
revoke insert, update, delete on public.vapi_calls from authenticated;

-- Abandoned calls already recorded their call id in internal_notes
-- ("Vapi call id: <uuid>", migration 035). Link those now so their recordings
-- are playable too. Calls Lisa completed before today stored no id anywhere.
insert into public.vapi_calls (call_id, invoice_id, created_at)
select substring(internal_notes from 'Vapi call id: ([0-9a-fA-F-]{36})'),
       id,
       coalesce(created_at, now())
  from public.invoices
 where internal_notes ~ 'Vapi call id: [0-9a-fA-F-]{36}'
on conflict (call_id) do nothing;

select count(*) as calls_linked from public.vapi_calls;

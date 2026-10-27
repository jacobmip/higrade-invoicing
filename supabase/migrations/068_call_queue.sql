-- 068_call_queue.sql
-- ─── Outbound calls: a queue Jake fills by hand ────────────────────────────
--
-- Lisa has only ever answered. This is the other direction: a row here is a
-- call HI Grade intends to place. Nothing in the system writes to this table
-- on its own that a runner will dial. Every dialable row is put here or
-- RELEASED deliberately, by Jake through the manager bot or
-- scripts/outbound_call.py, because calling a customer is a different consent
-- question from emailing one and an automatic trigger is how you end up
-- robo-dialling someone at 6am. (Amended by 076: the abandoned-call net may
-- file a status='suggested' row, which the runner never selects until a person
-- moves it to 'queued'.)
--
-- Why a table and not just a cron that queries invoices:
--   * the reason for the call has to be written down by a person and read back
--     verbatim to the assistant, so the model never invents why it is calling
--   * a call that fails needs to be retried without being re-derived
--   * the outcome has to come from Vapi's own call record, not from the
--     script's claim that it placed a call. status is advanced by reconciling
--     against vapi_calls / the Vapi API, never stamped optimistically.
--
-- Three independent brakes, all of which must be released for a call to go:
--   1. settings.outbound_calls_enabled, seeded 'false' here. Nothing in the
--      codebase writes it, so the system cannot turn itself on.
--   2. scheduled_for must be in the past, and the runner refuses outside
--      Hawaii calling hours (it reads settings.outbound_call_hours).
--   3. status must be 'queued'. A row goes to 'calling' before the API call
--      and never returns to 'queued' by itself.
--
-- Run in the Supabase SQL editor, or scripts/apply-migration.py:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

create table if not exists public.call_queue (
  id            bigserial primary key,
  phone         text not null,
  client_name   text,
  client_id     uuid,
  invoice_id    text,
  -- Read to the assistant as the reason for the call. Written by a person.
  purpose       text not null,
  -- Anything the assistant may state or confirm: an appointment being moved,
  -- a part that arrived. Never amounts of money; the prompt forbids those.
  context       text,
  scheduled_for timestamptz not null default now(),
  status        text not null default 'queued',
  attempts      int  not null default 0,
  vapi_call_id  text,
  outcome       text,
  queued_by     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint call_queue_status_ck
    check (status in ('queued','calling','done','failed','cancelled'))  -- 076 adds 'suggested'
);

create index if not exists call_queue_due_idx
  on public.call_queue (status, scheduled_for);

create or replace function public.call_queue_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists call_queue_touch_trg on public.call_queue;
create trigger call_queue_touch_trg
  before update on public.call_queue
  for each row execute function public.call_queue_touch();

-- Same posture as vapi_calls: the service role (the runner) writes, admins
-- read. A customer's phone number and the reason we are calling them is not
-- something the anon key should ever see.
alter table public.call_queue enable row level security;

drop policy if exists call_queue_admin_read on public.call_queue;
create policy call_queue_admin_read on public.call_queue
  for select to authenticated
  using (public.is_admin());

revoke all on public.call_queue from anon;
revoke insert, update, delete on public.call_queue from authenticated;

-- ─── The kill switch, off ──────────────────────────────────────────────────
-- Seeded false. Flipping it is a deliberate act in the dashboard:
--   update settings set value = 'true' where key = 'outbound_calls_enabled';
insert into public.settings (key, value)
     values ('outbound_calls_enabled', 'false')
on conflict (key) do nothing;

-- Hawaii local hours the runner will dial inside, inclusive start, exclusive
-- end. 8am to 7pm is deliberately narrower than what is legal.
insert into public.settings (key, value)
     values ('outbound_call_hours', '8-19')
on conflict (key) do nothing;

select (select value from public.settings where key = 'outbound_calls_enabled') as enabled,
       (select value from public.settings where key = 'outbound_call_hours')    as hours,
       (select count(*) from public.call_queue)                                 as queued;

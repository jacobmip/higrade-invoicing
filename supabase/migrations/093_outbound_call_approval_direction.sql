-- 093_outbound_call_approval_direction.sql
-- Outbound call plumbing, three small additions.
--
--   vapi_calls.direction   'inbound' (default) | 'outbound'. The runner in
--                          AI-OS/scripts/outbound_call.py writes outbound rows
--                          itself because the outbound assistant has no
--                          server.url, so the app can label them.
--   call_queue.approval    Jake's Telegram answer to the pre-dial gate:
--                          null (not asked / waiting) | 'approved' | 'denied'.
--                          Written by the manager bot (telegram-bot/bot.js),
--                          read by outbound_call.py. The bot already owns
--                          Telegram's getUpdates stream, so the script never
--                          polls Telegram itself.
--   call_queue.approval_asked_at   when the gate message went out.
--   call_queue.notified    the call-summary email has been sent.
--
-- Additive, touches no policy. Existing finished rows are marked notified so
-- the first `check` after this lands does not email history.
--
-- Run with scripts/apply-migration.py (AI-OS), or:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

begin;

alter table public.vapi_calls
  add column if not exists direction text not null default 'inbound';

alter table public.vapi_calls drop constraint if exists vapi_calls_direction_check;
alter table public.vapi_calls
  add constraint vapi_calls_direction_check check (direction in ('inbound', 'outbound'));

alter table public.call_queue add column if not exists approval text;
alter table public.call_queue add column if not exists approval_asked_at timestamptz;
alter table public.call_queue add column if not exists notified boolean not null default false;

alter table public.call_queue drop constraint if exists call_queue_approval_check;
alter table public.call_queue
  add constraint call_queue_approval_check check (approval is null or approval in ('approved', 'denied'));

update public.call_queue set notified = true where status in ('done', 'failed', 'cancelled');

commit;

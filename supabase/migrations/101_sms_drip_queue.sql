-- 101_sms_drip_queue.sql
--
-- Follow-up texts for an outbound Lisa call that ended with no estimate filed.
-- Message 1 goes out immediately from /api/vapi-call-ended; messages 2 and 3
-- are rows here, sent by AI-OS/scripts/sms_drip.py when scheduled_at passes.
-- /api/sms-inbound stamps stopped_at when the customer replies.
--
-- RLS is enabled with no policies on purpose: only the service role touches
-- this table. Without it the anon key could read every pending customer text.

begin;

create table if not exists public.sms_drip_queue (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  call_id text,
  message_index integer not null default 1,
  message text not null,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  created_at timestamptz default now()
);

create index if not exists sms_drip_queue_due_idx
  on public.sms_drip_queue (phone, sent_at, stopped_at, scheduled_at);

alter table public.sms_drip_queue enable row level security;

commit;

-- 108_vapi_calls_client_transcript.sql
--
-- The Calls tab (v1.45.0) lists every vapi_calls row, linked to a client or
-- estimate or not. Three columns make a row useful on its own:
--   client_id      the client matched by phone (last 10 digits). No foreign key,
--                  same as invoice_id: a call must outlive its client record.
--   transcript     the call transcript, capped at 20000 characters by the writers.
--   call_queue_id  the call_queue row that produced an outbound call; inbound
--                  calls leave it null. bigint because call_queue.id is bigserial.
-- No policy change: vapi_calls stays admin-read, service-role write.

begin;

alter table public.vapi_calls add column if not exists client_id uuid;
alter table public.vapi_calls add column if not exists transcript text;
alter table public.vapi_calls add column if not exists call_queue_id bigint;

commit;

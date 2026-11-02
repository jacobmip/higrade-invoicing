-- 107_call_queue_approval_token.sql
--
-- Approve an outbound call from a link instead of only from Telegram.
-- call_queue.approval_token is a random, unguessable string (12 random bytes,
-- base64url) minted by api/sms-inbound.js when it files the row. The page at
-- /approve-call?token=... reads and answers through api/approve-call.js, which
-- writes the same call_queue.approval column the Telegram APPROVE reply writes
-- (migration 093), so the runner needs no change to honour it.
--
-- Nullable: rows queued before this migration, and rows filed by
-- scripts/outbound_call.py, have no link. Unique so a token names one call.
-- No policy change: call_queue stays service-role write, admin read.

alter table public.call_queue add column if not exists approval_token text;

create unique index if not exists call_queue_approval_token_uq
  on public.call_queue (approval_token)
  where approval_token is not null;

commit;

-- 110: per-client switch for Lisa's SMS auto-reply.
-- Default true so every existing client keeps getting auto-replies unchanged.
-- Read by autoReply() in api/_lib/sms-agent.js; toggled from ClientThread (admin only).
begin;
alter table public.clients add column if not exists lisa_autoreply boolean not null default true;
commit;

-- 132_ai_chat_logs.sql
--
-- Every AI chat exchange in the app (the line-item AI button, the header AI
-- chat, the chat agent): who asked, on which document, what they typed, what
-- the AI answered and which actions it emitted. Jake, 2026-11-18: "I need to
-- have a chat history for all users so I can see how they are utilizing AI
-- to price jobs out. Admin access only."
--
-- Written from the browser under the user's own session (same pattern as
-- on_my_way_pings, migration 131). Anyone signed in can add their own rows;
-- only an admin can read them, so techs never see each other's chats or
-- their own log.

begin;

create table if not exists public.ai_chat_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  surface     text not null,            -- 'line_items' | 'header_chat' | 'agent'
  invoice_id  text,                     -- open document, if any (no FK: may be unsaved)
  prompt      text not null default '',
  reply       text not null default '',
  actions     jsonb,
  photos      int not null default 0,
  model       text,
  created_at  timestamptz not null default now()
);

create index if not exists ai_chat_logs_created_idx on public.ai_chat_logs (created_at desc);
create index if not exists ai_chat_logs_user_idx on public.ai_chat_logs (user_id, created_at desc);

alter table public.ai_chat_logs enable row level security;

drop policy if exists ai_chat_logs_insert on public.ai_chat_logs;
create policy ai_chat_logs_insert on public.ai_chat_logs
  for insert with check (user_id = auth.uid());

drop policy if exists ai_chat_logs_admin on public.ai_chat_logs;
create policy ai_chat_logs_admin on public.ai_chat_logs
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';

commit;

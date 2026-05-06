-- ============================================================
-- 018_ai_chat_history.sql
-- One row per user storing their global AI chat as JSONB.
-- Owner-scoped via RLS so each user only ever sees their own.
-- ============================================================

create table if not exists ai_chat_history (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  messages   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table ai_chat_history enable row level security;

-- A user can read and write only their own row. Admins do NOT bypass here:
-- chat is private even from the boss. (We can revisit later if needed.)
drop policy if exists ai_chat_history_self on ai_chat_history;
create policy ai_chat_history_self on ai_chat_history
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Auto-bump updated_at on update.
create or replace function ai_chat_history_touch() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists trg_ai_chat_history_touch on ai_chat_history;
create trigger trg_ai_chat_history_touch before update on ai_chat_history
  for each row execute function ai_chat_history_touch();

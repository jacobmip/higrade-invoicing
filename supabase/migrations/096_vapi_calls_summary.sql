-- 096_vapi_calls_summary.sql
--
-- Client Communications tab. vapi_calls.direction already exists (093), so the
-- ADD COLUMN IF NOT EXISTS below is a harmless no-op kept for safety. What is
-- new is `summary`, the call summary from Vapi's end-of-call report, so the
-- timeline can show it without calling Vapi.
--
-- Run with scripts/apply-migration.py (AI-OS), or:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

begin;

alter table public.vapi_calls add column if not exists direction text not null default 'inbound';
alter table public.vapi_calls add column if not exists summary text;

commit;

-- 074_log_client_message_overload.sql
--
-- Numbered 074, not 069. It was written as 069 and applied to production under
-- that name on 2026-10-27, then renumbered the same day because another session
-- already held 069_assigned_tech_can_work_the_job.sql. The repo has been here
-- before: the receptionist migrations were renumbered 020-024 -> 023-027 on
-- 2026-08-24 for the same reason. Check `ls supabase/migrations` before picking
-- a number, not just the last one you remember.
-- ─── Drop the duplicate, which has been eating every outbound text ────────
--
-- public.log_client_message existed twice:
--
--   log_client_message(text,text,text,text,text)        -- migration 034
--   log_client_message(text,text,text,text,text,jsonb)  -- + p_media, later
--
-- p_media has a DEFAULT, so a call naming the first five parameters matches
-- BOTH, and PostgREST will not guess. It answers PGRST203, "Could not choose
-- the best candidate function", and the caller gets an exception.
--
-- That is exactly what happened to every outbound message we have ever sent.
-- api/sms-inbound.js always passes p_media, so inbound logging resolved to the
-- six-argument version and worked: 12 rows on file. Everything that logs an
-- OUTBOUND message passes four or five arguments and so resolved to neither:
--
--   api/vapi-call-ended.js      the post-call kickoff text
--   scripts/invoice_followup.py two places, both outbound
--
-- Result, found 2026-10-27: client_messages held 12 inbound rows and ZERO
-- outbound, across seven weeks. The texts were delivered. Customers replied to
-- them. The stored thread just showed one side of the conversation, and the
-- failure was invisible because the send happens first and the logging error is
-- caught and logged to a console nobody reads.
--
-- This is the same disease migration 065 found in create_estimate_from_lead,
-- which is why 065 refuses to run against an overloaded function. Dropping the
-- older signature is the fix; every named-argument call then resolves to the
-- six-argument version with p_media defaulting to null.
--
-- Safe because PostgREST calls by name, not position, and no caller passes
-- arguments positionally.
--
-- Run in the Supabase SQL editor, or scripts/apply-migration.py:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

drop function if exists public.log_client_message(text, text, text, text, text);

-- ─── And the switch for Lisa answering texts, off ─────────────────────────
-- api/_lib/sms-agent.js reads this. Nothing in the codebase writes it.
insert into public.settings (key, value)
     values ('sms_autoreply_enabled', 'false')
on conflict (key) do nothing;

select (select count(*) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'log_client_message') as overloads_remaining,
       (select value from public.settings where key = 'sms_autoreply_enabled') as autoreply;

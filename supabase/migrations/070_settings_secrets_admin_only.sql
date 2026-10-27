-- 070_settings_secrets_admin_only.sql
--
-- The `settings` table had exactly one policy: `for all using (true)` to the
-- `authenticated` role. Any account that could log in could read AND write
-- every row.
--
-- Verified against production on 2026-10-26 by assuming the existing
-- non-admin test account's identity: it could read twilio_sid, twilio_token,
-- vapi_private_key and lead_secret, and could have flipped
-- outbound_calls_enabled to 'true'. That was theoretical while Jake was the
-- only real login. It stops being theoretical the moment an employee has one.
--
-- APPROACH: a deny-list on read, admin-only on write.
--
-- A deny-list rather than an allow-list because the app does
-- `settings.select('*')` in loadAll and reads whatever it finds. A new
-- business-config key must keep working for a plain tech without a migration;
-- a new *secret* is the thing that has to be named. The list below is
-- therefore grouped by WHY each key is restricted, so the next person adding
-- one knows where it goes.
--
-- Lisa, the SMS webhook, the outbound runner and every api/ route read this
-- table under the service_role key, which bypasses RLS entirely, so none of
-- them are affected.
--
-- The document counters ARE affected and are carved out below. They are the
-- one thing in this table a non-admin legitimately writes.

begin;

-- ── 1. Which keys are privileged, and why ──────────────────────────────────
create or replace function public.is_privileged_setting(p_key text)
returns boolean
language sql
immutable
as $$
  select p_key in (
    -- Credentials. Hand these over and you own the phone number.
    'twilio_sid', 'twilio_token', 'vapi_private_key',
    -- Shared secrets that authenticate inbound webhooks. Leak one and
    -- anything on the internet can file a lead or move the calendar.
    'lead_secret', 'sms_webhook_secret', 'gcal_webhook_secret',
    'gcal_webhook_url',
    -- Kill switches. An employee must not be able to start Lisa dialling
    -- customers, start the SMS sender, or arm the follow-up chaser.
    'outbound_calls_enabled', 'outbound_call_hours',
    'sms_outbound_enabled', 'bot_outbound_send_enabled',
    'invoice_followup_live',
    -- Where every alert goes. Repointing these is how an employee would stop
    -- Jake hearing about a lead.
    'notify_to', 'notify_from', 'lead_notify_to'
  );
$$;

comment on function public.is_privileged_setting(text) is
  'True for settings rows only an admin may read: credentials, webhook '
  'secrets, kill switches, and the alert destinations (migration 070).';

-- ── 2. Read: everything except the privileged rows ─────────────────────────
drop policy if exists auth_all on public.settings;

create policy settings_select on public.settings
  for select
  to authenticated
  using (public.is_admin() or not public.is_privileged_setting(key));

-- ── 3. Write: admin only, except the document counters ────────────────────
-- Every other key in this table is shop-wide: the payment instructions on the
-- PDF, the card surcharge, the review links, the message templates. None of
-- it is per-user, so there is no reading under which an employee should be
-- editing any of it. The four config cards in the app's Settings tab are
-- gated to admin in the same change so this never surfaces as a failed save.
--
-- THE COUNTER CARVE-OUT IS LOAD-BEARING. save_invoice_with_items is SECURITY
-- INVOKER and ends with an upsert of next_num / next_estimate_num whenever
-- is_new is true. Without this exception, a non-admin creating any document
-- at all would have the whole save fail on that last statement. Found by
-- reading the live function definition, not by testing, so the counter path
-- must be exercised by a real non-admin save before this is trusted.
--
-- The exposure it leaves is small and one-directional: both upserts wrap the
-- new value in greatest(excluded, existing), so a counter can only ever be
-- pushed forward. The worst an employee can do is skip the shop ahead to a
-- higher invoice number. allocate_doc_number() is SECURITY DEFINER and does
-- not need the carve-out, but it shares these keys, so the exception is
-- written per-key rather than per-caller.
create policy settings_write on public.settings
  for all
  to authenticated
  using      (public.is_admin() or key in ('next_num', 'next_estimate_num', 'next_doc_num'))
  with check (public.is_admin() or key in ('next_num', 'next_estimate_num', 'next_doc_num'));

commit;

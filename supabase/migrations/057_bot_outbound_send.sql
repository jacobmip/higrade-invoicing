-- 057_bot_outbound_send.sql
--
-- The gate on the HI Grade Manager bot sending a follow-up to a customer.
--
-- Deliberately a SECOND switch, separate from invoice_followup_live:
--
--   invoice_followup_live      the 9am cron may text everyone who is overdue
--   bot_outbound_send_enabled  Jake may ask the bot to send ONE message
--
-- They are different risks. The cron decides on its own and reaches many
-- people; the bot reaches one person because Jake just asked it to, after
-- reading the exact text and confirming it. Turning one on must not turn the
-- other on, so overdue auto-reminders can stay off forever while Jake still
-- sends follow-ups by hand.
--
-- Both default to false. Nothing reaches a customer until Jake flips a switch.

insert into public.settings (key, value) values
  ('bot_outbound_send_enabled', 'false')
on conflict (key) do nothing;

-- 050_backfill_lead_timestamps.sql
-- ─── Correct the historical lead dates and note headers ───────────────────
--
-- Migration 049 stopped create_estimate_from_lead rendering now() and
-- current_date in the server's UTC. This repairs the rows written before it.
--
-- All 10 ai_lead rows carry a date one day ahead, because every one of them was
-- an evening Hawaii call and the UTC server had already rolled over. Their note
-- headers are the same ten hours out, e.g. EST1015 reads "Sep 03, 08:07 AM" for
-- a call that came in at 10:07 PM on Sep 2.
--
-- Safe to rewrite: checked before applying that none of these has a single
-- 'sent', 'opened' or 'signed' event and none is signed. No customer has ever
-- seen a different date on any of them, so this corrects an internal record
-- rather than altering a document someone received. Do NOT extend this to
-- invoices that have been sent — there, the stored date is what the customer
-- holds, and it wins over what it should have been.
--
-- created_at is timestamptz, so it is the one field that was always recorded
-- correctly. Everything here is derived from it.

-- Document date: the Hawaii calendar day the call actually happened.
update public.invoices
   set date = ((created_at at time zone 'Pacific/Honolulu')::date)::text
 where source = 'ai_lead'
   and date is distinct from ((created_at at time zone 'Pacific/Honolulu')::date)::text;

-- Note header timestamp. Two dash styles exist in the data (an em dash on the
-- oldest two rows, a hyphen since), so the dash is captured and preserved
-- rather than normalised — the point is to fix the time, not restyle history.
-- Rows with no header line, like the hand-made ZZ-TEST row, simply do not match.
update public.invoices
   set internal_notes = regexp_replace(
         internal_notes,
         '^(AI receptionist \(Lisa\) lead [-—] )[^\n]*',
         '\1' || to_char(created_at at time zone 'Pacific/Honolulu', 'Mon DD, HH12:MI AM')
       )
 where source = 'ai_lead'
   and internal_notes ~ '^AI receptionist \(Lisa\) lead [-—] ';

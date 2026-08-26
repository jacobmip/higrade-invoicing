-- 040_shared_document_number.sql
--
-- One shared number sequence for estimates and invoices, so a converted
-- estimate keeps its number: EST1000 becomes INV1000.
--
-- The number now identifies the JOB, not the document. That is what makes the
-- pairing collision-proof -- a number is handed out once, so the invoice side
-- can never land on one the estimate side already issued. The cost, accepted
-- deliberately, is that invoice numbers are no longer contiguous: three
-- estimates then an invoice gives EST1000, EST1001, EST1002, INV1003.
--
-- This cannot be applied backwards. The old scheme ran two independent
-- sequences, so INV0767 and EST0767 are both real, unrelated documents. The
-- shared sequence therefore starts above everything ever issued, and legacy
-- documents keep the numbers already printed on their PDFs and sitting in
-- customers' inboxes. Old estimate/invoice pairs stay linked by the cross-link
-- button, which does not care whether the numbers match.
--
-- next_num and next_estimate_num are left in place on purpose. Nothing mints
-- from them any more, but they are the only record of where the old sequences
-- stopped.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

-- ── Seed the shared counter ──────────────────────────────────────────────────
-- Computed from the data rather than hardcoded, so a document neither counter
-- knew about still cannot cause a number to be reissued. 1000 is a floor, not
-- the answer: it only applies if it is above everything in use, and it makes
-- the start of the new scheme obvious at a glance.
insert into public.settings (key, value)
select 'next_doc_num',
       greatest(
         1000,
         coalesce(max((regexp_replace(id, '\D', '', 'g'))::int), 0) + 1
       )::text
  from public.invoices
 where id ~ '^(EST|INV)[0-9]+$'
on conflict (key) do update
  set value = greatest(excluded.value::int, (settings.value)::int)::text;

-- ── Advance-only counter bump ────────────────────────────────────────────────
-- Called after a new document is saved. Deliberately a separate function
-- rather than an edit to save_invoice_with_items: that function is long, has
-- been redefined by seven migrations, and may carry changes made directly in
-- the SQL editor. Rewriting it wholesale to add four lines risks silently
-- reverting one of them.
--
-- greatest() is the whole point -- the counter only ever moves forward, so a
-- stale client or a concurrent write can never walk it back onto a number that
-- is already on a customer's invoice.
create or replace function public.bump_doc_num(p_num integer)
returns void
language sql
as $$
  insert into public.settings (key, value)
  values ('next_doc_num', greatest(p_num, 1000)::text)
  on conflict (key) do update
    set value = greatest(excluded.value::int, (settings.value)::int)::text;
$$;

grant execute on function public.bump_doc_num(integer) to anon, authenticated;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- next_doc_num should sit one above your highest existing document number
-- (across both prefixes), or 1000, whichever is larger.
select
  (select value from public.settings where key = 'next_doc_num') as next_doc_num,
  max((regexp_replace(id, '\D', '', 'g'))::int)                  as highest_in_use
from public.invoices
where id ~ '^(EST|INV)[0-9]+$';

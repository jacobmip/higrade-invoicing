-- 081_invoice_items_assigned_only_writes.sql
--
-- A non-admin may change a job's line items and prices only when he is the
-- assigned tech (solo) and the job is not deleted. Someone who is merely the
-- commission_tech_id on a job Jake is assigned to gets no write path.
--
-- Before: invoice_items_modify let anyone whose owner_id is on the ITEM row
-- write it. owner_id on a child row is stamped by trigger to whoever inserted
-- it, so an apprentice who once added a line to Jake's job kept write access
-- to that line (the problem 069 describes). That path is removed.
--
-- invoice_items_select is narrowed to match. Read without write is a bug here:
-- save_invoice_with_items deletes and re-inserts the whole item set, and a
-- caller who can read rows but not delete them gets silent duplicates.
-- Reading and writing now come from the same two doors: admin, or assigned.
-- Live check on 2026-10-27: 0 item rows have a non-admin owner_id that differs
-- from the invoice's assigned tech, so no current job changes visibility.
--
-- invoice_items_assigned (069, is_my_assigned_job: assigned_tech_id = auth.uid()
-- and deleted_at is null) already expresses the assigned rule and is kept.

begin;

drop policy if exists invoice_items_modify on public.invoice_items;
drop policy if exists invoice_items_select on public.invoice_items;

drop policy if exists invoice_items_admin on public.invoice_items;
create policy invoice_items_admin on public.invoice_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;

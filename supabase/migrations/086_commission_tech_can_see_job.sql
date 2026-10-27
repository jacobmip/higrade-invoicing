-- 086: the commission tech can SEE the job he is named on.
--
-- 075 added invoices.commission_tech_id, but invoices_select (053) only admits
-- owner, assigned tech and admin, so an apprentice named as the commission tech
-- saw nothing in his list. SELECT only, on purpose:
--   * no UPDATE/DELETE policy is added, so he cannot edit or reprice;
--   * invoice_items stays assigned-tech/admin only (081), so he sees the job
--     header and totals row, not the line items or payments;
--   * guard_invoice_commission (075) already pins commission fields for non-admins.
begin;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select
  using (
    owner_id = auth.uid()
    or assigned_tech_id = auth.uid()
    or (commission_tech_id = auth.uid() and deleted_at is null)
    or is_admin()
  );

commit;

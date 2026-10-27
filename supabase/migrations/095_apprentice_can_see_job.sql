-- 095: the job's apprentice (invoices.apprentice_id, 094) can SEE the job.
--
-- 094 made apprentice_id display only, so a job Jake assigned to himself with
-- Kaulana as apprentice never reached Kaulana's calendar or job list. SELECT
-- only, same shape as 086:
--   * no UPDATE/DELETE policy, so he cannot edit, reprice or trash it;
--   * is_my_assigned_job()/is_my_assigned_client() are untouched, so line items,
--     payments and the client record stay assigned/commission-tech only;
--   * deleted jobs are hidden from him.
-- Rebuilt from the live definition (checked 2026-10-27), which matched 086.
begin;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select
  using (
    owner_id = auth.uid()
    or assigned_tech_id = auth.uid()
    or (commission_tech_id = auth.uid() and deleted_at is null)
    or (apprentice_id = auth.uid() and deleted_at is null)
    or is_admin()
  );

commit;

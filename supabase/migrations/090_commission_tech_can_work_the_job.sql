-- 090_commission_tech_can_work_the_job.sql
--
-- A tech named as an invoice's commission tech (075) can now edit that job the
-- same way the assigned tech can (069): line items, pricing, history, photos.
-- Until now 086 gave him SELECT on the header only, so the form was view-only.
--
-- Approach: widen the two linkage helpers instead of adding a policy per table.
-- Every child-table policy from 069/081 is keyed on them, so items, payments,
-- versions and events follow at once. The names still say "assigned" because
-- renaming would mean dropping and recreating a dozen policies.
--
-- What he still cannot do, enforced here:
--   * delete the invoice (no DELETE policy; invoices_modify needs owner_id)
--   * trash or restore it (USING and WITH CHECK both require deleted_at is null)
--   * reassign it: guard_invoice_assignment pins assigned_tech_id for anyone who
--     reaches the row only through commission_tech_id
--   * change commission_tech_id / material fields (guard_invoice_commission, 075/087)
-- Not enforced in the database: apprentices recording payments and signatures.
-- payments stays writable because save_invoice_with_items deletes and
-- re-inserts the whole set on every save; the app hides those buttons.
begin;

create or replace function public.is_my_assigned_job(p_invoice_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.invoices i
     where i.id = p_invoice_id
       and (i.assigned_tech_id = auth.uid() or i.commission_tech_id = auth.uid())
       and i.deleted_at is null
  );
$$;

create or replace function public.is_my_assigned_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.invoices i
     where i.client_id = p_client_id
       and (i.assigned_tech_id = auth.uid() or i.commission_tech_id = auth.uid())
       and i.deleted_at is null
  );
$$;

drop policy if exists invoices_update_commission on public.invoices;
create policy invoices_update_commission on public.invoices
  for update
  using      (commission_tech_id = auth.uid() and deleted_at is null)
  with check (commission_tech_id = auth.uid() and deleted_at is null);

-- WITH CHECK cannot see the old row, so the assignment is pinned by trigger.
create or replace function public.guard_invoice_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE'
     and old.commission_tech_id = auth.uid()
     and old.assigned_tech_id is distinct from auth.uid()
     and old.owner_id is distinct from auth.uid() then
    new.assigned_tech_id := old.assigned_tech_id;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_invoice_assignment on public.invoices;
create trigger guard_invoice_assignment
  before update on public.invoices
  for each row execute function public.guard_invoice_assignment();

commit;

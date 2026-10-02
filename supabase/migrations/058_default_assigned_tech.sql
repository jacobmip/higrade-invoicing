-- 058_default_assigned_tech.sql
--
-- A new document defaults its assigned tech to whoever owns it.
--
-- save_invoice_with_items already coalesces assigned_tech_id to auth.uid() on
-- insert (migration 053), so documents made in the app were covered. Every
-- other writer left it null and the job showed as Unassigned:
--   - the AI receptionist (create_estimate_from_lead, capture_abandoned_call),
--     which knows nothing about the column
--   - the PayPal down-payment invoice, inserted under the service role
--   - converting an unassigned estimate, which sends 'none'
--
-- Insert only. An existing job that someone set to Unassigned stays that way.
-- Named zz_ so it fires after every other BEFORE INSERT trigger on invoices
-- (Postgres fires them alphabetically), including set_owner_id, so owner_id is
-- final by the time this reads it.

create or replace function public.default_assigned_tech()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_tech_id is null then
    new.assigned_tech_id := coalesce(new.owner_id, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists zz_invoices_default_assigned_tech on public.invoices;

create trigger zz_invoices_default_assigned_tech
  before insert on public.invoices
  for each row execute function public.default_assigned_tech();

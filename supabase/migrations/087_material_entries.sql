-- 087: material cost as a list of entries (description + amount).
-- invoices.material_cost stays the number commission reads; the app writes it as
-- the sum of material_entries. Entries live in jsonb: [{ id, desc, amount }].
-- guard_invoice_commission (075) rebuilt from its live definition to pin the new
-- column against any non-admin the same way it pins material_cost.
begin;

alter table public.invoices
  add column if not exists material_entries jsonb not null default '[]'::jsonb;

create or replace function public.guard_invoice_commission()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' then
    new.commission_tech_id := old.commission_tech_id;
    new.material_cost      := old.material_cost;
    new.material_entries   := old.material_entries;
  else
    new.commission_tech_id := null;
    new.material_cost      := 0;
    new.material_entries   := '[]'::jsonb;
  end if;
  return new;
end;
$function$;

commit;

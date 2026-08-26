-- 039_enforce_invoice_id_type.sql
--
-- Makes it structurally impossible for a document's id to disagree with its
-- type. An EST#### row is an estimate. An INV#### row is an invoice. Nothing
-- is allowed to change that.
--
-- Why this belongs in the database and not just the app:
--   save_invoice_with_items upserts on id with `type = excluded.type`, so a
--   single bad write silently rewrites what an existing document *is*. That
--   is how EST0767 became an invoice while keeping an estimate's number and
--   was then emailed to a customer that way. The app-side guards added in
--   v1.3.2 cover the auto-save path, but the PayPal endpoints, the AI
--   receptionist RPCs, the SQL editor and any future code all write to this
--   table directly and bypass them. A trigger is the only place that catches
--   every writer.
--
-- Why a trigger rather than a CHECK constraint:
--   A CHECK (even NOT VALID) is enforced on every UPDATE, including updates
--   to rows that were already inconsistent. EST0767 is staying as it is at
--   Jake's request, and a CHECK would make that row uneditable forever. This
--   trigger blocks a write only when it would *introduce* a new mismatch.
--   Rows that are already mismatched stay editable, and setting one back to
--   its correct type is always allowed because that write is consistent.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

create or replace function public.enforce_invoice_id_type()
returns trigger
language plpgsql
as $$
declare
  id_wants_estimate boolean;
  new_is_estimate   boolean;
  old_was_consistent boolean;
begin
  -- Ids that predate the EST/INV scheme are none of this trigger's business.
  if new.id !~ '^(EST|INV)' then
    return new;
  end if;

  id_wants_estimate := new.id like 'EST%';
  new_is_estimate   := coalesce(new.type, '') = 'estimate';

  -- Consistent write. This is the only path that can *fix* a bad row.
  if new_is_estimate = id_wants_estimate then
    return new;
  end if;

  -- Inconsistent write. Allowed only when the row was already inconsistent,
  -- so historical damage stays editable instead of becoming frozen.
  if tg_op = 'UPDATE' then
    old_was_consistent := (coalesce(old.type, '') = 'estimate') = (old.id like 'EST%');
    if not old_was_consistent then
      return new;
    end if;
  end if;

  raise exception
    'ID_TYPE_MISMATCH: % cannot be saved as type "%". An EST id is an estimate and an INV id is an invoice; to change one into the other, create a new document.',
    new.id, new.type;
end;
$$;

drop trigger if exists invoices_enforce_id_type on public.invoices;
create trigger invoices_enforce_id_type
  before insert or update on public.invoices
  for each row
  execute function public.enforce_invoice_id_type();

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Lists every row that is currently inconsistent. These are grandfathered in:
-- the trigger will not block edits to them, but no new ones can be created.
-- Expect exactly one row, EST0767, unless something else was hit too.
select id, type, status, client_name, date
  from public.invoices
 where id ~ '^(EST|INV)'
   and (coalesce(type, '') = 'estimate') <> (id like 'EST%')
 order by id;

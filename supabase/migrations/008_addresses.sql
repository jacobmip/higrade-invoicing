-- 008_addresses.sql
-- Add structured billing + job-site addresses to clients and invoices.
--
-- For property-manager clients, one client may have many properties.
-- `clients.addresses` is an array of {id, label, line1, line2, line3}.
-- `clients.billing_address` is a single {line1, line2, line3}.
--
-- Each invoice carries its own snapshot of the job site address picked at
-- save time, plus the billing address. Snapshots make the invoice history
-- immutable: editing a client's address later does not rewrite past invoices.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS billing_address jsonb;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS job_address jsonb,
  ADD COLUMN IF NOT EXISTS billing_address jsonb;

-- One-time backfill: for any client whose `addresses` is empty AND has any of
-- the legacy flat fields populated, seed `addresses` with a single "Primary"
-- entry built from address1/2/3. Idempotent — running again does nothing
-- because addresses is no longer empty.
UPDATE clients
SET addresses = jsonb_build_array(jsonb_build_object(
  'id', 'primary',
  'label', 'Primary',
  'line1', COALESCE(address1, ''),
  'line2', COALESCE(address2, ''),
  'line3', COALESCE(address3, '')
))
WHERE (addresses IS NULL OR addresses = '[]'::jsonb)
  AND (
    COALESCE(NULLIF(address1, ''), NULLIF(address2, ''), NULLIF(address3, '')) IS NOT NULL
  );

-- Replace save_invoice_with_items so it persists job_address and
-- billing_address (snapshots taken at save time). Everything else is
-- identical to migration 006.
create or replace function public.save_invoice_with_items(
  inv jsonb,
  items jsonb default '[]'::jsonb,
  payments jsonb default '[]'::jsonb,
  expected_updated_at timestamptz default null,
  is_new boolean default false
) returns jsonb
language plpgsql
as $$
declare
  inv_id text := inv->>'id';
  current_updated timestamptz;
  next_num int;
  result jsonb;
begin
  if inv_id is null or inv_id = '' then
    raise exception 'INVALID_INPUT: invoice id is required';
  end if;

  if expected_updated_at is not null and not is_new then
    select updated_at into current_updated
      from public.invoices where id = inv_id;
    if current_updated is not null and current_updated <> expected_updated_at then
      raise exception 'CONCURRENT_EDIT: invoice was modified on another device (db=% expected=%)',
        current_updated, expected_updated_at;
    end if;
  end if;

  insert into public.invoices (
    id, type, client_id, client_name, date, due_date, status,
    tax, discount, discount_type, notes, year,
    gcal_date, gcal_event_id, follow_up_date, follow_up_event_id,
    signature_data, signed_at, client_info, converted_to_id, view_token,
    job_address, billing_address,
    updated_at
  ) values (
    inv_id,
    coalesce(inv->>'type', 'invoice'),
    nullif(inv->>'client_id', '')::uuid,
    coalesce(inv->>'client_name', ''),
    nullif(inv->>'date', '')::date,
    nullif(inv->>'due_date', '')::date,
    coalesce(inv->>'status', 'outstanding'),
    coalesce((inv->>'tax')::numeric, 4.712),
    coalesce((inv->>'discount')::numeric, 0),
    coalesce(inv->>'discount_type', '$'),
    coalesce(inv->>'notes', ''),
    nullif(inv->>'year', '')::int,
    nullif(inv->>'gcal_date', '')::timestamptz,
    nullif(inv->>'gcal_event_id', ''),
    nullif(inv->>'follow_up_date', '')::timestamptz,
    nullif(inv->>'follow_up_event_id', ''),
    nullif(inv->>'signature_data', ''),
    nullif(inv->>'signed_at', '')::timestamptz,
    case when inv ? 'client_info' and inv->'client_info' <> 'null'::jsonb
         then inv->'client_info' else null end,
    nullif(inv->>'converted_to_id', ''),
    nullif(inv->>'view_token', ''),
    case when inv ? 'job_address' and inv->'job_address' <> 'null'::jsonb
         then inv->'job_address' else null end,
    case when inv ? 'billing_address' and inv->'billing_address' <> 'null'::jsonb
         then inv->'billing_address' else null end,
    now()
  )
  on conflict (id) do update set
    type = excluded.type,
    client_id = excluded.client_id,
    client_name = excluded.client_name,
    date = excluded.date,
    due_date = excluded.due_date,
    status = excluded.status,
    tax = excluded.tax,
    discount = excluded.discount,
    discount_type = excluded.discount_type,
    notes = excluded.notes,
    year = excluded.year,
    gcal_date = excluded.gcal_date,
    gcal_event_id = excluded.gcal_event_id,
    follow_up_date = excluded.follow_up_date,
    follow_up_event_id = excluded.follow_up_event_id,
    signature_data = excluded.signature_data,
    signed_at = excluded.signed_at,
    client_info = excluded.client_info,
    converted_to_id = excluded.converted_to_id,
    view_token = coalesce(excluded.view_token, public.invoices.view_token),
    job_address = excluded.job_address,
    billing_address = excluded.billing_address,
    updated_at = now();

  delete from public.invoice_items where invoice_id = inv_id;

  if jsonb_array_length(items) > 0 then
    insert into public.invoice_items (
      invoice_id, name, description, qty, price, unit,
      discount, discount_type, taxable, sort_order
    )
    select
      inv_id,
      coalesce(it->>'name', ''),
      coalesce(it->>'description', ''),
      coalesce((it->>'qty')::numeric, 1),
      coalesce((it->>'price')::numeric, 0),
      coalesce(it->>'unit', 'ea'),
      coalesce((it->>'discount')::numeric, 0),
      coalesce(it->>'discount_type', '%'),
      coalesce((it->>'taxable')::boolean, true),
      coalesce((it->>'sort_order')::int, idx::int - 1)
    from jsonb_array_elements(items) with ordinality as t(it, idx);
  end if;

  delete from public.payments where invoice_id = inv_id;

  if jsonb_array_length(payments) > 0 then
    insert into public.payments (invoice_id, amount, method, date, note)
    select
      inv_id,
      coalesce((p->>'amount')::numeric, 0),
      coalesce(p->>'method', ''),
      nullif(p->>'date', '')::date,
      coalesce(p->>'note', '')
    from jsonb_array_elements(payments) as t(p);
  end if;

  if is_new then
    next_num := (regexp_replace(inv_id, '[^0-9]', '', 'g'))::int + 1;
    insert into public.settings (key, value)
      values ('next_num', next_num::text)
      on conflict (key) do update set value = excluded.value;
  end if;

  select jsonb_build_object(
    'id', id,
    'updated_at', updated_at
  ) into result
  from public.invoices where id = inv_id;

  return result;
end;
$$;

grant execute on function public.save_invoice_with_items(jsonb, jsonb, jsonb, timestamptz, boolean) to anon, authenticated;

-- ─── Atomic invoice save RPC + optimistic locking ───────────────────────────
--
-- The frontend was doing this dance for every invoice save:
--   UPDATE invoices ...
--   DELETE FROM invoice_items WHERE invoice_id = ...
--   INSERT INTO invoice_items ...   <-- if the network drops here, the
--                                       invoice has zero line items.
--
-- This RPC bundles all of that into a single Postgres transaction so it's
-- all-or-nothing. If any step fails, the whole save is rolled back and the
-- previous state is preserved.
--
-- Also takes an optional `expected_updated_at` parameter for optimistic
-- locking. If the row's current updated_at doesn't match, the function raises
-- 'CONCURRENT_EDIT' so the client can warn the user before overwriting changes
-- made on another device.
--
-- The function is SECURITY INVOKER (default) so RLS still applies.

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

  -- Optimistic locking: refuse the write if the row was modified since the
  -- client last loaded it. Skip the check for new invoices and for callers
  -- that explicitly opt out by passing null.
  if expected_updated_at is not null and not is_new then
    select updated_at into current_updated
      from public.invoices where id = inv_id;
    -- If the row is missing it's effectively a new insert — let it through.
    if current_updated is not null and current_updated <> expected_updated_at then
      raise exception 'CONCURRENT_EDIT: invoice was modified on another device (db=% expected=%)',
        current_updated, expected_updated_at;
    end if;
  end if;

  -- Upsert the invoice row.
  insert into public.invoices (
    id, type, client_id, client_name, date, due_date, status,
    tax, discount, discount_type, notes, year,
    gcal_date, gcal_event_id, follow_up_date, follow_up_event_id,
    signature_data, signed_at, client_info, converted_to_id, view_token,
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
    updated_at = now();

  -- Replace line items in the same transaction.
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

  -- Replace payments.
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

  -- Bump next_num if this was a new invoice.
  if is_new then
    next_num := (regexp_replace(inv_id, '[^0-9]', '', 'g'))::int + 1;
    insert into public.settings (key, value)
      values ('next_num', next_num::text)
      on conflict (key) do update set value = excluded.value;
  end if;

  -- Return the new updated_at so the client can store it for the next save.
  select jsonb_build_object(
    'id', id,
    'updated_at', updated_at
  ) into result
  from public.invoices where id = inv_id;

  return result;
end;
$$;

-- Grant execute to anon/authenticated roles so the browser client can call it.
grant execute on function public.save_invoice_with_items(jsonb, jsonb, jsonb, timestamptz, boolean) to anon, authenticated;

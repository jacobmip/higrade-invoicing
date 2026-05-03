-- ─── Preserve PayPal-recorded payments through save_invoice_with_items ──────
--
-- BUG:
--   save_invoice_with_items (migration 006) does a full delete-and-replace of
--   every row in `payments` for the invoice on every save. The PayPal capture
--   handler inserts a payment row with paypal_capture_id set, but the next
--   time the in-app invoice editor auto-saves the same invoice, the RPC wipes
--   that row — silently undoing the PayPal receipt.
--
-- SYMPTOM:
--   Customer pays via the public viewer → PayPal captures → row inserted →
--   public viewer flips to "PAID IN FULL". Owner reopens the invoice in the
--   app (still showing outstanding because state was loaded before the
--   payment), auto-save fires, payment row vanishes from DB. App shows the
--   invoice as still outstanding.
--
-- FIX:
--   Only delete the manual / non-PayPal payment rows in the RPC. PayPal rows
--   are uniquely identified by paypal_capture_id IS NOT NULL — they can only
--   be inserted by the PayPal capture handler / webhook, never by the app's
--   manual payment editor. Then re-insert the manual payments from the client
--   payload as before. PayPal rows are left untouched.
--
--   Also widen the manual-payment insert to forward paypal_order_id /
--   paypal_capture_id if the client ever does include them (defensive — the
--   app currently doesn't, but this future-proofs the column round-trip).

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

  -- Optimistic locking (unchanged from 006).
  if expected_updated_at is not null and not is_new then
    select updated_at into current_updated
      from public.invoices where id = inv_id;
    if current_updated is not null and current_updated <> expected_updated_at then
      raise exception 'CONCURRENT_EDIT: invoice was modified on another device (db=% expected=%)',
        current_updated, expected_updated_at;
    end if;
  end if;

  -- Upsert the invoice row (unchanged).
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

  -- Replace line items (unchanged).
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

  -- ─── KEY CHANGE ──────────────────────────────────────────────────────────
  -- Only delete manual (non-PayPal) payments. PayPal rows are protected by
  -- paypal_capture_id being non-null and are managed exclusively by
  -- /api/paypal-capture-order and /api/paypal-webhook.
  delete from public.payments
   where invoice_id = inv_id
     and paypal_capture_id is null;

  if jsonb_array_length(payments) > 0 then
    -- Only re-insert payments that are NOT PayPal-tagged. If a PayPal row
    -- somehow round-tripped through the client (it shouldn't — the app's
    -- manual payment editor doesn't expose paypal_capture_id), skip it; the
    -- existing DB row is the source of truth.
    insert into public.payments (
      invoice_id, amount, method, date, note,
      paypal_order_id, paypal_capture_id
    )
    select
      inv_id,
      coalesce((p->>'amount')::numeric, 0),
      coalesce(p->>'method', ''),
      nullif(p->>'date', '')::date,
      coalesce(p->>'note', ''),
      nullif(p->>'paypal_order_id', ''),
      nullif(p->>'paypal_capture_id', '')
    from jsonb_array_elements(payments) as t(p)
    where (p->>'paypal_capture_id') is null
       or (p->>'paypal_capture_id') = '';
  end if;

  -- Bump next_num if this was a new invoice (unchanged).
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

-- 020_fix_estimate_counter.sql
--
-- Fixes two interrelated bugs that cause new estimates to disappear on refresh:
--
-- Bug 1 (root): save_invoice_with_items ON CONFLICT DO UPDATE does not update
--   owner_id.  When the estimate counter resets to an orphaned EST#### number,
--   the INSERT hits a conflict and takes the UPDATE path, which leaves the row
--   with the wrong owner_id.  RLS then hides it from the real owner, so the
--   counter stays stuck at that number forever.
--
-- Bug 2 (amplifier): save_invoice_with_items never writes next_estimate_num to
--   the settings table on new estimate saves.  So the JS counter recomputes
--   from visible rows only on every page load — once an EST#### row is
--   invisible, the counter resets to that number and the cycle repeats.
--
-- Also: migration 016 accidentally dropped job_address, billing_address, and
-- late_fee_waived from the RPC (it copied from migration 014, which predates
-- those columns). This migration restores them.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

-- ── Ensure columns exist (idempotent) ────────────────────────────────────────
alter table public.invoices
  add column if not exists late_fee_waived  boolean not null default false,
  add column if not exists deleted_at       timestamptz;

-- ── One-time data fix ─────────────────────────────────────────────────────────
-- Claim estimate/invoice rows with no owner (the SQL editor runs as the
-- postgres role, which bypasses RLS, so this always lands).
-- All rows without an owner_id were created before migration 017 or during the
-- EST0742 orphan bug and belong to Jake.
update public.invoices
  set owner_id = '0a3bcefd-6faf-4bae-b43b-cd4492dd9938'
  where owner_id is null;

-- Persist the estimate counter immediately so the JS counter won't reset below
-- any previously-orphaned EST number on the next page load.
insert into public.settings (key, value)
  select 'next_estimate_num',
         (coalesce(max(regexp_replace(id, '[^0-9]', '', 'g')::int), 0) + 1)::text
    from public.invoices
   where type = 'estimate'
     and id ~ '^EST[0-9]+$'
on conflict (key) do update
  set value = greatest(excluded.value::int, (settings.value)::int)::text;

-- ── Fix save_invoice_with_items ───────────────────────────────────────────────
create or replace function public.save_invoice_with_items(
  inv      jsonb,
  items    jsonb    default '[]'::jsonb,
  payments jsonb    default '[]'::jsonb,
  expected_updated_at timestamptz default null,
  is_new   boolean  default false
) returns jsonb
language plpgsql
as $$
declare
  inv_id           text := inv->>'id';
  current_updated  timestamptz;
  next_num         int;
  result           jsonb;
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
    down_payment_pct, down_payment_invoice_id,
    late_fee_waived,
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
    coalesce((inv->>'down_payment_pct')::smallint, 0),
    nullif(inv->>'down_payment_invoice_id', ''),
    coalesce((inv->>'late_fee_waived')::boolean, false),
    now()
  )
  on conflict (id) do update set
    type               = excluded.type,
    client_id          = excluded.client_id,
    client_name        = excluded.client_name,
    date               = excluded.date,
    due_date           = excluded.due_date,
    status             = excluded.status,
    tax                = excluded.tax,
    discount           = excluded.discount,
    discount_type      = excluded.discount_type,
    notes              = excluded.notes,
    year               = excluded.year,
    gcal_date          = excluded.gcal_date,
    gcal_event_id      = excluded.gcal_event_id,
    follow_up_date     = excluded.follow_up_date,
    follow_up_event_id = excluded.follow_up_event_id,
    signature_data     = excluded.signature_data,
    signed_at          = excluded.signed_at,
    client_info        = excluded.client_info,
    converted_to_id    = excluded.converted_to_id,
    view_token         = coalesce(excluded.view_token, public.invoices.view_token),
    job_address        = excluded.job_address,
    billing_address    = excluded.billing_address,
    down_payment_pct   = excluded.down_payment_pct,
    -- Never clobber a real link with null — submit-signature sets it server-side
    down_payment_invoice_id = coalesce(excluded.down_payment_invoice_id, public.invoices.down_payment_invoice_id),
    late_fee_waived    = excluded.late_fee_waived,
    -- Reclaim ownership on conflict: if a row exists with wrong/null owner_id
    -- (e.g. from an earlier orphan bug), the current authenticated caller takes
    -- it over. excluded.owner_id is set to auth.uid() by the set_owner_id
    -- BEFORE INSERT trigger even on the conflict path.
    owner_id           = excluded.owner_id,
    updated_at         = now();

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

  -- Only delete manual (non-PayPal) payments. PayPal rows are managed
  -- exclusively by /api/paypal-capture-order and /api/paypal-webhook.
  delete from public.payments
   where invoice_id = inv_id
     and paypal_capture_id is null;

  if jsonb_array_length(payments) > 0 then
    insert into public.payments (
      invoice_id, amount, method, date, note,
      paypal_order_id, paypal_capture_id, surcharge
    )
    select
      inv_id,
      coalesce((p->>'amount')::numeric, 0),
      coalesce(p->>'method', ''),
      nullif(p->>'date', '')::date,
      coalesce(p->>'note', ''),
      nullif(p->>'paypal_order_id', ''),
      nullif(p->>'paypal_capture_id', ''),
      coalesce((p->>'surcharge')::numeric, 0)
    from jsonb_array_elements(payments) as t(p)
    where (p->>'paypal_capture_id') is null
       or (p->>'paypal_capture_id') = '';
  end if;

  if is_new then
    next_num := (regexp_replace(inv_id, '[^0-9]', '', 'g'))::int + 1;
    if inv_id like 'EST%' then
      -- Persist estimate counter so the JS never resets below an invisible row.
      insert into public.settings (key, value)
        values ('next_estimate_num', next_num::text)
        on conflict (key) do update set value = greatest(
          excluded.value::int,
          (settings.value)::int
        )::text;
    else
      insert into public.settings (key, value)
        values ('next_num', next_num::text)
        on conflict (key) do update set value = greatest(
          excluded.value::int,
          (settings.value)::int
        )::text;
    end if;
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

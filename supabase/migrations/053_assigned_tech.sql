-- 053_assigned_tech.sql
-- Per-tech KPI dashboard: attribute a job to the tech who RAN it.
--
-- Why this column exists at all:
--   owner_id answers "who created this record", not "who did the work".
--   Worse, save_invoice_with_items sets `owner_id = excluded.owner_id` on
--   conflict, so owner_id is restamped to whoever last saved the row — an
--   admin editing a plumber's invoice silently takes ownership of it.
--   That makes owner_id unusable as the basis for incentive pay. This column
--   is set deliberately and is never restamped by a save.

-- ── 1. The column ───────────────────────────────────────────────────────────
alter table public.invoices
  add column if not exists assigned_tech_id uuid references auth.users(id);

comment on column public.invoices.assigned_tech_id is
  'The tech who performed the work. Basis for the per-tech KPI scorecard. '
  'Distinct from owner_id, which is only who created the record.';

-- ── 2. Backfill ─────────────────────────────────────────────────────────────
-- Every existing job was run by whoever owns it (Jake is the only tech to
-- date), so seed from owner_id. Guarded by `is null` so re-running is safe.
update public.invoices
   set assigned_tech_id = owner_id
 where assigned_tech_id is null
   and owner_id is not null;

-- ── 3. Index ────────────────────────────────────────────────────────────────
-- The scorecard groups by tech across a whole year; without this it is a
-- sequential scan of every invoice on every render of the Reports tab.
create index if not exists invoices_assigned_tech_idx
  on public.invoices (assigned_tech_id)
  where deleted_at is null;

-- ── 4. Let a tech see the jobs assigned to them ─────────────────────────────
-- The existing policy is `owner_id = auth.uid() OR is_admin()`. Without this
-- widening, Jake assigns a job to the apprentice and the apprentice cannot
-- see it — nor their own scorecard, which is the whole point of the feature.
-- SELECT only. Write access for an assigned tech is deliberately NOT granted
-- here; that is a separate decision with separate consequences.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select
  using (
    owner_id = auth.uid()
    or assigned_tech_id = auth.uid()
    or is_admin()
  );

-- ── 5. Teach the main upsert about the column ──────────────────────────────
-- Rebuilt from the LIVE definition (per CLAUDE.md: never from an old file).
-- Only the assigned_tech_id lines are new; everything else is verbatim.
--
-- Update semantics are deliberately defensive. This app has several writers
-- outside it (the AI receptionist's SECURITY DEFINER RPCs), and a writer that
-- does not know about this column must not wipe an assignment:
--   key absent or null -> keep whatever is already on the row
--   key = a uuid       -> reassign
--   key = 'none'       -> explicitly clear to unassigned
create or replace function public.save_invoice_with_items(
  inv jsonb,
  items jsonb default '[]'::jsonb,
  payments jsonb default '[]'::jsonb,
  expected_updated_at timestamptz default null,
  is_new boolean default false
)
returns jsonb
language plpgsql
as $function$
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
    assigned_tech_id,
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
    to_char(nullif(inv->>'gcal_date', '')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
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
    -- NEW: default a fresh job to the person creating it. Under the
    -- service-role key auth.uid() is null, which lands as Unassigned rather
    -- than silently crediting the wrong tech.
    case when inv->>'assigned_tech_id' = 'none' then null
         else coalesce(nullif(inv->>'assigned_tech_id', '')::uuid, auth.uid()) end,
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
    down_payment_invoice_id = coalesce(excluded.down_payment_invoice_id, public.invoices.down_payment_invoice_id),
    late_fee_waived    = excluded.late_fee_waived,
    -- NEW: never clobbered by a writer that does not send the key.
    assigned_tech_id   = case
                           when inv->>'assigned_tech_id' = 'none' then null
                           else coalesce(nullif(inv->>'assigned_tech_id', '')::uuid,
                                         public.invoices.assigned_tech_id)
                         end,
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
$function$;

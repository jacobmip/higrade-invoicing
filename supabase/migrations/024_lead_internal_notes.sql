-- 024_lead_internal_notes.sql
-- ─── Clean lead capture + auto-priced line items from the price book ─────────
--
-- Supersedes the 023 version of create_estimate_from_lead. Two upgrades:
--
--   1. Clean data placement (fixes the "everything dumped in customer notes"
--      problem from 023):
--        contact   -> client record (matched/created)
--        address   -> invoices.job_address (jsonb)
--        the rest  -> invoices.internal_notes (private, admin/staff only)
--        customer notes -> left empty
--      Plus invoices.source = 'ai_lead' so the lead text fires ONLY for AI
--      captures, never manual estimates/invoices.
--
--   2. Auto-pricing. Lisa matches the caller's problem to service name(s) from
--      the price book (saved_items) and passes them in p_services. The function
--      looks each up and creates a real, priced line item — as if Jake were
--      about to do the job. Falls back to "Service Call / Diagnostic" if nothing
--      matches.
--
-- save_invoice_with_items is intentionally NOT modified — it already leaves the
-- new columns (internal_notes, source) untouched on save, so they're preserved.

alter table public.invoices
  add column if not exists internal_notes text,
  add column if not exists source         text;

-- Edit the private notes in isolation (does not touch updated_at, so it can't
-- trip the main save's optimistic lock).
create or replace function public.set_invoice_internal_notes(
  p_id text,
  p_internal_notes text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.invoices
     set internal_notes = p_internal_notes
   where id = p_id;
$$;

grant execute on function public.set_invoice_internal_notes(text, text)
  to anon, authenticated;

-- ─── Reworked lead → auto-priced draft estimate ─────────────────────────────
-- Drop the 10-arg version from migration 023 so the new 11-arg version below
-- isn't ambiguous with it when called without p_services.
drop function if exists public.create_estimate_from_lead(
  text, text, text, text, text, text, text, text, text, text
);

create or replace function public.create_estimate_from_lead(
  p_secret          text,
  p_name            text,
  p_phone           text,
  p_address         text default null,
  p_problem         text default null,
  p_urgency         text default null,
  p_callback_window text default null,
  p_owner_or_tenant text default null,
  p_new_or_existing text default null,
  p_heard_from      text default null,
  p_services        text[] default null   -- price-book service names Lisa matched
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Jake's price-book owner scope (see 20260515_price_book_seed.sql).
  c_owner    constant uuid := '0a3bcefd-6faf-4bae-b43b-cd4492dd9938';
  v_secret        text;
  v_phone_digits  text;
  v_client_id     clients.id%type;
  v_is_new_client boolean := false;
  v_num           int;
  v_max           int;
  v_persisted     int;
  v_id            text;
  v_token         text := replace(gen_random_uuid()::text, '-', '');
  v_internal      text;
  v_job_address   jsonb;
  v_client_info   jsonb;
  v_svc           text;
  v_item          record;
  v_sort          int := 0;
  v_matched       int := 0;
begin
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'INVALID_INPUT: caller name is required';
  end if;

  -- Match an existing client on the last 10 digits of the phone.
  v_phone_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_phone_digits) = 10 then
    select id into v_client_id
      from public.clients
     where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_phone_digits
        or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_phone_digits
     order by created_at asc
     limit 1;
  end if;

  if v_client_id is null then
    insert into public.clients (name, mobile, address1)
    values (p_name, p_phone, nullif(trim(coalesce(p_address, '')), ''))
    returning id into v_client_id;
    v_is_new_client := true;
  end if;

  -- Next EST#### number, collision-safe (mirrors the app's own counter).
  select max((regexp_replace(id, '\D', '', 'g'))::int) into v_max
    from public.invoices
   where type = 'estimate' and id ~ '^EST[0-9]+$';
  select nullif(value, '')::int into v_persisted
    from public.settings where key = 'next_estimate_num';
  v_num := greatest(coalesce(v_persisted, 1), coalesce(v_max, 0) + 1, 712);
  loop
    v_id := 'EST' || lpad(v_num::text, 4, '0');
    exit when not exists (select 1 from public.invoices where id = v_id);
    v_num := v_num + 1;
  end loop;

  -- Private, admin/staff-only notes. Includes the caller's verbatim words so
  -- Jake sees exactly what was said, even though the priced line drives the doc.
  v_internal :=
      'AI receptionist (Lisa) lead — ' || to_char(now(), 'Mon DD, HH12:MI AM') || E'\n' ||
      'Caller''s words: '   || coalesce(nullif(trim(p_problem), ''), '(not specified)') || E'\n' ||
      'Urgency: '           || coalesce(nullif(trim(p_urgency), ''), '(not specified)') || E'\n' ||
      'Preferred callback: '|| coalesce(nullif(trim(p_callback_window), ''), '(not specified)') || E'\n' ||
      'Owner/Tenant: '      || coalesce(nullif(trim(p_owner_or_tenant), ''), '(not specified)') || E'\n' ||
      'New/Existing: '      || coalesce(nullif(trim(p_new_or_existing), ''), '(not specified)') || E'\n' ||
      'Heard about us: '    || coalesce(nullif(trim(p_heard_from), ''), '(not specified)');

  v_job_address := case
    when nullif(trim(coalesce(p_address, '')), '') is not null
      then jsonb_build_object('label', 'Service address', 'line1', trim(p_address), 'line2', '', 'line3', '')
    else null
  end;

  v_client_info := jsonb_build_object(
    'name',     p_name,
    'phone',    p_phone,
    'address1', nullif(trim(coalesce(p_address, '')), '')
  );

  insert into public.invoices (
    id, type, client_id, client_name, date, status,
    notes, internal_notes, source, job_address, year,
    client_info, view_token, updated_at
  ) values (
    v_id, 'estimate', v_client_id, p_name, current_date, 'outstanding',
    '', v_internal, 'ai_lead', v_job_address,
    extract(year from current_date)::int, v_client_info, v_token, now()
  );

  -- Auto-price: one line item per matched price-book service.
  if p_services is not null then
    foreach v_svc in array p_services loop
      if coalesce(trim(v_svc), '') = '' then continue; end if;
      select name, description, price, unit, taxable into v_item
        from public.saved_items
       where owner_id = c_owner
         and (lower(name) = lower(trim(v_svc)) or name ilike '%' || trim(v_svc) || '%')
       order by (lower(name) = lower(trim(v_svc))) desc  -- exact match first
       limit 1;
      if found then
        insert into public.invoice_items (invoice_id, name, description, qty, price, unit, taxable, sort_order)
        values (v_id, v_item.name, v_item.description, 1, v_item.price,
                coalesce(v_item.unit, 'each'), coalesce(v_item.taxable, false), v_sort);
        v_sort := v_sort + 1;
        v_matched := v_matched + 1;
      end if;
    end loop;
  end if;

  -- Nothing matched → fall back to a diagnostic service call from the book.
  if v_matched = 0 then
    select name, description, price, unit, taxable into v_item
      from public.saved_items
     where owner_id = c_owner and lower(name) = 'service call / diagnostic'
     limit 1;
    if found then
      insert into public.invoice_items (invoice_id, name, description, qty, price, unit, taxable, sort_order)
      values (v_id, v_item.name, v_item.description, 1, v_item.price,
              coalesce(v_item.unit, 'each'), coalesce(v_item.taxable, false), 0);
    else
      insert into public.invoice_items (invoice_id, name, description, qty, price, unit, taxable, sort_order)
      values (v_id, 'Service Call / Diagnostic',
              coalesce(nullif(trim(p_problem), ''), 'See internal notes'), 1, 225, 'each', false, 0);
    end if;
  end if;

  insert into public.settings (key, value)
  values ('next_estimate_num', (v_num + 1)::text)
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object(
    'estimate_id',    v_id,
    'client_id',      v_client_id,
    'is_new_client',  v_is_new_client,
    'items_priced',   greatest(v_matched, 1),
    'view_token',     v_token
  );
end;
$$;

grant execute on function public.create_estimate_from_lead(
  text, text, text, text, text, text, text, text, text, text, text[]
) to anon, authenticated;

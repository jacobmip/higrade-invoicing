-- 030_lead_caller_id.sql
-- ─── Use the caller's own number instead of making Lisa ask for it ──────────
--
-- Lisa was collecting the phone number by voice, which is the least reliable
-- field in the whole call: people rattle it off, digits get misheard, and it
-- burns conversation time on something Twilio already knows for certain.
--
-- Vapi now passes the caller ID as p_caller_id (its {{customer.number}}).
-- Resolution order:
--   1. a number the caller actually spoke (p_phone) - they may be calling from
--      a job site and want the callback on a different line, so what they SAY
--      always wins over caller ID
--   2. the caller ID
--   3. nothing, and the lead alert says so plainly
--
-- Blocked / withheld caller IDs are rejected rather than stored. Twilio sends
-- literal 'anonymous', 'unavailable', 'restricted', or +266696687 (ANONYMOUS
-- on a keypad) for those, and storing any of them as a phone number would put
-- garbage straight into the client record.
--
-- Numbers are stored formatted as (808) 555-1234. Client MATCHING was already
-- normalization-based (last 10 digits), so this changes display only and
-- cannot create duplicate clients. Existing data is a mix of six formats;
-- this at least stops adding new variants.
--
-- New 13-arg signature; the 12-arg version from 025 is dropped to avoid
-- overload ambiguity.

drop function if exists public.create_estimate_from_lead(
  text, text, text, text, text, text, text, text, text, text, text[], text
);

create or replace function public.create_estimate_from_lead(
  p_secret          text,
  p_name            text,
  p_phone           text default null,
  p_address         text default null,
  p_problem         text default null,
  p_urgency         text default null,
  p_callback_window text default null,
  p_owner_or_tenant text default null,
  p_new_or_existing text default null,
  p_heard_from      text default null,
  p_services        text[] default null,
  p_appointment     text default null,  -- ISO local 'YYYY-MM-DDTHH:MM' Hawaii time
  p_caller_id       text default null   -- Vapi {{customer.number}}, E.164
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_owner    constant uuid := '0a3bcefd-6faf-4bae-b43b-cd4492dd9938';
  v_secret        text;
  v_spoken        text;
  v_callerid      text;
  v_phone_raw     text;
  v_phone_src     text;
  v_phone_out     text;
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

  -- Resolve the phone number. Spoken wins over caller ID.
  v_spoken := nullif(btrim(coalesce(p_phone, '')), '');

  v_callerid := nullif(btrim(coalesce(p_caller_id, '')), '');
  if v_callerid is not null
     and (lower(v_callerid) in ('anonymous', 'unavailable', 'restricted', 'private')
          or regexp_replace(v_callerid, '\D', '', 'g') = '266696687'
          or length(regexp_replace(v_callerid, '\D', '', 'g')) < 10)
  then
    v_callerid := null;  -- withheld or unusable
  end if;

  v_phone_raw := coalesce(v_spoken, v_callerid);
  v_phone_src := case
                   when v_spoken   is not null then 'given by caller'
                   when v_callerid is not null then 'caller ID'
                   else 'not captured'
                 end;

  v_phone_digits := right(regexp_replace(coalesce(v_phone_raw, ''), '\D', '', 'g'), 10);

  -- Store in a consistent (808) 555-1234 shape when we have 10 clean digits.
  v_phone_out := case
                   when length(v_phone_digits) = 10
                     then '(' || substr(v_phone_digits, 1, 3) || ') '
                          || substr(v_phone_digits, 4, 3) || '-'
                          || substr(v_phone_digits, 7, 4)
                   else v_phone_raw
                 end;

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
    values (p_name, v_phone_out, nullif(trim(coalesce(p_address, '')), ''))
    returning id into v_client_id;
    v_is_new_client := true;
  end if;

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

  v_internal :=
      'AI receptionist (Lisa) lead - ' || to_char(now(), 'Mon DD, HH12:MI AM') || E'\n' ||
      'Phone source: '      || v_phone_src || E'\n' ||
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
    'phone',    v_phone_out,
    'address1', nullif(trim(coalesce(p_address, '')), '')
  );

  insert into public.invoices (
    id, type, client_id, client_name, date, status,
    notes, internal_notes, source, job_address, gcal_date, year,
    client_info, view_token, updated_at
  ) values (
    v_id, 'estimate', v_client_id, p_name, current_date, 'outstanding',
    '', v_internal, 'ai_lead', v_job_address,
    nullif(trim(coalesce(p_appointment, '')), '')::timestamptz,
    extract(year from current_date)::int, v_client_info, v_token, now()
  );

  if p_services is not null then
    foreach v_svc in array p_services loop
      if coalesce(trim(v_svc), '') = '' then continue; end if;
      select name, description, price, unit, taxable into v_item
        from public.saved_items
       where owner_id = c_owner
         and (lower(name) = lower(trim(v_svc)) or name ilike '%' || trim(v_svc) || '%')
       order by (lower(name) = lower(trim(v_svc))) desc
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
    'appointment',    nullif(trim(coalesce(p_appointment, '')), ''),
    'phone',          v_phone_out,
    'phone_source',   v_phone_src,
    'view_token',     v_token
  );
end;
$$;

grant execute on function public.create_estimate_from_lead(
  text, text, text, text, text, text, text, text, text, text, text[], text, text
) to anon, authenticated;

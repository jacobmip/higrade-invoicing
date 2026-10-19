-- 063_lead_owner_and_local_appointment.sql
-- ─── Two bugs found by actually inserting a row ─────────────────────────────
--
-- 1. LEADS WERE LANDING INVISIBLE.
--
-- invoices has RLS, and the select policy is
--     owner_id = auth.uid() OR assigned_tech_id = auth.uid() OR is_admin()
--
-- create_estimate_from_lead never set owner_id. It relied on trg_set_owner_id,
-- which does `owner_id := auth.uid()`. For anon and service_role auth.uid() is
-- NULL, so the row got a null owner; zz_invoices_default_assigned_tech then
-- set assigned_tech_id to coalesce(owner_id, auth.uid()), also null. The
-- result is an estimate that exists, emails Jake, and that he cannot see in
-- his own app.
--
-- Proven on EST1051: owner_id null, assigned_tech_id null, invisible. The
-- website lead push was about to create one of these per customer.
--
-- The function is SECURITY DEFINER and already knows the owner as c_owner, so
-- it sets owner_id itself rather than depending on who happens to be calling.
--
-- 2. APPOINTMENTS WERE 14 HOURS OUT.
--
-- Exactly the bug 048 fixed in save_invoice_with_items, never applied here.
-- gcal_date is TEXT holding a LOCAL Hawaii wall clock, 'YYYY-MM-DDTHH:MM'.
-- This function wrote `p_appointment::timestamptz`; the database runs UTC, so
-- '2026-10-21T08:00' came back '2026-10-21 08:00:00+00', which is 10pm on the
-- 20th in Honolulu. Every other row in the table is in the plain local form.
--
-- Now stored verbatim when it matches that shape, and ignored when it does
-- not, so a malformed string can no longer abort the insert either.

CREATE OR REPLACE FUNCTION public.create_estimate_from_lead(p_secret text, p_name text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_problem text DEFAULT NULL::text, p_urgency text DEFAULT NULL::text, p_callback_window text DEFAULT NULL::text, p_owner_or_tenant text DEFAULT NULL::text, p_new_or_existing text DEFAULT NULL::text, p_heard_from text DEFAULT NULL::text, p_services text[] DEFAULT NULL::text[], p_appointment text DEFAULT NULL::text, p_caller_id text DEFAULT NULL::text, p_lead_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_channel       text;
begin
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'INVALID_INPUT: caller name is required';
  end if;

  -- Normalise rather than reject. A caller sending 'Yelp!' or 'Google Ads'
  -- means a real channel and should not be dropped on the floor, but it must
  -- not create a second spelling either: one spelling per channel, or the
  -- reporting splits in half and every number is wrong.
  v_channel := lower(btrim(coalesce(p_lead_channel, '')));
  v_channel := regexp_replace(v_channel, '[^a-z0-9]+', '_', 'g');
  v_channel := btrim(v_channel, '_');
  v_channel := left(nullif(v_channel, ''), 40);
  v_channel := coalesce(v_channel, 'phone');

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

  -- The first line is load-bearing: 031 and 032 strip it from the emailed copy
  -- by matching '^AI receptionist \(Lisa\) lead'. Keep the wording byte for
  -- byte or the bookkeeping header starts showing up in the alert again.
  --
  -- 'Channel:' is deliberately NOT stripped. When a lead comes off the website
  -- rather than the phone, that is the first thing worth knowing.
  v_internal :=
      'AI receptionist (Lisa) lead - ' || to_char(now(), 'Mon DD, HH12:MI AM') || E'\n' ||
      'Phone source: '      || v_phone_src || E'\n' ||
      'Channel: '           || v_channel || E'\n' ||
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

  -- source stays 'ai_lead'. See the header: two triggers are gated on it.
  insert into public.invoices (
    id, owner_id, type, client_id, client_name, date, status,
    notes, internal_notes, source, lead_channel, job_address, gcal_date, year,
    client_info, view_token, updated_at
  ) values (
    v_id, c_owner, 'estimate', v_client_id, p_name, current_date, 'outstanding',
    '', v_internal, 'ai_lead', v_channel, v_job_address,
    case when nullif(trim(coalesce(p_appointment, '')), '')
              ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
         then trim(p_appointment) else null end,
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
    'lead_channel',   v_channel,
    'view_token',     v_token
  );
end;
$function$


-- 077_lead_name_phone_transfer.sql
-- ─── Three things the Les Lee call (2026-10-27) exposed ────────────────────
--
-- 1. The name never reached the database. capture_abandoned_call() has taken
--    p_name since 035, but api/vapi-call-ended.js called it with five
--    arguments, so every rescued lead was filed as 'Missed call - no name
--    given' and minted a client row of that name. (STATUS.md blamed
--    create_estimate_from_lead; that function was fine, it was handed the
--    placeholder.) The webhook now passes the name from Vapi's structured
--    analysis. This migration makes the database side robust to it:
--      * create_estimate_from_lead: a known number keeps its real name when the
--        placeholder arrives, and a real name replaces a placeholder client.
--
-- 2. One phone number, many spellings. clients holds ten shapes
--    ('(808) 226-3737', '+18082263737', '8082263737', ...). Matching works on
--    the last ten digits, so lookups survive it, but the same person can still
--    end up as two rows. trg_normalize_client_phone stores every NEW or CHANGED
--    phone/mobile as E.164 when it is an unambiguous 10-digit US number (or 11
--    digits with a leading 1). Anything else is left alone. Existing rows are
--    NOT rewritten here; that is a data change for Jake to approve.
--
-- 3. capture_abandoned_call gains p_transferred. A call Jake took was filed as
--    'the caller hung up'. It now says TRANSFERRED TO JACOB, and does not
--    suggest a callback to a customer he already spoke to. The old 6-argument
--    signature is DROPPED: leaving both makes PostgREST answer PGRST203 (the
--    same trap as 074), so the drop and the reload below belong together.
--    It also files a status='suggested' call_queue row (076) for a hangup.
--
-- Both functions below are the LIVE definitions (pg_get_functiondef,
-- 2026-10-27) with the edits above anchor-matched in. Not rewritten from older
-- migrations, which is how 062 and 063 silently reverted work.

begin;

create or replace function public.normalize_phone_e164(p text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if length(d) = 10 then return '+1' || d; end if;
  if length(d) = 11 and left(d, 1) = '1' then return '+' || d; end if;
  return p;
end $$;

create or replace function public.clients_normalize_phone()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.mobile is distinct from old.mobile then
    new.mobile := public.normalize_phone_e164(new.mobile);
  end if;
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    new.phone := public.normalize_phone_e164(new.phone);
  end if;
  return new;
end $$;

drop trigger if exists trg_normalize_client_phone on public.clients;
create trigger trg_normalize_client_phone
  before insert or update on public.clients
  for each row execute function public.clients_normalize_phone();

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
  v_name          text;
  v_existing_name text;
  c_placeholder   constant text := 'Missed call - no name given';
begin
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'INVALID_INPUT: caller name is required';
  end if;
  v_name := btrim(p_name);

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

  -- A number we already know keeps its real name. The abandoned-call net files
  -- 'Missed call - no name given' when nobody gave one; that placeholder must
  -- never overwrite a real client's name on the estimate, and a real name
  -- arriving later must replace the placeholder on the client rather than leave
  -- two rows for one person (Les Lee, 2026-10-27).
  if v_client_id is not null then
    select name into v_existing_name from public.clients where id = v_client_id;
    if v_name = c_placeholder and coalesce(btrim(v_existing_name), '') not in ('', c_placeholder) then
      v_name := v_existing_name;
    elsif v_name <> c_placeholder and v_existing_name = c_placeholder then
      update public.clients set name = v_name where id = v_client_id;
    end if;
  end if;

  if v_client_id is null then
    insert into public.clients (name, mobile, address1)
    values (v_name, v_phone_out, nullif(trim(coalesce(p_address, '')), ''))
    returning id into v_client_id;
    v_is_new_client := true;
  end if;

  -- One shared EST/INV sequence (040), drawn under a row lock (060), so
  -- EST1000 can always convert to INV1000.
  v_num := public.allocate_doc_number();
  v_id  := 'EST' || lpad(v_num::text, 4, '0');

  -- The first line is load-bearing: 031 and 032 strip it from the emailed copy
  -- by matching '^AI receptionist \(Lisa\) lead'. Keep the wording byte for
  -- byte or the bookkeeping header starts showing up in the alert again.
  --
  -- 'Channel:' is deliberately NOT stripped. When a lead comes off the website
  -- rather than the phone, that is the first thing worth knowing.
  v_internal :=
      'AI receptionist (Lisa) lead - ' || to_char(now() at time zone 'Pacific/Honolulu', 'Mon DD, HH12:MI AM') || E'\n' ||
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
    'name',     v_name,
    'phone',    v_phone_out,
    'address1', nullif(trim(coalesce(p_address, '')), '')
  );

  -- source stays 'ai_lead'. See the header: two triggers are gated on it.
  insert into public.invoices (
    id, owner_id, type, client_id, client_name, date, status,
    notes, internal_notes, source, lead_channel, job_address, gcal_date, visits, year,
    client_info, view_token, updated_at
  ) values (
    v_id, c_owner, 'estimate', v_client_id, v_name, (now() at time zone 'Pacific/Honolulu')::date, 'outstanding',
    '', v_internal, 'ai_lead', v_channel, v_job_address,
    case when nullif(trim(coalesce(p_appointment, '')), '')
              ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
         then trim(p_appointment) else null end,
    -- The same appointment as a visit, the source of truth since 044.
    case when nullif(trim(coalesce(p_appointment, '')), '')
              ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
         then jsonb_build_array(jsonb_build_object(
                'id',      'v_' || substr(md5(v_id || trim(p_appointment)), 1, 8),
                'start',   trim(p_appointment),
                'minutes', coalesce((select nullif(value, '')::int from public.settings
                                       where key = 'gcal_default_minutes'), 90),
                'label',   '',
                'kind',    'estimate',
                'eventId', null))
         else null end,
    extract(year from (now() at time zone 'Pacific/Honolulu')::date)::int, v_client_info, v_token, now()
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
$function$;

drop function if exists public.capture_abandoned_call(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.capture_abandoned_call(p_secret text, p_caller_id text, p_call_id text DEFAULT NULL::text, p_transcript text DEFAULT NULL::text, p_summary text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_transferred boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret   text;
  v_digits   text;
  v_existing text;
  v_lead     text;
  v_result   jsonb;
  v_problem  text;
  v_notes    text;
  v_cname    text;
begin
  select value into v_secret from public.settings where key = 'sms_webhook_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing webhook secret';
  end if;

  v_digits := right(regexp_replace(coalesce(p_caller_id, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then
    return jsonb_build_object('skipped', 'no usable caller id');
  end if;

  select id into v_existing
    from public.invoices
   where source = 'ai_lead'
     and created_at > now() - interval '30 minutes'
     and right(regexp_replace(coalesce(client_info->>'phone', ''), '\D', '', 'g'), 10) = v_digits
   order by created_at desc
   limit 1;

  if v_existing is not null then
    return jsonb_build_object('skipped', 'lead already filed', 'estimate_id', v_existing);
  end if;

  v_problem := nullif(btrim(coalesce(p_summary, '')), '');
  if v_problem is null then
    v_problem := 'Caller hung up before details were collected. See transcript in notes.';
  end if;

  select public.create_estimate_from_lead(
           (select value from public.settings where key = 'lead_secret'),
           coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Missed call - no name given'),
           null,
           null,
           v_problem,
           'unknown - call ended early',
           null, null, null, null,
           null,
           null,
           p_caller_id
         ) into v_result;

  v_lead := v_result->>'estimate_id';

  v_notes := coalesce((select internal_notes from public.invoices where id = v_lead), '')
             || case when coalesce(p_transferred, false)
                  then E'\n\n--- TRANSFERRED TO JACOB ---'
                       || E'\nLisa warm-transferred this caller to Jacob, so the call ended before she'
                       || E' filed a lead. Details below are from the transcript.'
                  else E'\n\n--- ABANDONED CALL ---'
                       || E'\nThe caller hung up before Lisa finished collecting details.'
                end
             || coalesce(E'\nVapi call id: ' || p_call_id, '')
             || coalesce(E'\n\nTranscript:\n' || p_transcript, E'\n\n(no transcript captured)');

  perform public.set_invoice_internal_notes(v_lead, v_notes);

  -- Offer Jake a callback. status 'suggested' is never selected by the dialler;
  -- he releases it (outbound_call.py release ID) or leaves it. Not offered when
  -- he already spoke to them. Must never cost the lead, hence the sub-block.
  if not coalesce(p_transferred, false) then
    begin
      select name into v_cname from public.clients where id = (v_result->>'client_id')::uuid;
      insert into public.call_queue
        (phone, client_name, client_id, invoice_id, purpose, context, status, queued_by)
      values
        (public.normalize_phone_e164(coalesce(v_result->>'phone', p_caller_id)),
         v_cname, (v_result->>'client_id')::uuid, v_lead,
         'returning their call to HI Grade, which dropped before we finished. They said: '
           || left(v_problem, 400),
         'Estimate ' || v_lead || ' already exists for this caller. Do not file another.',
         'suggested', 'abandoned-call net');
    exception when others then
      raise warning 'call_queue suggestion failed: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'created',     true,
    'estimate_id', v_lead,
    'phone',       v_result->>'phone'
  );
end;
$function$;

revoke execute on function public.capture_abandoned_call(text, text, text, text, text, text, boolean) from public;
grant  execute on function public.capture_abandoned_call(text, text, text, text, text, text, boolean) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

select proname, pronargs from pg_proc where proname in ('capture_abandoned_call','create_estimate_from_lead') order by 1;

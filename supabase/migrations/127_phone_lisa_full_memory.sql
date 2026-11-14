-- 127_phone_lisa_full_memory.sql
-- ─── Phone Lisa reads the same whole memory as text and Yelp Lisa ───────────
--
-- Jake, 2026-11-14: "the phone and text and yelp Lisa always need to share the
-- same memory for everything ... Lisa is true to the same memory for every
-- interaction with customers." Text and Yelp got the whole history in v1.81.7.
-- lookup_client_by_phone() (what phone Lisa calls first on every call) still
-- gave the last 10 items from 30 days, 200 characters each, and no visit Lisa
-- had booked by text (those live in gcal_date, not visits[]).
--
-- Now: recent_contact is the whole timeline (every channel, every number on
-- the client record, up to 300 items, 1200 characters each, oldest first),
-- appointments include gcal_date bookings, and `phones` lists the numbers on
-- file. client_timeline_internal() (behind text, Yelp and phone Lisa alike)
-- now matches every number on the client record: Marianne's early texts had no
-- client_id, so a lookup from Neil's number found 18 of their 36 items.
-- Everything else is unchanged from 123.

begin;

create or replace function public.client_timeline_internal(
  p_client_id uuid default null,
  p_phone     text default null,
  p_limit     int  default 60
) returns table (at timestamptz, channel text, direction text, who text, body text, ref text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_phones text[];
begin
  if p_client_id is null and length(v_digits) <> 10 then
    return;
  end if;
  -- Every number on the client record, plus the one calling or texting. Rows
  -- logged before the client existed have no client_id and are found by number.
  select array_agg(distinct d) filter (where length(d) = 10) into v_phones
    from (select v_digits as d
          union all select right(regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g'), 10) from public.clients c where c.id = p_client_id
          union all select right(regexp_replace(coalesce(c.phone,  ''), '\D', '', 'g'), 10) from public.clients c where c.id = p_client_id) s;
  v_phones := coalesce(v_phones, '{}');

  return query
  select * from (
    -- Texts to and from 808-444-5450.
    select m.created_at, 'text'::text,
           coalesce(m.direction, 'inbound'),
           case when m.direction = 'inbound' then 'customer'
                when m.related_call_id is not null then 'Lisa' else 'HI Grade' end,
           coalesce(m.body, '') || case when jsonb_typeof(m.media) = 'array' and jsonb_array_length(m.media) > 0
                                        then ' [' || jsonb_array_length(m.media) || ' attachment(s)]' else '' end,
           m.id::text
      from public.client_messages m
     where (p_client_id is not null and m.client_id = p_client_id)
        or right(regexp_replace(coalesce(m.phone_number, ''), '\D', '', 'g'), 10) = any(v_phones)

    union all
    -- Phone calls, with the summary Lisa's call produced.
    select c.created_at, 'call'::text,
           coalesce(c.direction, 'inbound'),
           'Lisa'::text,
           coalesce(nullif(btrim(c.summary), ''), 'Call, no summary')
             || case when c.seconds is not null then ' (' || c.seconds || 's)' else '' end,
           c.call_id
      from public.vapi_calls c
     where (p_client_id is not null and c.client_id = p_client_id)
        or right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = any(v_phones)

    union all
    -- Yelp messages, every one in every matching thread.
    select coalesce((e.m->>'at')::timestamptz, y.updated_at), 'yelp'::text,
           case when e.m->>'role' = 'consumer' then 'inbound' else 'outbound' end,
           case when e.m->>'role' = 'consumer' then 'customer'
                when e.m->>'by' = 'owner' then 'Jake' else 'Lisa' end,
           coalesce(e.m->>'text', ''),
           y.lead_id
      from public.yelp_threads y
     cross join lateral jsonb_array_elements(coalesce(y.messages, '[]'::jsonb)) as e(m)
     where (p_client_id is not null and y.client_id = p_client_id)
        or right(regexp_replace(coalesce(y.phone, ''), '\D', '', 'g'), 10) = any(v_phones)

    union all
    -- Estimates and invoices sent (email or text) from the app.
    select ev.created_at,
           case when ev.recipient like '%@%' then 'email' else 'text' end,
           'outbound'::text, 'HI Grade'::text,
           'Sent ' || coalesce(i.type, 'document') || ' ' || i.id
             || coalesce(' to ' || nullif(ev.recipient, ''), ''),
           i.id
      from public.invoice_events ev
      join public.invoices i on i.id = ev.invoice_id
     where ev.kind = 'sent' and p_client_id is not null and i.client_id = p_client_id
       and i.deleted_at is null
  ) t(at, channel, direction, who, body, ref)
  order by t.at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 60), 300));
end;
$$;

CREATE OR REPLACE FUNCTION public.lookup_client_by_phone(p_secret text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret  text;
  v_digits  text;
  v_c       record;
  v_addr    text;
  v_jobs    int;
  v_last    record;
  v_open    int;
  v_today   text;
  v_appts   jsonb;
  v_recent  jsonb;
begin
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then
    return jsonb_build_object('found', false, 'reason', 'no usable caller id');
  end if;

  select id, name, email, address1, address_unit, addresses, mobile, phone
    into v_c
    from public.clients
   where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_digits
      or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_digits
   order by created_at asc
   limit 1;

  if v_c.id is null then
    v_recent := (select coalesce(jsonb_agg(jsonb_build_object(
                 'when', to_char(t.at at time zone 'Pacific/Honolulu', 'Dy Mon DD HH12:MI AM'),
                 'channel', t.channel, 'from', case when t.direction = 'inbound' then 'customer' else t.who end,
                 'said', left(regexp_replace(t.body, '\s+', ' ', 'g'), 1200)) order by t.at), '[]'::jsonb)
       from public.client_timeline_internal(null, p_phone, 300) t);
    return jsonb_build_object('found', false, 'recent_contact', v_recent);
  end if;

  v_addr := nullif(btrim(coalesce(v_c.address1, '')), '');
  if v_addr is null and jsonb_typeof(v_c.addresses) = 'array' then
    select nullif(btrim(coalesce(a->>'line1', '')), '')
      into v_addr
      from jsonb_array_elements(v_c.addresses) as a
     limit 1;
  end if;
  if v_addr is not null and nullif(btrim(coalesce(v_c.address_unit, '')), '') is not null then
    v_addr := v_addr || ' ' || btrim(v_c.address_unit);
  end if;

  select count(*) into v_jobs
    from public.invoices
   where client_id = v_c.id and deleted_at is null;

  select id, type, date, status
    into v_last
    from public.invoices
   where client_id = v_c.id and deleted_at is null
   order by coalesce(date, created_at::text) desc
   limit 1;

  select count(*) into v_open
    from public.invoices
   where client_id = v_c.id and deleted_at is null
     and type = 'invoice' and coalesce(status, '') <> 'paid';

  -- Hawaii "today" as YYYY-MM-DD, to compare against the stored local text.
  v_today := to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM-DD');

  select coalesce(jsonb_agg(x.j order by x.start_txt), '[]'::jsonb)
    into v_appts
    from (
      select vis->>'start' as start_txt,
             jsonb_build_object(
               'start',      vis->>'start',
               'minutes',    vis->'minutes',
               'what',       coalesce(nullif(vis->>'label', ''), vis->>'kind', ''),
               'kind',       coalesce(vis->>'kind', ''),
               'on_calendar', coalesce(nullif(vis->>'eventId', ''), '') <> '',
               'document',   i.id,
               'doc_type',   i.type
             ) as j
        from public.invoices i
       cross join lateral jsonb_array_elements(
              case when jsonb_typeof(i.visits) = 'array' then i.visits else '[]'::jsonb end
            ) as vis
       where i.client_id = v_c.id
         and i.deleted_at is null
         and coalesce(vis->>'start', '') >= v_today
      union all
      -- A visit Lisa booked by text or Yelp lives in gcal_date with no visits[]
      -- entry. Phone Lisa could not see them: Marianne called to confirm her
      -- 4:30 (EST1211) and was told it "isn't on the live schedule".
      select left(i.gcal_date, 16),
             jsonb_build_object(
               'start',      left(i.gcal_date, 16),
               'minutes',    null,
               'what',       '',
               'kind',       '',
               'on_calendar', coalesce(i.gcal_event_id, '') <> '',
               'document',   i.id,
               'doc_type',   i.type
             )
        from public.invoices i
       where i.client_id = v_c.id
         and i.deleted_at is null
         and coalesce(i.gcal_date, '') >= v_today
         and not exists (
           select 1 from jsonb_array_elements(case when jsonb_typeof(i.visits) = 'array' then i.visits else '[]'::jsonb end) v2
            where left(v2->>'start', 16) = left(i.gcal_date, 16))
       order by 1
       limit 5
    ) x(start_txt, j);

  v_recent := (select coalesce(jsonb_agg(jsonb_build_object(
                 'when', to_char(t.at at time zone 'Pacific/Honolulu', 'Dy Mon DD HH12:MI AM'),
                 'channel', t.channel, 'from', case when t.direction = 'inbound' then 'customer' else t.who end,
                 'said', left(regexp_replace(t.body, '\s+', ' ', 'g'), 1200)) order by t.at), '[]'::jsonb)
       from public.client_timeline_internal(v_c.id, p_phone, 300) t);

  return jsonb_build_object(
    'found',            true,
    'client_id',        v_c.id,
    'name',             v_c.name,
    'address_on_file',  coalesce(v_addr, ''),
    'email_on_file',    coalesce(v_c.email, ''),
    'total_jobs',       coalesce(v_jobs, 0),
    'last_job_date',    coalesce(v_last.date, ''),
    'last_job_type',    coalesce(v_last.type, ''),
    'open_invoices',    coalesce(v_open, 0),
    'phones',           to_jsonb(array_remove(array[nullif(v_c.mobile, ''), nullif(v_c.phone, '')], null)),
    'appointments',     v_appts,
    'recent_contact',   v_recent
  );
end;
$function$;

commit;

notify pgrst, 'reload schema';

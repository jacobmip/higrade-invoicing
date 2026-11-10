-- 122_client_timeline.sql
-- ─── One brain per client: link every conversation, read it as one timeline ──
--
-- Jake (2026-11-09): every conversation Lisa has with a client, on any channel,
-- must sit on that client's profile. Before this, phone calls were linked to a
-- client 1 time in 30, Yelp threads only when Lisa matched the customer, and
-- each Lisa (phone, text, Yelp) read only her own channel.
--
-- 1. client_id_for_phone(): the client whose phone or mobile matches the last
--    10 digits, ONLY when exactly one client matches. Two clients on one
--    number is ambiguous and stays unlinked rather than guessed.
-- 2. Triggers fill client_id on insert (and on a phone change for Yelp) in
--    vapi_calls, client_messages and yelp_threads. Existing rows backfilled.
-- 3. client_timeline(): texts, calls (with Lisa's summary), Yelp messages and
--    documents sent, newest first, for a client id and/or a phone number.
--    Admins (the app) and the service role (Lisa's servers) only.

begin;

create or replace function public.client_id_for_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with d as (select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) as v),
  m as (
    select c.id
      from public.clients c, d
     where length(d.v) = 10
       and (right(regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g'), 10) = d.v
         or right(regexp_replace(coalesce(c.phone,  ''), '\D', '', 'g'), 10) = d.v)
  )
  select case when (select count(*) from m) = 1 then (select id from m) end;
$$;
revoke all on function public.client_id_for_phone(text) from public, anon, authenticated;

create or replace function public.tg_link_client_by_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   jsonb := to_jsonb(NEW);
  v_phone text  := coalesce(v_row->>'phone_number', v_row->>'phone');
  v_id    uuid;
begin
  if NEW.client_id is not null then
    return NEW;
  end if;
  v_id := public.client_id_for_phone(v_phone);
  if v_id is null then
    return NEW;
  end if;
  NEW.client_id := v_id;
  -- Yelp threads carry how the client was matched; a phone match is the
  -- strongest level Lisa knows.
  if TG_TABLE_NAME = 'yelp_threads' then
    NEW.match_level := 'phone';
  end if;
  return NEW;
end;
$$;

drop trigger if exists link_client_by_phone on public.vapi_calls;
create trigger link_client_by_phone before insert or update of phone on public.vapi_calls
  for each row execute function public.tg_link_client_by_phone();

drop trigger if exists link_client_by_phone on public.client_messages;
create trigger link_client_by_phone before insert or update of phone_number on public.client_messages
  for each row execute function public.tg_link_client_by_phone();

drop trigger if exists link_client_by_phone on public.yelp_threads;
create trigger link_client_by_phone before insert or update on public.yelp_threads
  for each row execute function public.tg_link_client_by_phone();

-- Backfill. Only rows with no client yet; ambiguous numbers stay null.
update public.vapi_calls      set client_id = public.client_id_for_phone(phone)
 where client_id is null and public.client_id_for_phone(phone) is not null;
update public.client_messages set client_id = public.client_id_for_phone(phone_number)
 where client_id is null and public.client_id_for_phone(phone_number) is not null;
update public.yelp_threads    set client_id = public.client_id_for_phone(phone), match_level = 'phone'
 where client_id is null and public.client_id_for_phone(phone) is not null;

create or replace function public.client_timeline(
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
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'FORBIDDEN: admin or service role only';
  end if;
  if p_client_id is null and length(v_digits) <> 10 then
    return;
  end if;

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
        or (length(v_digits) = 10 and right(regexp_replace(coalesce(m.phone_number, ''), '\D', '', 'g'), 10) = v_digits)

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
        or (length(v_digits) = 10 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = v_digits)

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
        or (length(v_digits) = 10 and right(regexp_replace(coalesce(y.phone, ''), '\D', '', 'g'), 10) = v_digits)

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
revoke all on function public.client_timeline(uuid, text, int) from public, anon;
grant execute on function public.client_timeline(uuid, text, int) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- 113_lookup_client_appointments.sql
-- ─── Let Lisa see the caller's booked appointments ──────────────────────────
--
-- 2026-11-08: Javier De la Cuba called to ask whether his 9am visit was still
-- on (the tech was running late). Lisa recognised him by caller ID but could
-- not answer, because lookup_client_by_phone (036) only returned name, address,
-- invoice counts and open invoices. It never read invoices.visits, where every
-- booked appointment lives (migration 044). So she had no record of a visit
-- that existed, was on his profile, and had a Google Calendar event.
--
-- This adds one key, `appointments`, to the existing return object. Nothing
-- else about the function changes, so every current reader keeps working and
-- the new key is simply ignored by anything that does not look for it.
--
-- What counts as an appointment:
--   * any entry in invoices.visits of a non-deleted invoice OR estimate for
--     this client (a paid invoice can still have today's visit on it)
--   * starting today (Hawaii time) or later. Today's earlier visits are kept
--     on purpose: "my 9am, are you still coming?" is asked at 9:30.
--   * at most the next 5, soonest first, so the tool result stays short
--     enough for a voice model to read mid-call.
--
-- `start` is the plain local string the app stores ("2026-11-06T09:00",
-- Hawaii wall-clock, see 048), so it is compared as text against Hawaii
-- today and never cast through timestamptz.
--
-- Read-only, same lead_secret gate as before.

create or replace function public.lookup_client_by_phone(
  p_secret text,
  p_phone  text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
begin
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then
    return jsonb_build_object('found', false, 'reason', 'no usable caller id');
  end if;

  select id, name, email, address1, address_unit, addresses
    into v_c
    from public.clients
   where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_digits
      or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_digits
   order by created_at asc
   limit 1;

  if v_c.id is null then
    return jsonb_build_object('found', false);
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
       order by vis->>'start'
       limit 5
    ) x;

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
    'appointments',     v_appts
  );
end;
$$;

revoke execute on function public.lookup_client_by_phone(text, text) from public;
grant  execute on function public.lookup_client_by_phone(text, text) to anon, authenticated;

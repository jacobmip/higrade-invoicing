-- 036_lookup_client_by_phone.sql
-- ─── Let Lisa recognise an existing customer from caller ID ─────────────────
--
-- Caller ID gives us a reliable number before the caller says a word, and the
-- client table has 270 rows. So Lisa should already know who is calling
-- instead of asking "are you a new or returning customer" and "what is your
-- address" to somebody who has used the business five times.
--
-- Returns a compact object designed to be read by a voice model mid-call:
-- short fields, no nulls that need special-casing, and a service history
-- summary rather than a dump of every invoice.
--
-- Phone matching is the same last-10-digits comparison used everywhere else,
-- because the client table holds six different phone formats.
--
-- SAFETY: this is called on every inbound call and returns customer PII, so
-- it is gated by lead_secret exactly like create_estimate_from_lead. It is
-- deliberately read-only.

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

  -- Prefer the primary saved address; fall back to the first in the jsonb
  -- list. Unit is appended so Lisa can confirm an apartment number.
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

  return jsonb_build_object(
    'found',            true,
    'client_id',        v_c.id,
    'name',             v_c.name,
    'address_on_file',  coalesce(v_addr, ''),
    'email_on_file',    coalesce(v_c.email, ''),
    'total_jobs',       coalesce(v_jobs, 0),
    'last_job_date',    coalesce(v_last.date, ''),
    'last_job_type',    coalesce(v_last.type, ''),
    'open_invoices',    coalesce(v_open, 0)
  );
end;
$$;

revoke execute on function public.lookup_client_by_phone(text, text) from public;
grant  execute on function public.lookup_client_by_phone(text, text) to anon, authenticated;

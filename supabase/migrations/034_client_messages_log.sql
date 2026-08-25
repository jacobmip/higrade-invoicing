-- 034_client_messages_log.sql
-- ─── Log SMS conversations against the client record ────────────────────────
--
-- client_messages was created by hand in an earlier session. This adds the
-- write path so the Vercel routes stay thin: they authenticate the caller and
-- hand the message here, and all the matching logic lives in one testable
-- place rather than being duplicated across two serverless functions.
--
-- Phone matching mirrors create_estimate_from_lead: compare the last 10
-- digits, because this database holds six different phone formats (bare
-- digits, E.164, (808) 555-1234, dashed, and a scattering of one-offs) and an
-- exact string match would miss most of them.
--
-- owner_id is set on insert. The column is nullable with no default, and the
-- RLS policies are ((owner_id = auth.uid()) OR is_admin()), so a NULL would
-- leave rows visible only to admins. Jake is admin so he would not notice,
-- but the 'plumber' role account would silently never see any messages.
--
-- A2P NOTE: outbound SMS to US numbers is dropped by carriers with error
-- 30034 until A2P 10DLC registration completes. Verified against the Twilio
-- API on 2026-08-24: zero brand registrations, zero messaging services, and
-- the only message ever sent came back 'undelivered'. Logging an outbound row
-- here does NOT mean it was delivered. sms_outbound_enabled gates the actual
-- send so it can be switched on without a redeploy once A2P clears.

insert into public.settings (key, value) values
  ('sms_outbound_enabled', 'false'),
  ('sms_webhook_secret',   replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.log_client_message(
  p_secret    text,
  p_phone     text,
  p_direction text,
  p_body      text,
  p_call_id   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret    text;
  v_digits    text;
  v_client    record;
  v_owner     uuid;
  v_id        uuid;
begin
  select value into v_secret from public.settings where key = 'sms_webhook_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing sms webhook secret';
  end if;

  if p_direction not in ('outbound', 'inbound') then
    raise exception 'INVALID_INPUT: direction must be outbound or inbound';
  end if;
  if coalesce(btrim(coalesce(p_body, '')), '') = '' then
    raise exception 'INVALID_INPUT: body is required';
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);

  if length(v_digits) = 10 then
    select id, name, owner_id into v_client
      from public.clients
     where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_digits
        or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_digits
     order by created_at asc
     limit 1;
  end if;

  -- Fall back to the admin so the row is never orphaned by RLS.
  v_owner := coalesce(
    v_client.owner_id,
    (select id from public.profiles where role = 'admin' order by created_at asc limit 1)
  );

  insert into public.client_messages
    (client_id, owner_id, phone_number, direction, body, related_call_id)
  values
    (v_client.id, v_owner, p_phone, p_direction, p_body, nullif(btrim(coalesce(p_call_id,'')), ''))
  returning id into v_id;

  return jsonb_build_object(
    'message_id',   v_id,
    'client_id',    v_client.id,
    'client_name',  v_client.name,
    'matched',      v_client.id is not null,
    'owner_id',     v_owner
  );
end;
$$;

revoke execute on function public.log_client_message(text, text, text, text, text) from public;
grant  execute on function public.log_client_message(text, text, text, text, text) to anon, authenticated;

-- Convenience read for the app: a client's SMS thread, newest last.
create or replace function public.client_message_thread(p_client_id uuid)
returns table (id uuid, direction text, body text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select id, direction, body, created_at
    from public.client_messages
   where client_id = p_client_id
   order by created_at asc;
$$;

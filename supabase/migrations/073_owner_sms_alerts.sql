-- 073_owner_sms_alerts.sql
--
-- Text Jake from the database, and use it to tell him the moment someone
-- clocks in or out away from the job site.
--
-- WHY FROM THE DATABASE
-- The clock-in happens on the apprentice's phone. An alert the apprentice's
-- phone is responsible for sending is an alert that does not arrive when he
-- has no signal, and one he could stop arriving at all. The database is the
-- one place that always sees the row.
--
-- WHY THE `http` EXTENSION AND NOT pg_net
-- Twilio's Messages endpoint takes form-encoded parameters. pg_net only sends
-- a JSON body, so it cannot talk to Twilio directly, and there is no API route
-- in this app that relays an SMS (Vercel's 12-function cap means adding one is
-- not free). `http` 1.6 is already installed and can set both the content type
-- and the Basic auth header.
--
-- The cost is that the call is synchronous: an off-site clock event waits on
-- Twilio. That is deliberately the slow path — it only runs when something is
-- already wrong, the curl timeout is 6s, and the whole thing is wrapped so a
-- Twilio outage can never stop a man clocking in.
--
-- WHAT IS NOT PROVEN HERE
-- `references/a2p-10dlc.md` records that A2P 10DLC is registered and that one
-- real text was delivered on 2026-09-07 straight through Twilio's API — and
-- that the app's own send path has never sent anything. Twilio answers 201 on
-- a message a carrier later drops, which is exactly how the earlier 30034
-- failures looked like successes. So this records Twilio's message SID and
-- status on the row rather than assuming, and the first alert is still the
-- first real test of this path.

begin;

-- ── 1. Text the owner ──────────────────────────────────────────────────────
-- SECURITY DEFINER because the caller is an apprentice whose own RLS, as of
-- migration 070, cannot read twilio_sid or twilio_token. He triggers the text;
-- he never sees the credentials that send it.
create or replace function public.send_owner_sms(p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sid     text;
  v_token   text;
  v_to      text;
  v_from    text;
  v_enabled text;
  v_auth    text;
  v_form    text;
  v_resp    extensions.http_response;
  v_json    jsonb;
begin
  select value into v_sid     from public.settings where key = 'twilio_sid';
  select value into v_token   from public.settings where key = 'twilio_token';
  select value into v_to      from public.settings where key = 'notify_to';
  select value into v_from    from public.settings where key = 'notify_from';
  select value into v_enabled from public.settings where key = 'sms_outbound_enabled';

  if coalesce(v_enabled, 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'skipped', 'sms_outbound_enabled is not true');
  end if;
  if v_sid is null or v_token is null or v_to is null or v_from is null then
    return jsonb_build_object('ok', false, 'skipped', 'twilio not configured');
  end if;

  -- encode() wraps base64 at 76 characters and a newline inside an HTTP header
  -- makes the request malformed. sid+token is 67 bytes, which encodes to 90,
  -- so this replace() is load-bearing, not defensive.
  v_auth := 'Basic ' || replace(encode((v_sid || ':' || v_token)::bytea, 'base64'), E'\n', '');

  v_form := 'To='   || extensions.urlencode(v_to)
         || '&From='|| extensions.urlencode(v_from)
         || '&Body='|| extensions.urlencode(left(p_body, 1500));

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000');

  select * into v_resp from extensions.http((
    'POST',
    'https://api.twilio.com/2010-04-01/Accounts/' || v_sid || '/Messages.json',
    array[extensions.http_header('Authorization', v_auth)],
    'application/x-www-form-urlencoded',
    v_form
  )::extensions.http_request);

  begin
    v_json := v_resp.content::jsonb;
  exception when others then
    v_json := '{}'::jsonb;
  end;

  -- Twilio's own status, carried back verbatim. 'queued' or 'accepted' means
  -- Twilio took it, NOT that a carrier delivered it.
  return jsonb_build_object(
    'ok',      v_resp.status between 200 and 299,
    'status',  v_resp.status,
    'sid',     v_json->>'sid',
    'twilio_status', v_json->>'status',
    'error',   coalesce(v_json->>'message', case when v_resp.status between 200 and 299 then null else left(v_resp.content, 200) end)
  );
end;
$$;

revoke all on function public.send_owner_sms(text) from public, anon;

comment on function public.send_owner_sms(text) is
  'Sends one SMS to settings.notify_to via Twilio and returns Twilio''s own '
  'status and message SID. SECURITY DEFINER so a tech can trigger an alert '
  'without being able to read the credentials (migration 073). A 2xx is '
  'Twilio accepting the message, not a carrier delivering it.';

-- ── 2. Tell Jake when a clock event is off-site ────────────────────────────
-- AFTER, so a Twilio problem cannot roll back the clock event, and wrapped in
-- its own exception block so it cannot raise either. The text is never the
-- record; the row is.
create or replace function public.tg_time_entry_offsite_alert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name   text;
  v_job    text;
  v_which  text;
  v_dist   double precision;
  v_res    jsonb;
begin
  -- Which end of the shift just went off-site, and only on the transition, so
  -- a later edit does not re-text.
  if tg_op = 'INSERT' and new.clock_in_on_site is false then
    v_which := 'clocked IN';
    v_dist  := new.clock_in_m;
  elsif tg_op = 'UPDATE'
        and new.clock_out_on_site is false
        and old.clock_out_on_site is distinct from false then
    v_which := 'clocked OUT';
    v_dist  := new.clock_out_m;
  else
    return new;
  end if;

  begin
    select coalesce(display_name, 'A tech') into v_name
      from public.profiles where id = new.tech_id;

    if new.invoice_id is not null then
      select coalesce(nullif(client_name, ''), id) into v_job
        from public.invoices where id = new.invoice_id;
    end if;

    v_res := public.send_owner_sms(
      v_name || ' ' || v_which || ' ' || round(v_dist)::text || 'm from '
      || coalesce(v_job, 'the job') || ' at '
      || to_char(timezone('Pacific/Honolulu', now()), 'HH12:MI AM')
      || '. Not on site. Check the entry in the app.'
    );

    update public.time_entries
       set alert_status = left(v_res::text, 300)
     where id = new.id;
  exception when others then
    begin
      update public.time_entries
         set alert_status = 'alert failed: ' || left(sqlerrm, 200)
       where id = new.id;
    exception when others then null;
    end;
  end;

  return new;
end;
$$;

-- The nested UPDATE on time_entries re-enters the BEFORE trigger, which is
-- harmless (it only recomputes the same numbers) but would re-enter this
-- AFTER trigger too. It does not loop: an UPDATE that only writes
-- alert_status leaves clock_out_on_site identical, so the transition test
-- above falls straight through to `return new`.
drop trigger if exists trg_time_entry_offsite_alert on public.time_entries;
create trigger trg_time_entry_offsite_alert
  after insert or update on public.time_entries
  for each row execute function public.tg_time_entry_offsite_alert();

commit;

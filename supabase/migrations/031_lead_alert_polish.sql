-- 031_lead_alert_polish.sql
-- ─── Two cosmetic bugs the first real call exposed ──────────────────────────
--
-- EST0795 was a live test call that captured no phone number, and it surfaced
-- what the synthetic tests could not:
--
--   1. Subject rendered as "NEW LEAD: Jacob -" with a dangling dash. The 028
--      subject used coalesce(' - ' || phone, ''), which guards against NULL,
--      but client_info->>'phone' is an empty STRING when nothing was captured,
--      and ' - ' || '' is ' - ', not null. nullif() is the correct guard.
--      030 makes the phone genuinely NULL when uncaptured, so this is belt and
--      braces, but old rows and odd inputs can still produce ''.
--
--   2. The email's "WHAT THEY SAID" block opened with
--      "AI receptionist (Lisa) lead - Aug 25, 02:18 AM", duplicating the
--      "NEW LEAD - LISA" banner directly above it and pushing the actual
--      complaint down. internal_notes keeps that header (it is useful inside
--      the app); the email now strips it.
--
-- Nothing else about the function changes from 029/030.

create or replace function public.notify_owner_of_lead()
returns trigger language plpgsql security definer
set search_path = public, net, extensions
as $$
declare
  v_msg     text;
  v_subject text;
  v_when    text;
  v_phone   text;
  v_details text;
  v_to      jsonb;
begin
  begin
    -- Empty string and NULL both mean "no number".
    v_phone := nullif(btrim(coalesce(NEW.client_info->>'phone', '')), '');

    -- gcal_date is TEXT, so cast before to_char (see 025).
    v_when := case
                when NEW.gcal_date is not null and NEW.gcal_date <> ''
                then to_char(NEW.gcal_date::timestamptz, 'Mon DD HH12:MI AM')
              end;

    -- Drop the "AI receptionist (Lisa) lead - <timestamp>" header line for the
    -- email only. The banner already says it. internal_notes keeps it.
    v_details := regexp_replace(
                   coalesce(NEW.internal_notes, ''),
                   '^AI receptionist \(Lisa\) lead[^\n]*\n+',
                   ''
                 );
    v_details := nullif(btrim(v_details), '');

    -- Plain-text version, still used for the in-app notification row.
    v_msg := 'NEW LEAD captured by Lisa (AI receptionist).' || E'\n'
             || coalesce(NEW.client_name, '(no name)')
             || coalesce(' - ' || v_phone, ' - (no phone)') || E'\n'
             || coalesce(NEW.internal_notes, '');
    if v_when is not null then
      v_msg := v_msg || E'\n\nRequested time: ' || v_when;
    end if;

    v_subject := 'NEW LEAD: ' || coalesce(NEW.client_name, 'unknown caller')
                 || coalesce(' - ' || v_phone, '');

    insert into public.notifications (type, title, body, invoice_id, data)
    values ('lead', 'New lead: ' || coalesce(NEW.client_name, ''), v_msg, NEW.id,
            jsonb_build_object('phone', v_phone));

    select coalesce(
             jsonb_agg(to_jsonb(btrim(addr))) filter (where btrim(addr) <> ''),
             '["higradeplumbing@gmail.com"]'::jsonb
           )
      into v_to
      from unnest(string_to_array(
             coalesce((select value from public.settings where key = 'lead_notify_to'), ''),
             ','
           )) as addr;

    perform net.http_post(
      url  := 'https://higrade-invoicing.vercel.app/api/send-email',
      body := jsonb_build_object(
                'to',          v_to,
                'bccAdmin',    false,
                'subject',     v_subject,
                'template',    'lead',
                'clientName',  coalesce(NEW.client_name, 'Unknown caller'),
                'leadPhone',   v_phone,
                'leadDetails', v_details,
                'leadWhen',    v_when,
                'invoiceId',   NEW.id,
                'message',     v_msg
              ),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 20000
    );
  exception when others then
    null;  -- never block the estimate on a notification hiccup
  end;
  return NEW;
end;
$$;

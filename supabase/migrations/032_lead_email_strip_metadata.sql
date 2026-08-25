-- 032_lead_email_strip_metadata.sql
-- ─── Keep bookkeeping out of the "WHAT THEY SAID" block ─────────────────────
--
-- 031 stripped the "AI receptionist (Lisa) lead - <timestamp>" header from the
-- email body. 030 then added a "Phone source: ..." line directly beneath it,
-- so the first real caller-ID call (EST0796) produced an email whose
-- "WHAT THEY SAID" section opened with:
--
--     Phone source: given by caller
--     Caller's words: Toilet flooding after flush, urgent situation
--
-- That block should contain what the caller actually said and nothing else.
-- Both lines are bookkeeping: useful inside the app on the estimate, noise in
-- an alert you read one-handed on a phone.
--
-- internal_notes is unchanged and still carries both lines. This strips them
-- from the emailed copy only.

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

    -- Drop bookkeeping lines for the email only. 'm' makes ^ match at each
    -- line start, so this catches them wherever they sit in the block.
    v_details := regexp_replace(
                   coalesce(NEW.internal_notes, ''),
                   '^(AI receptionist \(Lisa\) lead|Phone source:)[^\n]*\n?',
                   '', 'gm'
                 );
    v_details := nullif(btrim(v_details), '');

    -- Plain-text version, still used for the in-app notification row. This one
    -- keeps the full notes on purpose; it lives in the app next to the record.
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

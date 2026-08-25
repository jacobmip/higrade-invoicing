-- 029_lead_alert_template.sql
-- ─── Give lead alerts their own email layout ────────────────────────────────
--
-- Until now the alert reused /api/send-email's customer invoice template. Jake
-- opened one and it led with company letterhead, a license number, "Invoice
-- <id>", a bare "USD $" (the trigger passes an empty total), a blue
-- "Review & Pay" button and the line "Tap above to view your invoice and pay
-- securely" — an instruction to pay himself. The caller's name, phone and
-- problem sat below all of that.
--
-- The endpoint now accepts template: 'lead', which renders a compact internal
-- note instead: caller name, a tappable tel: link as the primary button, the
-- requested time, and what they said. No letterhead, no total, no payment CTA.
--
-- This migration passes the structured fields that layout needs. The
-- notifications row and the recipient list from 028 are unchanged.

create or replace function public.notify_owner_of_lead()
returns trigger language plpgsql security definer
set search_path = public, net, extensions
as $$
declare
  v_msg     text;
  v_subject text;
  v_when    text;
  v_to      jsonb;
begin
  begin
    -- gcal_date is TEXT, so cast before to_char (see 025).
    v_when := case
                when NEW.gcal_date is not null and NEW.gcal_date <> ''
                then to_char(NEW.gcal_date::timestamptz, 'Mon DD HH12:MI AM')
              end;

    -- Plain-text version, still used for the in-app notification row.
    v_msg := 'NEW LEAD captured by Lisa (AI receptionist).' || E'\n'
             || coalesce(NEW.client_name, '(no name)') || ' - '
             || coalesce(NEW.client_info->>'phone', '(no phone)') || E'\n'
             || coalesce(NEW.internal_notes, '');
    if v_when is not null then
      v_msg := v_msg || E'\n\nRequested time: ' || v_when;
    end if;

    v_subject := 'NEW LEAD: ' || coalesce(NEW.client_name, 'unknown caller')
                 || coalesce(' - ' || (NEW.client_info->>'phone'), '');

    insert into public.notifications (type, title, body, invoice_id, data)
    values ('lead', 'New lead: ' || coalesce(NEW.client_name, ''), v_msg, NEW.id,
            jsonb_build_object('phone', NEW.client_info->>'phone'));

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
                'leadPhone',   NEW.client_info->>'phone',
                'leadDetails', NEW.internal_notes,
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

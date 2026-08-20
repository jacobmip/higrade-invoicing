-- 024_lead_email_alert.sql
-- Supersedes 023's SMS alert. SMS is blocked until the Twilio number completes
-- A2P 10DLC registration (carrier error 30034 — unregistered number). Until
-- then, notify Jake via EMAIL through the app's existing /api/send-email
-- endpoint (Resend key already configured there) + an in-app notification row.
--
-- Notes:
--  * gcal_date is a TEXT column, so cast to timestamptz before to_char.
--  * 20s pg_net timeout so a cold Vercel function doesn't time out.
--  * Whole body wrapped so a notification failure never blocks the estimate.
--  * Once A2P 10DLC is approved, re-add the Twilio SMS send (see 023) alongside
--    or instead of the email.

create or replace function public.notify_owner_of_lead()
returns trigger language plpgsql security definer
set search_path = public, net, extensions
as $$
declare v_msg text;
begin
  begin
    v_msg := 'NEW LEAD captured by Lisa (AI receptionist).' || E'\n'
             || coalesce(NEW.client_name, '(no name)') || ' — '
             || coalesce(NEW.client_info->>'phone', '(no phone)') || E'\n'
             || coalesce(NEW.internal_notes, '');
    if NEW.gcal_date is not null and NEW.gcal_date <> '' then
      v_msg := v_msg || E'\n\nRequested time: ' || to_char(NEW.gcal_date::timestamptz, 'Mon DD HH12:MI AM');
    end if;

    insert into public.notifications (type, title, body, invoice_id, data)
    values ('lead', 'New lead: ' || coalesce(NEW.client_name, ''), v_msg, NEW.id,
            jsonb_build_object('phone', NEW.client_info->>'phone'));

    perform net.http_post(
      url  := 'https://higrade-invoicing.vercel.app/api/send-email',
      body := jsonb_build_object(
                'to',        'higradeplumbing@gmail.com',
                'clientName', coalesce(NEW.client_name, 'New lead'),
                'invoiceId',  NEW.id,
                'total',      '',
                'message',    v_msg,
                'viewLink',   'https://higrade-invoicing.vercel.app/v/' || coalesce(NEW.view_token, '')
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

-- Trigger already exists from 023 (trg_notify_owner_of_lead) pointing at this
-- function; create-or-replace above updates the behavior in place.

-- 028_lead_notify_recipients.sql
-- ─── Send lead alerts to more than one mailbox, configurable without a migration ──
--
-- Problem this fixes: 027 hardcoded the alert recipient to
-- higradeplumbing@gmail.com. The AIOS assistant is connected to Gmail as
-- jacobmip@gmail.com, so it could not see a single lead Lisa captured — the
-- alerts landed in a mailbox it has no access to.
--
-- Three changes:
--   1. Recipients now come from settings.lead_notify_to, a comma-separated
--      list, so changing where leads go is an UPDATE and never a migration.
--      Seeded with both the business and personal addresses.
--   2. bccAdmin is now explicitly false. /api/send-email BCCs
--      higradeplumbing@gmail.com on every send by default, which meant the
--      business mailbox received each lead twice.
--   3. A distinct subject line. /api/send-email previously built every subject
--      itself, so a lead alert arrived titled "Invoice EST#### from HI Grade
--      Plumbing" — indistinguishable from mail to a customer, and with no
--      reliable term to search or filter on. The endpoint now accepts an
--      optional `subject`; leads pass "NEW LEAD: <name> - <phone>".
--
-- Everything else about the function is unchanged from 027.

insert into public.settings (key, value) values
  ('lead_notify_to', 'higradeplumbing@gmail.com,jacobmip@gmail.com')
on conflict (key) do nothing;

create or replace function public.notify_owner_of_lead()
returns trigger language plpgsql security definer
set search_path = public, net, extensions
as $$
declare
  v_msg     text;
  v_subject text;
  v_to      jsonb;
begin
  begin
    v_msg := 'NEW LEAD captured by Lisa (AI receptionist).' || E'\n'
             || coalesce(NEW.client_name, '(no name)') || ' — '
             || coalesce(NEW.client_info->>'phone', '(no phone)') || E'\n'
             || coalesce(NEW.internal_notes, '');
    if NEW.gcal_date is not null and NEW.gcal_date <> '' then
      v_msg := v_msg || E'\n\nRequested time: ' || to_char(NEW.gcal_date::timestamptz, 'Mon DD HH12:MI AM');
    end if;

    -- Distinct subject so a lead never looks like a customer invoice in the
    -- inbox, and so 'NEW LEAD' is a reliable search term.
    v_subject := 'NEW LEAD: ' || coalesce(NEW.client_name, 'unknown caller')
                 || coalesce(' - ' || (NEW.client_info->>'phone'), '');

    insert into public.notifications (type, title, body, invoice_id, data)
    values ('lead', 'New lead: ' || coalesce(NEW.client_name, ''), v_msg, NEW.id,
            jsonb_build_object('phone', NEW.client_info->>'phone'));

    -- Comma-separated settings value -> JSON array of trimmed addresses.
    -- Falls back to the business mailbox if the setting is missing or blank.
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
                'to',         v_to,
                'bccAdmin',   false,
                'subject',    v_subject,
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

-- Trigger trg_notify_owner_of_lead already exists (from 026) and points at this
-- function; the create-or-replace above updates behavior in place.

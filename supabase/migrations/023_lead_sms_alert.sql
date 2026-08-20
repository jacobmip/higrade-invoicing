-- 023_lead_sms_alert.sql
-- Texts Jake whenever an AI-captured lead estimate is created (source='ai_lead').
-- Never fires on manual estimates/invoices. Wrapped so a texting failure can
-- never block the estimate from saving.
--
-- SECURITY NOTE: the real Twilio credentials are NOT stored in this file. They
-- were set directly in the database via:
--   insert into public.settings (key, value) values
--     ('twilio_sid', '<sid>'), ('twilio_token', '<token>'),
--     ('notify_from', '+18084445450'), ('notify_to', '+18083930015')
--   on conflict (key) do update set value = excluded.value;
-- Keep credentials in the settings table only — never commit them to git.

create extension if not exists pg_net;

-- Placeholder creds so a fresh clone is runnable; overwrite with real values
-- directly in the database (see note above). Does nothing if already set.
insert into public.settings (key, value) values
  ('twilio_sid',   'REPLACE_IN_DB'),
  ('twilio_token', 'REPLACE_IN_DB'),
  ('notify_from',  '+18084445450'),
  ('notify_to',    '+18083930015')
on conflict (key) do nothing;

create or replace function public.notify_owner_of_lead()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_sid text; v_token text; v_from text; v_to text; v_auth text; v_body text;
begin
  begin
    select value into v_sid   from public.settings where key = 'twilio_sid';
    select value into v_token from public.settings where key = 'twilio_token';
    select value into v_from  from public.settings where key = 'notify_from';
    select value into v_to    from public.settings where key = 'notify_to';
    if v_sid is null or v_token is null or v_to is null or v_sid = 'REPLACE_IN_DB' then
      return NEW;
    end if;

    v_auth := 'Basic ' || replace(encode((v_sid || ':' || v_token)::bytea, 'base64'), E'\n', '');

    v_body := 'New HI Grade lead ' || NEW.id || ': '
              || coalesce(NEW.client_name, '(no name)') || ' '
              || coalesce(NEW.client_info->>'phone', '')
              || case when NEW.gcal_date is not null
                      then ' | pref ' || to_char(NEW.gcal_date, 'Mon DD FMHH12:MI AM')
                      else '' end
              || '. Open the app to review & confirm.';

    perform net.http_post(
      url     := 'https://api.twilio.com/2010-04-01/Accounts/' || v_sid || '/Messages.json',
      body    := '{}'::jsonb,
      params  := jsonb_build_object('To', v_to, 'From', v_from, 'Body', v_body),
      headers := jsonb_build_object('Authorization', v_auth,
                                    'Content-Type', 'application/x-www-form-urlencoded')
    );
  exception when others then
    null;  -- never block the estimate on a texting hiccup
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_owner_of_lead on public.invoices;
create trigger trg_notify_owner_of_lead
  after insert on public.invoices
  for each row
  when (NEW.source = 'ai_lead')
  execute function public.notify_owner_of_lead();

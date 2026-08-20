-- 023_lead_sms_alert.sql
-- Texts Jake whenever an AI-captured lead estimate is created (source='ai_lead').
-- Never fires on manual estimates/invoices. Wrapped so a texting failure can
-- never block the estimate from saving.
--
-- Uses the `http` extension (not pg_net): Twilio's Messages API needs
-- form-encoded body params, and pg_net only sends JSON. `http` can form-encode.
--
-- SECURITY NOTE: real Twilio credentials are NOT in this file. They live in the
-- settings table, set directly in the DB:
--   insert into public.settings (key, value) values
--     ('twilio_sid','<sid>'), ('twilio_token','<token>'),
--     ('notify_from','+18084445450'), ('notify_to','+18083930015')
--   on conflict (key) do update set value = excluded.value;
-- Never commit credentials to git.

create extension if not exists http with schema extensions;

-- Placeholder creds so a fresh clone is runnable; overwrite in the DB (see note).
insert into public.settings (key, value) values
  ('twilio_sid',   'REPLACE_IN_DB'),
  ('twilio_token', 'REPLACE_IN_DB'),
  ('notify_from',  '+18084445450'),
  ('notify_to',    '+18083930015')
on conflict (key) do nothing;

create or replace function public.notify_owner_of_lead()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_sid text; v_token text; v_from text; v_to text; v_auth text; v_body text; v_form text;
  v_resp extensions.http_response;
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
    v_form := 'To='   || extensions.urlencode(v_to)
              || '&From=' || extensions.urlencode(v_from)
              || '&Body=' || extensions.urlencode(v_body);

    select * into v_resp from extensions.http((
      'POST',
      'https://api.twilio.com/2010-04-01/Accounts/' || v_sid || '/Messages.json',
      array[extensions.http_header('Authorization', v_auth)],
      'application/x-www-form-urlencoded',
      v_form
    )::extensions.http_request);
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

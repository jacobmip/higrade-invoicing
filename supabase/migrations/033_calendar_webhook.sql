-- 033_calendar_webhook.sql
-- ─── Push appointments to Google Calendar via a configurable webhook ────────
--
-- Vapi's own Google Calendar integration is broken on this account: the OAuth
-- popup closes instantly, confirmed twice including a clean incognito window.
-- So the database owns the push instead.
--
-- Deliberately NOT hardcoded to one provider. The target is a URL in
-- settings.gcal_webhook_url, so the same code works with a Google Apps Script
-- web app, an n8n webhook, a Make scenario, or anything else that accepts a
-- POST. Switching providers is an UPDATE, not a migration.
--
-- Why a webhook at all rather than calling Google directly: this is a consumer
-- Gmail account, so there is no Workspace domain-wide delegation, and an
-- unverified OAuth app left in Testing status has its refresh token expire
-- every 7 days. Both Apps Script (runs as the account owner) and n8n (a
-- verified OAuth app) dodge that entirely.
--
-- Two-way link: pg_net is fire-and-forget, so the response cannot be written
-- back inline. The receiver calls set_invoice_gcal_event() to report the
-- created event id, which finally populates invoices.gcal_event_id and makes
-- it possible to move or cancel the event later when a job reschedules.

-- ── Config ─────────────────────────────────────────────────────────────────
insert into public.settings (key, value) values
  ('gcal_webhook_url',    ''),                                      -- paste the Apps Script / n8n URL
  ('gcal_webhook_secret', replace(gen_random_uuid()::text, '-', '')),
  ('gcal_default_minutes', '90')
on conflict (key) do nothing;

-- ── Callback: receiver reports the created event id ────────────────────────
create or replace function public.set_invoice_gcal_event(
  p_secret   text,
  p_id       text,
  p_event_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_secret text;
begin
  select value into v_secret from public.settings where key = 'gcal_webhook_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing calendar webhook secret';
  end if;

  update public.invoices
     set gcal_event_id = nullif(btrim(coalesce(p_event_id, '')), '')
   where id = p_id;
end;
$$;

revoke execute on function public.set_invoice_gcal_event(text, text, text) from public;
grant  execute on function public.set_invoice_gcal_event(text, text, text) to anon, authenticated;

-- ── Push one invoice's appointment to the configured webhook ───────────────
-- Callable on its own so an appointment can be re-pushed by hand, and used by
-- the trigger below. Safe to call repeatedly: it no-ops when there is no
-- appointment, no webhook configured, or an event already exists.
create or replace function public.push_invoice_to_calendar(p_id text)
returns text
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_url     text;
  v_secret  text;
  v_minutes int;
  v_inv     record;
  v_desc    text;
  v_title   text;
  v_loc     text;
begin
  select value into v_url     from public.settings where key = 'gcal_webhook_url';
  select value into v_secret  from public.settings where key = 'gcal_webhook_secret';
  select coalesce(nullif(value, '')::int, 90) into v_minutes
    from public.settings where key = 'gcal_default_minutes';

  if coalesce(btrim(v_url), '') = '' then
    return 'skipped: no gcal_webhook_url configured';
  end if;

  select id, client_name, client_info, internal_notes, notes,
         job_address, gcal_date, gcal_event_id, view_token
    into v_inv
    from public.invoices
   where id = p_id;

  if not found then
    return 'skipped: invoice not found';
  end if;
  if v_inv.gcal_date is null or btrim(v_inv.gcal_date) = '' then
    return 'skipped: no appointment on this invoice';
  end if;
  if coalesce(btrim(v_inv.gcal_event_id), '') <> '' then
    return 'skipped: already has a calendar event';
  end if;

  v_title := coalesce(nullif(btrim(v_inv.client_name), ''), 'Job')
             || ' - ' || v_inv.id;

  v_loc := coalesce(v_inv.job_address->>'line1', '');

  -- The description carries the internal notes on purpose: what the caller
  -- said should be readable from the calendar entry on a phone, without
  -- opening the app.
  v_desc := coalesce(v_inv.client_name, '') ||
            coalesce(E'\n' || (v_inv.client_info->>'phone'), '') ||
            coalesce(E'\n' || nullif(v_loc, ''), '') ||
            E'\n\n' || coalesce(nullif(btrim(v_inv.internal_notes), ''), '(no notes)') ||
            E'\n\nEstimate: ' || v_inv.id;

  perform net.http_post(
    url  := v_url,
    body := jsonb_build_object(
              'secret',      v_secret,
              'invoiceId',   v_inv.id,
              'title',       v_title,
              'start',       v_inv.gcal_date,
              'minutes',     v_minutes,
              'description', v_desc,
              'location',    v_loc
            ),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  );

  return 'queued';
end;
$$;

-- ── Trigger: AI leads that arrive with an appointment push automatically ───
-- Scoped to source='ai_lead' INSERTs only. Deliberately not firing on UPDATE
-- of every invoice, which would mass-push the entire existing backlog the
-- first time anything touched a row.
create or replace function public.tg_push_lead_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if NEW.gcal_date is not null and btrim(NEW.gcal_date) <> '' then
      perform public.push_invoice_to_calendar(NEW.id);
    end if;
  exception when others then
    null;  -- a calendar hiccup must never block the estimate
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_push_lead_appointment on public.invoices;
create trigger trg_push_lead_appointment
  after insert on public.invoices
  for each row
  when (NEW.source = 'ai_lead')
  execute function public.tg_push_lead_appointment();

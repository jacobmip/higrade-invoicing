-- 119_calendar_push_once.sql
-- ─── One calendar event per Lisa booking ───────────────────────────────────
--
-- Bug (2026-11-09): Lisa's Yelp booking for Dan (EST1204) put TWO events on
-- the calendar, two seconds apart. Two pushes fire for every Lisa booking:
--   1. trg_push_lead_appointment, AFTER INSERT on the invoice, and
--   2. the explicit push_invoice_to_calendar() call in yelp-booking.js and
--      sms-agent.js, a "belt and braces" for the trigger.
-- The function's only guard is "skip if gcal_event_id is set", but that id is
-- written by the Apps Script callback, which arrives seconds later because
-- pg_net is asynchronous. Both pushes passed the guard and both created.
--
-- The trigger also fired before the line items existed (create_estimate_from_
-- lead inserts the invoice, then its items), so its event was titled
-- "Plumbing" with no SCOPE.
--
-- Fix:
--   * calendar_push_claims: push_invoice_to_calendar() claims the job before
--     posting and skips while a claim younger than 10 minutes is open.
--   * The trigger becomes a DEFERRED constraint trigger, so it fires at
--     commit, after the items are in, and the event carries the real title.
-- Function body is the LIVE definition (pg_get_functiondef, 2026-11-09) plus
-- the claim block. Note: live does not carry migration 102's client_name
-- check, so this keeps live behavior rather than the file in 102.

begin;

create table if not exists public.calendar_push_claims (
  invoice_id text primary key,
  queued_at  timestamptz not null default now()
);
alter table public.calendar_push_claims enable row level security;
-- No policies: only security definer functions touch it.

CREATE OR REPLACE FUNCTION public.push_invoice_to_calendar(p_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'extensions'
AS $function$
declare
  v_url     text;
  v_secret  text;
  v_minutes int;
  v_inv     record;
  v_desc    text;
  v_title   text;
  v_loc     text;
  v_what    text;
  v_scope   text;
  v_kind    text;
  v_color   text;
  v_count   int;
begin
  select value into v_url     from public.settings where key = 'gcal_webhook_url';
  select value into v_secret  from public.settings where key = 'gcal_webhook_secret';
  select coalesce(nullif(value, '')::int, 90) into v_minutes
    from public.settings where key = 'gcal_default_minutes';

  if coalesce(btrim(v_url), '') = '' then
    return 'skipped: no gcal_webhook_url configured';
  end if;

  select id, type, client_name, client_info, internal_notes, notes,
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

  -- One push per job. The Apps Script answers through pg_net, which is
  -- asynchronous, so gcal_event_id stays empty for a few seconds after the
  -- first push. A second push in that gap used to create a second event
  -- (EST1204, 2026-11-09). Claim the job first; skip if a push is in flight.
  -- After 10 minutes with no event id the claim lapses, so a failed push can
  -- still be retried.
  insert into public.calendar_push_claims as c (invoice_id, queued_at)
  values (v_inv.id, now())
  on conflict (invoice_id) do update set queued_at = excluded.queued_at
   where c.queued_at < now() - interval '10 minutes';
  if not found then
    return 'skipped: a calendar push for this job is already in flight';
  end if;

  v_loc := concat_ws(', ',
             nullif(btrim(coalesce(v_inv.job_address->>'line1', '')), ''),
             nullif(btrim(coalesce(v_inv.job_address->>'line2', '')), ''),
             nullif(btrim(coalesce(v_inv.job_address->>'line3', '')), ''));

  select btrim(split_part(coalesce(nullif(btrim(i.name), ''), i.description, ''), E'\n', 1))
    into v_what
    from public.invoice_items i
   where i.invoice_id = v_inv.id
   order by i.sort_order nulls last, i.id
   limit 1;

  v_what := btrim(regexp_replace(coalesce(v_what, ''), '\s[–—-]\s.*$', ''));
  if coalesce(v_what, '') = '' then
    v_what := 'Plumbing';
  elsif length(v_what) > 30 then
    v_what := btrim(left(v_what, 29)) || '…';
  end if;

  select count(*) into v_count
    from public.invoice_items i where i.invoice_id = v_inv.id
     and coalesce(nullif(btrim(i.name), ''), nullif(btrim(i.description), '')) is not null;

  select string_agg('• ' || n, E'\n' order by ord)
    into v_scope
    from (
      select btrim(split_part(coalesce(nullif(btrim(i.name), ''), i.description), E'\n', 1)) as n,
             row_number() over (order by i.sort_order nulls last, i.id) as ord
        from public.invoice_items i
       where i.invoice_id = v_inv.id
         and coalesce(nullif(btrim(i.name), ''), nullif(btrim(i.description), '')) is not null
    ) t
   where ord <= 6;

  if v_count > 6 then
    v_scope := v_scope || E'\n…and ' || (v_count - 6) || ' more';
  end if;

  if coalesce(v_inv.type, 'invoice') = 'estimate' then
    v_kind := 'Estimate'; v_color := '6';
  else
    v_kind := 'Invoice';  v_color := '7';
  end if;

  v_title := concat_ws(' · ',
               v_what,
               coalesce(nullif(btrim(v_inv.client_name), ''), 'Job'),
               nullif(btrim(v_inv.id), ''));

  v_desc := concat_ws(E'\n\n',
              nullif(concat_ws(E'\n',
                nullif(btrim(coalesce(v_inv.client_name, '')), ''),
                nullif(btrim(coalesce(v_inv.client_info->>'phone', '')), ''),
                nullif(v_loc, '')
              ), ''),
              nullif(case when v_scope is null then '' else 'SCOPE' || E'\n' || v_scope end, ''),
              nullif(btrim(coalesce(v_inv.internal_notes, '')), ''),
              v_kind || ' ' || v_inv.id);

  perform net.http_post(
    url  := v_url,
    body := jsonb_build_object(
              'secret',      v_secret,
              'invoiceId',   v_inv.id,
              'title',       v_title,
              'start',       to_char(v_inv.gcal_date::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
              'timezone',    'Pacific/Honolulu',
              'minutes',     v_minutes,
              'description', v_desc,
              'location',    v_loc,
              'colorId',     v_color
            ),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  );

  return 'queued';
end;
$function$;

drop trigger if exists trg_push_lead_appointment on public.invoices;
create constraint trigger trg_push_lead_appointment
  after insert on public.invoices
  deferrable initially deferred
  for each row
  when (NEW.source = 'ai_lead')
  execute function public.tg_push_lead_appointment();

commit;

notify pgrst, 'reload schema';

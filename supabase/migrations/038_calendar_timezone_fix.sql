-- 038_calendar_timezone_fix.sql
-- ─── Stop a 1pm job booking at 3am ──────────────────────────────────────────
--
-- The first AI-booked appointment (EST0807) stored as '2026-09-01 13:00:00+00'
-- — 1pm UTC, which is 3am Hawaii. Lisa had correctly passed 1pm Hawaii time.
-- The database timezone is UTC, so create_estimate_from_lead's
-- `p_appointment::timestamptz` cast reinterpreted a local wall-clock time as
-- UTC and shifted it ten hours.
--
-- It was invisible in the app, which is why it survived this long. App.jsx
-- renders gcal_date by SLICING CHARACTERS out of the string:
--     invoice.gcalDate.slice(0, 10)    -> '2026-09-01'
--     invoice.gcalDate.slice(11, 16)   -> '13:00'
-- Both '2026-09-01T13:00' and '2026-09-01 13:00:00+00' slice to the same
-- display, so the schedule looked right while the underlying value was wrong
-- by ten hours. It would only have surfaced as a customer standing in their
-- driveway at 3am.
--
-- Fixed at the point of push rather than at the point of write. Writing is not
-- a single path: save_invoice_with_items ALSO casts gcal_date to timestamptz,
-- so any normalisation done in create_estimate_from_lead gets silently undone
-- the next time the invoice is saved in the app. Verified that behaviour after
-- an earlier attempt at a source-side fix reverted on its own.
--
-- Casting to plain ::timestamp discards the misleading offset and yields the
-- intended local wall-clock time from either shape, and the payload now names
-- the zone explicitly so the receiving script cannot assume UTC.
--
-- Also backfills existing rows to the app's own naive format.

update public.invoices
   set gcal_date = to_char(gcal_date::timestamp, 'YYYY-MM-DD"T"HH24:MI')
 where gcal_date is not null
   and gcal_date <> ''
   and gcal_date !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$';

create or replace function public.push_invoice_to_calendar(p_id text)
returns text
language plpgsql
security definer
set search_path = public, net, extensions
as $function$
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
              -- ::timestamp, NOT ::timestamptz. See the header.
              'start',       to_char(v_inv.gcal_date::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
              'timezone',    'Pacific/Honolulu',
              'minutes',     v_minutes,
              'description', v_desc,
              'location',    v_loc
            ),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  );

  return 'queued';
end;
$function$;

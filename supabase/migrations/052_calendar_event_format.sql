-- 052_calendar_event_format.sql
-- ─── Bring the server's calendar event in line with the app's ────────────────
--
-- push_invoice_to_calendar() is the server-side twin of buildCalendarEvent()
-- in src/App.jsx. It is what fires when Lisa the AI receptionist books a lead,
-- so an appointment has always had two possible authors — and until now they
-- wrote two different events. Same job, different title, different body,
-- depending on who happened to book it.
--
-- This aligns the server with the app and fixes three bugs on the way.
--
-- ── 1. The location field only ever got line1 ───────────────────────────────
-- job_address holds line1 (street), line2 (unit) and line3 ("City ST Zip").
-- Only line1 reached Google, so tapping the event for directions dropped the
-- unit and the city. Right street number, potentially the wrong block.
--
-- ── 2. Every document was labelled "Estimate" ───────────────────────────────
-- The body ended with a hardcoded 'Estimate: ' || id regardless of what the
-- document actually was, so invoices pushed from the server read as estimates.
-- Reads invoices.type now.
--
-- ── 3. The title never said what the work was ───────────────────────────────
-- "Mike Johnson - EST0807" tells you nothing you can plan a day around. The
-- first line item's name now leads, matching the app:
--
--     Water Heater · Mike Johnson · EST0807
--
-- The job site is deliberately NOT in the title. It belongs in the location
-- field, where Google makes it tappable, and a second copy would only eat the
-- characters the work description needs.
--
-- The description gains a SCOPE block of line-item NAMES — not the per-item
-- description, which is the customer-facing scope of work and far too long for
-- a calendar entry.
--
-- ── colorId ────────────────────────────────────────────────────────────────
-- The payload now carries a Google palette id so a booking is coloured by kind
-- (6 Tangerine = estimate, 7 Peacock = job). The Apps Script behind
-- settings.gcal_webhook_url has to read it for this half to do anything:
--
--     if (p.colorId) event.setColor(p.colorId);
--
-- Until that line is added the field is simply ignored, so this migration is
-- safe to apply on its own.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

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

  -- The whole job site, not just the street line. concat_ws skips nulls, and
  -- nullif turns the empty strings into nulls so no stray ", " survives.
  v_loc := concat_ws(', ',
             nullif(btrim(coalesce(v_inv.job_address->>'line1', '')), ''),
             nullif(btrim(coalesce(v_inv.job_address->>'line2', '')), ''),
             nullif(btrim(coalesce(v_inv.job_address->>'line3', '')), ''));

  -- What the work is: the first line item's name. The app prefers a visit
  -- label, but a server-side push has no visits yet, so the item is all there
  -- is — and it is the same fallback the app uses when a label is blank.
  select btrim(split_part(coalesce(nullif(btrim(i.name), ''), i.description, ''), E'\n', 1))
    into v_what
    from public.invoice_items i
   where i.invoice_id = v_inv.id
   order by i.sort_order nulls last, i.id
   limit 1;

  -- Item names carry their spec after a dash ("Water Heater Replacement –
  -- Electric 40gal"). Cut there, then cap at 30 to match CAL_WHAT_MAX.
  v_what := btrim(regexp_replace(coalesce(v_what, ''), '\s[–—-]\s.*$', ''));
  if coalesce(v_what, '') = '' then
    v_what := 'Plumbing';
  elsif length(v_what) > 30 then
    v_what := btrim(left(v_what, 29)) || '…';
  end if;

  -- SCOPE: line-item NAMES, six of them, then a count of the rest.
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

  -- Estimate or job, which is both the body's label and the event's colour.
  if coalesce(v_inv.type, 'invoice') = 'estimate' then
    v_kind := 'Estimate'; v_color := '6';   -- Tangerine
  else
    v_kind := 'Invoice';  v_color := '7';   -- Peacock
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
              -- ::timestamp, NOT ::timestamptz. See migration 038's header:
              -- gcal_date is TEXT and carries no real offset, so casting it as
              -- timestamptz stamps it UTC and the job lands ten hours out.
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

comment on function public.push_invoice_to_calendar(text) is
  'Server-side twin of buildCalendarEvent() in src/App.jsx. Title "Work · Client · ID", full job site in location, line-item names as SCOPE in the body. Change one side and change the other, or a booking reads differently depending on whether Lisa or the app made it.';

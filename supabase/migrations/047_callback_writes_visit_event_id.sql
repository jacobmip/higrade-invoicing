-- 047_callback_writes_visit_event_id.sql
-- ─── Make the calendar callback survive the sync_first_visit trigger ───────
--
-- set_invoice_gcal_event() is what the receptionist's Apps Script calls back
-- with the id of the event it just created. It wrote invoices.gcal_event_id
-- directly — and that column is derived, not authoritative.
--
-- invoices_sync_first_visit is a BEFORE INSERT OR UPDATE trigger that rewrites
-- gcal_date, gcal_event_id and gcal_duration_minutes from the earliest entry in
-- invoices.visits on every single update. So the callback's write was undone in
-- the same statement, silently, whenever the invoice had a visits array:
--
--   update invoices set gcal_event_id = 'abc' where id = ...
--     → trigger: new.gcal_event_id := visits[0].eventId  → null
--
-- Verified 2026-09-03: pushing ZZ-TEST-NEW-LAYOUT created the Google event
-- (Apps Script returned {"ok":true,"eventId":"..."}) and the row still read
-- gcal_event_id = null afterwards, with updated_at untouched from Aug 25.
--
-- Every invoice that DOES have an id got it from the app writing visits, never
-- from this callback. Two consequences, both live until now:
--   1. The app cannot move or cancel a job Lisa books, because it never learns
--      the event id.
--   2. push_invoice_to_calendar() skips only invoices that already have an
--      event id, so re-pushing one of these creates a DUPLICATE event.
--
-- Fix: write the id into the visit the trigger derives from, so the trigger
-- propagates it to the flat column instead of erasing it. This respects the
-- documented rule that visits is the source of truth and gcal_* are derived.
-- The flat column is still set directly for invoices with no visits at all.

create or replace function public.set_invoice_gcal_event(
  p_secret   text,
  p_id       text,
  p_event_id text
) returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_secret text;
  v_event  text := nullif(btrim(coalesce(p_event_id, '')), '');
  v_visits jsonb;
  v_idx    int;
begin
  select value into v_secret from public.settings where key = 'gcal_webhook_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing calendar webhook secret';
  end if;

  select visits into v_visits from public.invoices where id = p_id;

  if v_visits is not null
     and jsonb_typeof(v_visits) = 'array'
     and jsonb_array_length(v_visits) > 0 then

    -- Same selection sync_first_visit() uses: earliest visit that has a start.
    -- Picking a different one would leave the trigger deriving from a visit
    -- that still has a null eventId, which is the bug all over again.
    select ord - 1 into v_idx
      from jsonb_array_elements(v_visits) with ordinality as t(e, ord)
     where coalesce(btrim(e->>'start'), '') <> ''
     order by e->>'start'
     limit 1;

    if v_idx is not null then
      -- coalesce guards the null case: jsonb_set with a SQL NULL new value
      -- returns NULL for the whole document, which would wipe every visit.
      v_visits := jsonb_set(
        v_visits,
        array[v_idx::text, 'eventId'],
        coalesce(to_jsonb(v_event), 'null'::jsonb),
        true
      );
      update public.invoices
         set visits = v_visits, gcal_event_id = v_event
       where id = p_id;
      return;
    end if;
  end if;

  update public.invoices set gcal_event_id = v_event where id = p_id;
end;
$function$;

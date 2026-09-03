-- 048_gcal_date_stop_utc_stamping.sql
-- ─── Stop save_invoice_with_items stamping gcal_date as UTC ────────────────
--
-- Reported as "Lisa took my call and thinks it's 8 o'clock in the morning".
--
-- invoices.gcal_date is TEXT holding a LOCAL wall-clock time (YYYY-MM-DDTHH:MM,
-- Hawaii). save_invoice_with_items took the app's correct '2026-09-02T18:00'
-- and wrote `nullif(inv->>'gcal_date','')::timestamptz`. The database runs UTC,
-- so that reads 18:00 as 18:00 UTC and stores back '2026-09-02 18:00:00+00'.
-- 18:00 UTC is 08:00 Hawaii, so a 6pm job reads as 8am to anything that parses
-- the value honestly — JavaScript's `new Date()`, or `at time zone
-- 'Pacific/Honolulu'`. Verified on EST1015: Lisa correctly filed 18:00 for
-- "tonight" and the row came back '2026-09-02 18:00:00+00'.
--
-- It hid for so long because the three loudest consumers all happened to be
-- immune, each for a different reason:
--   - the lead email does to_char(...::timestamptz) with the session in UTC,
--     which cancels the error back out and prints 06:00 PM
--   - push_invoice_to_calendar (migration 038) casts ::timestamp, discarding
--     the bogus offset, and sends Pacific/Honolulu explicitly
--   - App.jsx renders by SLICING characters, so it shows "18:00" either way
-- Migration 038 patched the calendar push rather than the write, and noted a
-- source-side fix "reverting on its own when save_invoice_with_items ran".
-- This is that write. Fixing it here is what stops the revert.
--
-- create_estimate_from_lead already writes the canonical format, so Lisa was
-- never the problem — the app overwrote her value on the next save.
--
-- The function is patched in place from pg_get_functiondef rather than
-- restated in full. It is 6.5k characters of unrelated upsert logic and
-- retyping it here would risk silently drifting from what is deployed. The
-- block asserts it changed exactly one call site and no-ops if already applied.

do $mig$
declare
  d text;
  n int;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'save_invoice_with_items';

  if d is null then
    raise exception 'save_invoice_with_items not found';
  end if;

  select count(*) into n
    from regexp_matches(d, 'nullif\(inv->>''gcal_date'', ''''\)::timestamptz', 'g');

  if n = 0 then
    raise notice '048: gcal_date cast already patched, nothing to do';
    return;
  end if;

  if n <> 1 then
    raise exception '048: expected exactly 1 gcal_date timestamptz cast, found %', n;
  end if;

  -- ::timestamp, not ::timestamptz. Plain timestamp discards any offset that
  -- is already on the value instead of shifting the clock by it, and to_char
  -- writes back the same wall-clock text the app sent.
  d := replace(
         d,
         'nullif(inv->>''gcal_date'', '''')::timestamptz',
         'to_char(nullif(inv->>''gcal_date'', '''')::timestamp, ''YYYY-MM-DD"T"HH24:MI'')'
       );

  execute d;
  raise notice '048: save_invoice_with_items patched';
end
$mig$;

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Normalising preserves the displayed wall clock everywhere. Every consumer
-- above already showed 18:00 / 6pm for '2026-09-02 18:00:00+00', so nothing
-- moves on the calendar or in the UI; the value just stops being ambiguous.

-- visits first: invoices_sync_first_visit derives gcal_date from visits[0], so
-- normalising visits fixes gcal_date for those rows as a side effect. Doing it
-- the other way round would have the trigger overwrite the fix immediately.
update public.invoices i
   set visits = (
     select jsonb_agg(
              case
                when coalesce(e->>'start', '') = '' then e
                else jsonb_set(e, '{start}',
                       to_jsonb(to_char((e->>'start')::timestamp, 'YYYY-MM-DD"T"HH24:MI')))
              end
              order by ord
            )
       from jsonb_array_elements(i.visits) with ordinality as t(e, ord)
   )
 where i.visits is not null
   and jsonb_typeof(i.visits) = 'array'
   and jsonb_array_length(i.visits) > 0
   and exists (
     select 1 from jsonb_array_elements(i.visits) e
      where coalesce(e->>'start', '') <> ''
        and e->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
   );

-- then any remaining rows, i.e. the ones with no visits at all.
update public.invoices
   set gcal_date = to_char(gcal_date::timestamp, 'YYYY-MM-DD"T"HH24:MI')
 where gcal_date is not null
   and btrim(gcal_date) <> ''
   and gcal_date !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$';

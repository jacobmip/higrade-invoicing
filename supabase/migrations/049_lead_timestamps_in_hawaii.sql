-- 049_lead_timestamps_in_hawaii.sql
-- ─── Lead timestamps are Hawaii time, not UTC ──────────────────────────────
--
-- Reported as "the internal notes said September 3rd at 8:07 a.m." for a call
-- that actually came in at 10:07 PM on September 2nd.
--
-- The database session runs UTC, and `now()` / `current_date` render in the
-- session timezone. Hawaii is UTC-10, so for the ten hours between 2pm and
-- midnight local — which is when an after-hours receptionist earns its keep —
-- every one of these was a day and ten hours out:
--
--   header    to_char(now(), 'Mon DD, HH12:MI AM')  → "Sep 03, 08:07 AM"
--                                          should be → "Sep 02, 10:07 PM"
--   date      current_date                          → 2026-09-03
--                                          should be → 2026-09-02
--   year      extract(year from current_date)       → wrong on Dec 31 evening
--
-- All 10 existing ai_lead rows carry the wrong date for this reason. The
-- historical rows are NOT rewritten here: `date` is the document date on an
-- estimate, and changing it retroactively is a business-record edit, not a
-- schema fix. Do that deliberately if wanted.
--
-- Distinct from migration 048. That one fixed the APPOINTMENT time being
-- restamped as UTC on write. This one fixes the CALL time and the document
-- date being rendered in UTC. Same root cause — a UTC database serving a
-- Hawaii business — different code paths.
--
-- Patched in place from pg_get_functiondef rather than restated, for the same
-- reason as 048: the function is long and mostly unrelated, and retyping it
-- risks drifting from what is deployed. Every replacement is asserted.

do $mig$
declare
  d text;
  n_now  int;
  n_date int;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'create_estimate_from_lead';

  if d is null then
    raise exception 'create_estimate_from_lead not found';
  end if;

  select count(*) into n_now  from regexp_matches(d, 'to_char\(now\(\), ''Mon DD, HH12:MI AM''\)', 'g');
  select count(*) into n_date from regexp_matches(d, 'current_date', 'g');

  if n_now = 0 and d like '%Pacific/Honolulu%' then
    raise notice '049: already patched, nothing to do';
    return;
  end if;

  if n_now <> 1 then
    raise exception '049: expected exactly 1 to_char(now()) header, found %', n_now;
  end if;
  if n_date <> 2 then
    raise exception '049: expected exactly 2 current_date uses, found %', n_date;
  end if;

  d := replace(
         d,
         'to_char(now(), ''Mon DD, HH12:MI AM'')',
         'to_char(now() at time zone ''Pacific/Honolulu'', ''Mon DD, HH12:MI AM'')'
       );

  -- Both uses are the document date and the year derived from it. Neither
  -- should follow the server's clock.
  d := replace(d, 'current_date', '(now() at time zone ''Pacific/Honolulu'')::date');

  execute d;
  raise notice '049: create_estimate_from_lead patched';
end
$mig$;

-- notify_owner_of_lead renders the requested time with ::timestamptz. Since
-- migration 048 normalised gcal_date to offset-free local text, that happens to
-- come out right — the UTC session cancels the UTC reading. It is only correct
-- by coincidence, and would break the moment the session timezone changed.
-- ::timestamp says what is actually meant: this text is already local.
do $mig$
declare
  d text;
  n int;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'notify_owner_of_lead';

  if d is null then
    raise exception 'notify_owner_of_lead not found';
  end if;

  select count(*) into n from regexp_matches(d, 'NEW\.gcal_date::timestamptz', 'g');

  if n = 0 then
    raise notice '049: notify_owner_of_lead already patched';
    return;
  end if;
  if n <> 1 then
    raise exception '049: expected exactly 1 gcal_date cast, found %', n;
  end if;

  d := replace(d, 'NEW.gcal_date::timestamptz', 'NEW.gcal_date::timestamp');
  execute d;
  raise notice '049: notify_owner_of_lead patched';
end
$mig$;

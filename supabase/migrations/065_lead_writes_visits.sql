-- 065_lead_writes_visits.sql
-- ─── Lisa's bookings get a real visit ───────────────────────────────────────
--
-- create_estimate_from_lead() stored an appointment in gcal_date only. Since
-- migration 044, invoices.visits is the source of truth and gcal_date is
-- derived from it, and everything newer reads visits: the app's calendar sync,
-- the Telegram manager bot, the AI chat agent. So a job Lisa booked was
-- invisible to the bot and could not be moved in the app until someone opened
-- it and re-saved the schedule.
--
-- Now the insert writes a one-entry visits array alongside it, in the same
-- shape the app writes: { id, start, minutes, label, kind, eventId }. No
-- builtBy, since the app did not build the event; that keeps the app from
-- rewriting the caller's notes in the Google description on a reschedule.
--
-- It goes in the INSERT itself, not a follow-up UPDATE, because:
--   - trg_push_lead_appointment (033) is AFTER INSERT and reads gcal_date,
--     which invoices_sync_first_visit (044, BEFORE) now derives from the
--     visit. Same value as before, so the Google push is unchanged.
--   - set_invoice_gcal_event (047) already writes the returned Google event
--     id into the earliest visit, so the link lands where the app looks.
--   - an UPDATE would be a second write for every other trigger to react to.
--
-- ─── Two regressions restored while the function is open ───────────────────
--
-- 062 and 063 were written from an old copy of this function instead of its
-- live definition, which is exactly what CLAUDE.md warns against. If that copy
-- is what is live, it silently undid two earlier fixes:
--
--   049  Hawaii time. to_char(now()) and current_date render UTC, so a call
--        after 2pm local is dated tomorrow, and the notes header is 10 hours
--        out. Re-applied exactly the way 049 did it.
--   060  Shared numbering. The function minted from next_estimate_num and
--        checked only for a free EST id, not the paired INV id, and never
--        advanced next_doc_num. Now it draws from allocate_doc_number(), the
--        locked allocator every other writer uses.
--
-- Each of those two is applied only if the old text is found, so this is safe
-- to run against a live function that already has them. The visits change is
-- required: if its anchors are not found exactly once, nothing is changed.
--
-- Patched from pg_get_functiondef, never from a file, per the 041 pattern.
--
-- Run in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

do $outer$
declare
  d      text;
  n      int;
  before text;
  after  text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'create_estimate_from_lead';
  if d is null then
    raise exception '065: create_estimate_from_lead not found';
  end if;

  if d like '%The same appointment as a visit%' then
    raise exception '065: already applied (the insert already writes a visit)';
  end if;

  -- ── 1. visits in the insert (required) ──────────────────────────────────
  before := 'job_address, gcal_date, year,';
  select count(*) into n from regexp_matches(d, 'job_address, gcal_date, year,', 'g');
  if n <> 1 then
    raise exception '065: expected the insert column list once, found % - nothing changed', n;
  end if;
  d := replace(d, before, 'job_address, gcal_date, visits, year,');

  before := '         then trim(p_appointment) else null end,';
  select count(*) into n from regexp_matches(d, 'then trim\(p_appointment\) else null end,', 'g');
  if n <> 1 then
    raise exception '065: expected the gcal_date value once, found % - nothing changed', n;
  end if;
  after :=
'         then trim(p_appointment) else null end,
    -- The same appointment as a visit, the source of truth since 044.
    case when nullif(trim(coalesce(p_appointment, '''')), '''')
              ~ ''^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$''
         then jsonb_build_array(jsonb_build_object(
                ''id'',      ''v_'' || substr(md5(v_id || trim(p_appointment)), 1, 8),
                ''start'',   trim(p_appointment),
                ''minutes'', coalesce((select nullif(value, '''')::int from public.settings
                                       where key = ''gcal_default_minutes''), 90),
                ''label'',   '''',
                ''kind'',    ''estimate'',
                ''eventId'', null))
         else null end,';
  d := replace(d, before, after);

  -- ── 2. Hawaii time, as 049 (only if missing) ────────────────────────────
  if d not like '%Pacific/Honolulu%' then
    select count(*) into n from regexp_matches(d, 'to_char\(now\(\), ''Mon DD, HH12:MI AM''\)', 'g');
    if n <> 1 then
      raise exception '065: expected 1 to_char(now()) header, found % - nothing changed', n;
    end if;
    select count(*) into n from regexp_matches(d, 'current_date', 'g');
    if n <> 2 then
      raise exception '065: expected 2 current_date uses, found % - nothing changed', n;
    end if;
    d := replace(d,
           'to_char(now(), ''Mon DD, HH12:MI AM'')',
           'to_char(now() at time zone ''Pacific/Honolulu'', ''Mon DD, HH12:MI AM'')');
    d := replace(d, 'current_date', '(now() at time zone ''Pacific/Honolulu'')::date');
  end if;

  -- ── 3. Shared numbering via allocate_doc_number() (only if old block) ───
  before :=
'  select max((regexp_replace(id, ''\D'', '''', ''g''))::int) into v_max
    from public.invoices
   where type = ''estimate'' and id ~ ''^EST[0-9]+$'';
  select nullif(value, '''')::int into v_persisted
    from public.settings where key = ''next_estimate_num'';
  v_num := greatest(coalesce(v_persisted, 1), coalesce(v_max, 0) + 1, 712);
  loop
    v_id := ''EST'' || lpad(v_num::text, 4, ''0'');
    exit when not exists (select 1 from public.invoices where id = v_id);
    v_num := v_num + 1;
  end loop;';
  if position(before in d) > 0 then
    d := replace(d, before,
'  -- One shared EST/INV sequence (040), drawn under a row lock (060), so
  -- EST1000 can always convert to INV1000.
  v_num := public.allocate_doc_number();
  v_id  := ''EST'' || lpad(v_num::text, 4, ''0'');');

    before :=
'  insert into public.settings (key, value)
  values (''next_estimate_num'', (v_num + 1)::text)
  on conflict (key) do update set value = excluded.value;';
    if position(before in d) = 0 then
      raise exception '065: numbering block found but its counter write was not - nothing changed';
    end if;
    -- allocate_doc_number() already advanced the counter.
    d := replace(d, before, '');
  end if;

  execute d;
end $outer$;

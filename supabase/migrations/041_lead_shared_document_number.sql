-- 041_lead_shared_document_number.sql
-- ─── Put the AI receptionist on the shared document counter ─────────────────
--
-- Migration 040 replaced the two independent sequences with one shared
-- counter, so a number identifies the JOB and EST1000 converts to INV1000.
-- Its header notes that next_estimate_num and next_num are retired and that
-- "nothing mints from them any more".
--
-- create_estimate_from_lead did. It was written before 040 and kept minting
-- from next_estimate_num, which sat at 808.
--
-- That was not cosmetic. INV0808 already exists, and 52 more legacy invoices
-- sit between 808 and 999. The very next call Lisa took would have created
-- EST0808 alongside the unrelated INV0808, reissuing a number that is already
-- printed on a customer's invoice and breaking the one invariant 040 exists to
-- protect. The next 52 leads would each have done the same.
--
-- Two changes:
--   1. Allocate from next_doc_num, and scan for collisions across BOTH
--      prefixes rather than estimates alone. Checking only EST#### is what
--      let an existing INV#### go unnoticed.
--   2. Advance the shared counter via bump_doc_num(), which only ever moves
--      forward, instead of writing next_estimate_num.
--
-- Everything else about the function is untouched. It was rebuilt from its own
-- live definition with two targeted replacements, each asserted to match
-- before applying, because the live function carries fixes from 030 and 038
-- that a wholesale rewrite would silently drop.
--
-- Verified in a rolled-back transaction: a fresh lead allocated EST1001 with
-- no colliding INV1001, next_doc_num advanced to 1002, and next_estimate_num
-- was left untouched at 808 as 040 intends.

do $outer$
declare v_def text; v_before text; v_after text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_estimate_from_lead';

  v_before :=
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

  v_after :=
'  -- Shared estimate/invoice sequence (migration 040): the number identifies
  -- the JOB, so EST1000 converts to INV1000. Minting from the old
  -- next_estimate_num would have reissued numbers already held by legacy
  -- invoices -- INV0808 exists and 52 more sit between 808 and 999.
  select max((regexp_replace(id, ''\D'', '''', ''g''))::int) into v_max
    from public.invoices
   where id ~ ''^(EST|INV)[0-9]+$'';
  select nullif(value, '''')::int into v_persisted
    from public.settings where key = ''next_doc_num'';
  v_num := greatest(coalesce(v_persisted, 1000), coalesce(v_max, 0) + 1, 1000);
  loop
    v_id := ''EST'' || lpad(v_num::text, 4, ''0'');
    exit when not exists (
      select 1 from public.invoices
       where id in (v_id, ''INV'' || lpad(v_num::text, 4, ''0''))
    );
    v_num := v_num + 1;
  end loop;';

  if position(v_before in v_def) = 0 then
    raise exception 'numbering block did not match - aborting rather than guessing';
  end if;
  v_def := replace(v_def, v_before, v_after);

  v_before :=
'  insert into public.settings (key, value)
  values (''next_estimate_num'', (v_num + 1)::text)
  on conflict (key) do update set value = excluded.value;';
  v_after :=
'  perform public.bump_doc_num(v_num + 1);';

  if position(v_before in v_def) = 0 then
    raise exception 'counter bump block did not match - aborting rather than guessing';
  end if;
  v_def := replace(v_def, v_before, v_after);

  execute v_def;
end $outer$;

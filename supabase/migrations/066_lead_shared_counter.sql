-- 066_lead_shared_counter.sql
-- ─── Put Lisa back on the shared document counter ──────────────────────────
--
-- 065 was meant to do this and skipped it: its exact-text match on the old
-- numbering block did not hit the live definition, most likely on whitespace,
-- so it took the "already fixed" path. Checked afterwards on the live
-- function (2026-10-27): it still mints from next_estimate_num, checks only
-- for a free EST id and never advances next_doc_num.
--
-- This finds the same block by its first and last lines instead of its full
-- text: from `select max((regexp_replace(id` to the first `end loop;`, which
-- is the numbering loop (the price book loop comes later). It must match
-- exactly once and must contain next_estimate_num, or nothing changes.
--
-- After it, every estimate Lisa files draws from allocate_doc_number() (060),
-- the locked allocator the app uses, so EST1000 can always become INV1000.
--
-- Run in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

do $outer$
declare
  d     text;
  n     int;
  blk   text;
  ins   text;
  re_blk constant text := '  select max\(\(regexp_replace\(id.*?end loop;';
  re_ins constant text := '  insert into public\.settings \(key, value\)\s+values \(''next_estimate_num''.*?excluded\.value;';
begin
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'create_estimate_from_lead';
  if n <> 1 then
    raise exception '066: expected 1 create_estimate_from_lead, found % - nothing changed', n;
  end if;

  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'create_estimate_from_lead';

  if d like '%allocate_doc_number()%' then
    raise exception '066: already on allocate_doc_number() - nothing to do';
  end if;

  -- The numbering block.
  select count(*) into n from regexp_matches(d, re_blk, 'g');
  if n <> 1 then
    raise exception '066: expected the numbering block once, found % - nothing changed', n;
  end if;
  blk := substring(d from re_blk);
  if blk not like '%next_estimate_num%' or blk not like '%v_num := v_num + 1;%' then
    raise exception '066: numbering block is not the expected shape - nothing changed: %', blk;
  end if;
  d := replace(d, blk,
'  -- One shared EST/INV sequence (040), drawn under a row lock (060), so
  -- EST1000 can always convert to INV1000.
  v_num := public.allocate_doc_number();
  v_id  := ''EST'' || lpad(v_num::text, 4, ''0'');');

  -- The old counter write. allocate_doc_number() already advanced the counter.
  select count(*) into n from regexp_matches(d, re_ins, 'g');
  if n <> 1 then
    raise exception '066: expected the next_estimate_num write once, found % - nothing changed', n;
  end if;
  ins := substring(d from re_ins);
  d := replace(d, ins, '');

  if d like '%next_estimate_num%' then
    raise exception '066: next_estimate_num still referenced after the patch - nothing changed';
  end if;

  execute d;
end $outer$;

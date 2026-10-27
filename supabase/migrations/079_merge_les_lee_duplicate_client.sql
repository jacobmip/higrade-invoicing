-- 079_merge_les_lee_duplicate_client.sql
--
-- Les Lee was filed twice: the real client row (7a188e28, address on file,
-- EST1068 already pointing at it) and a "Missed call - no name given" row
-- (bfe6491a) that Lisa's missed-call capture made first and that the caller's
-- three follow-up texts then attached to. Move everything on the junk row to
-- the real one and delete the junk row.
--
-- Checked live before writing: the junk row has 3 client_messages and nothing
-- else (no invoices, versions, call_queue or drafts). Every other referrer is
-- still re-pointed so the delete cannot orphan or cascade anything if a new
-- row landed in between. Safe to re-run: a missing junk row is a no-op.

begin;

do $$
declare
  v_real uuid := '7a188e28-3762-4c17-aa6d-b0afd5397e76';
  v_junk uuid := 'bfe6491a-3989-4d41-b3d7-ad678da4cf87';
  v_junk_row public.clients%rowtype;
begin
  if not exists (select 1 from public.clients where id = v_real) then
    raise exception 'real Les Lee row % not found; aborting', v_real;
  end if;

  select * into v_junk_row from public.clients where id = v_junk;
  if not found then
    raise notice 'junk row % already gone; nothing to do', v_junk;
    return;
  end if;

  -- Guard: only ever delete the placeholder, never a client with contact data.
  if v_junk_row.name !~* '^missed call' or v_junk_row.email is not null or v_junk_row.phone is not null then
    raise exception 'row % does not look like the junk placeholder (name=%); aborting', v_junk, v_junk_row.name;
  end if;

  update public.client_messages set client_id = v_real where client_id = v_junk;
  update public.call_queue      set client_id = v_real where client_id = v_junk;
  update public.invoice_drafts  set client_id = v_real where client_id = v_junk;
  if exists (select 1 from public.invoices where client_id = v_junk) then
    update public.invoices set client_id = v_real where client_id = v_junk;
  end if;
  -- client_versions would cascade-delete with the junk row; keep any history.
  update public.client_versions set client_id = v_real where client_id = v_junk;

  delete from public.clients where id = v_junk;
end $$;

commit;

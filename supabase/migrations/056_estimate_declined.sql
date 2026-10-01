-- 056_estimate_declined.sql
--
-- Two things, both so the follow-up briefing stops chasing dead estimates.
--
-- 1. A declined estimate. Until now the only way to stop a follow-up was to
--    type a hold phrase into the notes, which the briefing script grepped for.
--    Jake knows when a customer has said no, and that belongs in the record.
--
-- 2. estimate_valid_days, the shared definition of "went cold". An estimate is
--    good for 30 days. Past that it is not a thing to nudge, it is a thing to
--    redo or reprice. The app and scripts/invoice_followup.py in the AI-OS repo
--    both read this setting so they can never disagree about it.
--
-- declined_at / declined_reason are deliberately NOT added to
-- save_invoice_with_items. That function enumerates its columns and overwrites
-- every one of them on each save, which is exactly how owner_id ends up
-- restamped to whoever saved last (see migration 053). A narrow RPC that
-- touches only these three fields cannot be clobbered by an ordinary edit.

alter table public.invoices add column if not exists declined_at     timestamptz;
alter table public.invoices add column if not exists declined_reason text;

create index if not exists invoices_declined_idx
  on public.invoices (type, status) where declined_at is not null;

insert into public.settings (key, value) values ('estimate_valid_days', '30')
on conflict (key) do nothing;

-- Mark an estimate declined, or put it back in play. Returns the new
-- updated_at so the client can keep its optimistic-lock token coherent.
create or replace function public.set_estimate_declined(
  p_id       text,
  p_declined boolean,
  p_reason   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_type   text;
  row_conv   text;
  new_status text;
  new_stamp  timestamptz;
begin
  select type, converted_to_id into row_type, row_conv
    from public.invoices where id = p_id and deleted_at is null;

  if row_type is null then
    raise exception 'NOT_FOUND: no estimate %', p_id;
  end if;
  if row_type <> 'estimate' then
    raise exception 'INVALID_INPUT: % is an invoice, not an estimate', p_id;
  end if;
  -- A converted estimate is sold work. Declining it would hide a real job.
  if p_declined and row_conv is not null then
    raise exception 'INVALID_INPUT: % was already converted to %', p_id, row_conv;
  end if;

  -- 'outstanding' is what the app gives a new estimate, so that is what an
  -- estimate goes back to when Jake un-declines it.
  new_status := case when p_declined then 'declined' else 'outstanding' end;

  update public.invoices set
    status          = new_status,
    declined_at     = case when p_declined then now() else null end,
    declined_reason = case when p_declined then nullif(trim(coalesce(p_reason, '')), '') else null end,
    updated_at      = now()
  where id = p_id
  returning updated_at into new_stamp;

  return jsonb_build_object('id', p_id, 'status', new_status, 'updated_at', new_stamp);
end;
$$;

revoke all on function public.set_estimate_declined(text, boolean, text) from public;
grant execute on function public.set_estimate_declined(text, boolean, text) to authenticated;

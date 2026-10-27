-- 071_competency_self_assessment.sql
--
-- Let an apprentice fill out his own skill sheet without letting him sign
-- himself off.
--
-- Migration 054 made tech_competencies admin-write-only, and its comment gave
-- the reason: "self-assessment would make the graduation gate meaningless."
-- That reason still holds, so `level` is untouched here — it stays the single
-- authority, set only by the owner, and the graduation math keeps reading it.
--
-- What is added is a second, separate number: `self_level`, the apprentice's
-- own claim. It is useful precisely because it can disagree with the
-- sign-off. A gap in either direction is a conversation worth having:
--   he claims Solo, signed at Assisted  -> he thinks he is ready, check him
--   signed at Solo, he claims Watched   -> he has no idea he is trusted yet
--
-- COLUMN-LEVEL ENFORCEMENT IS A TRIGGER, NOT A POLICY, AND NOT A GRANT.
-- RLS cannot restrict which columns an UPDATE touches. Column GRANTs can, but
-- they are per-role, and the owner is the same `authenticated` role as the
-- apprentice — revoking table UPDATE to grant the self columns would also stop
-- the owner writing `level`. A BEFORE UPDATE trigger is the only mechanism
-- here that can say "this caller may move that number and not this one".

begin;

-- ── 1. The apprentice's own claim ──────────────────────────────────────────
alter table public.tech_competencies
  add column if not exists self_level       smallint,
  add column if not exists self_note        text,
  add column if not exists self_updated_at  timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tech_competencies_self_level_check') then
    alter table public.tech_competencies
      add constraint tech_competencies_self_level_check
      check (self_level is null or self_level between 0 and 4);
  end if;
end $$;

comment on column public.tech_competencies.self_level is
  'The tech''s own claim, 0-4, writable only by that tech. NULL means they '
  'have not rated it. Never feeds the graduation gate — `level` is the only '
  'authority and only an admin may set it (migrations 054, 071).';

-- ── 2. A tech may keep his own sheet ───────────────────────────────────────
-- Additive. The existing admin-only write policy is untouched, and permissive
-- policies OR, so the owner keeps full control of every row.
drop policy if exists tech_competencies_self_write on public.tech_competencies;
create policy tech_competencies_self_write on public.tech_competencies
  for insert
  to authenticated
  with check (tech_id = auth.uid());

drop policy if exists tech_competencies_self_update on public.tech_competencies;
create policy tech_competencies_self_update on public.tech_competencies
  for update
  to authenticated
  using      (tech_id = auth.uid())
  with check (tech_id = auth.uid());

-- No DELETE policy for a tech on purpose: removing the row would erase the
-- owner's sign-off along with the claim.

-- ── 3. The part that makes it safe ─────────────────────────────────────────
-- Without this, the UPDATE policy above would let a tech set his own `level`
-- to 4 across the board and read as ready to graduate.
--
-- Note the INSERT branch: a tech rating a skill nobody has signed off yet
-- creates the row, and he must not create it pre-signed. level is forced to 0
-- and updated_by to null, so an owner sign-off is always a deliberate act.
create or replace function public.guard_competency_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    -- The owner is the authority. Stamp the sign-off trail and let it through.
    if tg_op = 'UPDATE' and new.level is distinct from old.level then
      new.updated_by := auth.uid();
      new.updated_at := now();
    end if;
    return new;
  end if;

  -- Everyone else may only ever touch their own claim.
  if new.tech_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: you may only rate your own skills';
  end if;

  if tg_op = 'INSERT' then
    new.level      := 0;
    new.updated_by := null;
  else
    if new.level is distinct from old.level then
      raise exception
        'FORBIDDEN: only the owner can sign a skill off. Set self_level instead.';
    end if;
    -- Pin everything else that is not the caller's to move.
    new.tech_id    := old.tech_id;
    new.skill_key  := old.skill_key;
    new.note       := old.note;
    new.updated_by := old.updated_by;
    new.updated_at := old.updated_at;
  end if;

  if new.self_level is distinct from (case when tg_op = 'UPDATE' then old.self_level end)
     or new.self_note is distinct from (case when tg_op = 'UPDATE' then old.self_note end) then
    new.self_updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_competency_signoff on public.tech_competencies;
create trigger trg_guard_competency_signoff
  before insert or update on public.tech_competencies
  for each row execute function public.guard_competency_signoff();

commit;

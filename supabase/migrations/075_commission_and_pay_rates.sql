-- 075_commission_and_pay_rates.sql
--
-- Pay rates, and a per-job commission flag Jake sets himself.
--
-- WHY THIS IS A FLAG JAKE SETS, NOT A RULE THE DATABASE INFERS
-- Jake's own words: "I can say which job he should get paid commission for
-- and which job he's just getting paid hourly for." The three-part test —
-- solo, he sold it, he collected it — is the checklist Jake runs in his head
-- before ticking the flag. It is deliberately NOT rebuilt here as three
-- separate tracked signals: "who sold it" and "who collected it" are
-- judgment calls (who answered the phone, who actually closed the deal) that
-- do not reduce to a column without either a second schema change to the
-- fragile payments table (which does a DELETE-then-INSERT of the whole set on
-- every save — see migration 069's comment on that) or guessing at Jake's
-- intent. One admin-set flag per job, matching the material-cost field he
-- asked for the same way, is the right size for what he described.
--
-- "On the job with him" rides on the field that already exists:
-- assigned_tech_id. Jake's own framing: "the app will know I'm on the job
-- with him because, under assigned tech, it would have my name." A job
-- assigned to Jake is a job Jake is on, by construction.
--
-- "Collected it" is enforced by WHEN commission counts, not by a new column:
-- a flagged job only pays commission once the invoice is actually status =
-- 'paid'. If Jake ends up taking the payment himself, the fix is the same
-- motion as everything else here — he clears the flag.

begin;

-- ── 1. Pay rates, private between Jake and each employee ──────────────────
-- Not on `profiles`: profiles_read is `using (true)`, intentionally wide open
-- (every tech needs to see every display_name for pickers), which would make
-- a pay rate stored there readable by anyone who can log in. A separate table
-- with its own narrow policy is the same pattern as tech_competencies.
create table if not exists public.tech_pay (
  tech_id        uuid primary key references auth.users(id) on delete cascade,
  hourly_rate    numeric,
  commission_pct numeric,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tech_pay_hourly_rate_check') then
    alter table public.tech_pay
      add constraint tech_pay_hourly_rate_check check (hourly_rate is null or hourly_rate >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tech_pay_commission_pct_check') then
    alter table public.tech_pay
      add constraint tech_pay_commission_pct_check check (commission_pct is null or commission_pct between 0 and 100);
  end if;
end $$;

comment on table public.tech_pay is
  'One row per employee: hourly rate and commission %. Admin-write, '
  'self-or-admin-read — a tech sees his own rate, never anyone else''s '
  '(migration 075).';

alter table public.tech_pay enable row level security;

drop policy if exists tech_pay_select on public.tech_pay;
create policy tech_pay_select on public.tech_pay
  for select to authenticated
  using (tech_id = auth.uid() or public.is_admin());

drop policy if exists tech_pay_write on public.tech_pay;
create policy tech_pay_write on public.tech_pay
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── 2. The per-job commission flag and its cost basis ──────────────────────
alter table public.invoices
  add column if not exists commission_tech_id uuid references auth.users(id),
  add column if not exists material_cost numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_material_cost_check') then
    alter table public.invoices
      add constraint invoices_material_cost_check check (material_cost >= 0);
  end if;
end $$;

comment on column public.invoices.commission_tech_id is
  'Who earns commission on this job, set by the owner alone. NULL means '
  'hourly only. Commission is realized only once the invoice''s status is '
  '''paid'' — the app''s payroll math gates on that, this column does not '
  '(migration 075).';

comment on column public.invoices.material_cost is
  'Dollar cost of parts on this job, entered by the owner. Commission is '
  'calculated on calcTotals(invoice).total minus this, never on the raw '
  'total (migration 075).';

-- Same shape as guard_job_geo (migration 072): a non-admin may never move
-- either field, including on an otherwise-ordinary save of his own assigned
-- job. Without this, save_invoice_with_items round-tripping whatever the
-- client last loaded would be harmless UNLESS a future client bug ever sent
-- a stale or tampered value — this is pay, so it is pinned at the database,
-- not left to the honesty of whichever client built the request.
create or replace function public.guard_invoice_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' then
    new.commission_tech_id := old.commission_tech_id;
    new.material_cost      := old.material_cost;
  else
    new.commission_tech_id := null;
    new.material_cost      := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_invoice_commission on public.invoices;
create trigger trg_guard_invoice_commission
  before insert or update on public.invoices
  for each row execute function public.guard_invoice_commission();

commit;

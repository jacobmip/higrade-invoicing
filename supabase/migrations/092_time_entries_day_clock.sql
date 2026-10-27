-- 092_time_entries_day_clock.sql
--
-- A day clock: start of workday to end of workday, no job attached. Paid hours
-- including drive time. Day minus the sum of job minutes = drive + travel.
--
-- Two things in 072 stood in the way:
--   1. time_entries_kind_check did not allow 'day'.
--   2. time_entries_one_open_per_tech is one open row per person across ALL
--      kinds, so an open day clock would have blocked clocking in on a job.
-- The one-open rule now holds separately for the day clock and for everything
-- else: one open day, one open job-type shift, per person.

begin;

alter table public.time_entries drop constraint if exists time_entries_kind_check;
alter table public.time_entries add constraint time_entries_kind_check
  check (kind in ('job','shop','supply','drive','other','day'));

-- A day clock belongs to no invoice.
alter table public.time_entries drop constraint if exists time_entries_day_no_invoice;
alter table public.time_entries add constraint time_entries_day_no_invoice
  check (kind <> 'day' or invoice_id is null);

drop index if exists public.time_entries_one_open_per_tech;
create unique index time_entries_one_open_per_tech
  on public.time_entries (tech_id)
  where clock_out_at is null and kind <> 'day';

create unique index if not exists time_entries_one_open_day_per_tech
  on public.time_entries (tech_id)
  where clock_out_at is null and kind = 'day';

commit;

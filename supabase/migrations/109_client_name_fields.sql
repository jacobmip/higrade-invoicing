-- 109: first_name / last_name / company_name on clients.
-- Used for email and SMS salutations. All nullable, no constraints.
-- `name` stays the display name and is untouched.
begin;

alter table public.clients add column if not exists first_name text;
alter table public.clients add column if not exists last_name text;
alter table public.clients add column if not exists company_name text;

-- Conservative backfill: only a plain two-word-or-more personal name,
-- split on the first space. Company-looking names are left null.
update public.clients
set first_name = split_part(trim(name), ' ', 1),
    last_name  = substring(trim(name) from position(' ' in trim(name)) + 1)
where name is not null
  and trim(name) ~ '^[A-Za-z]+ [A-Za-z]'
  and name !~* '(LLC|Inc|Corp|Construction|Contracting|Services|Company|Co\.)'
  and first_name is null;

update public.clients set first_name = 'Shannon', company_name = 'Sand & Sawdust LLC'
  where id = '2e34a6d5-9e60-4ae0-a339-273d7822b4ac';
update public.clients set first_name = 'Andreas', last_name = 'Gaeta', company_name = 'Gaeta Construction'
  where id = '132441b3-237a-46da-9802-fb8623630d49';
update public.clients set first_name = 'Angela', company_name = 'Megill Contracting and Construction Services'
  where id = 'dc7a5a8f-4f2c-42e0-84dc-507297f34926';

commit;

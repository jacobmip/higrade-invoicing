-- 085_kaulana_apprentice_tier.sql
--
-- Kaulana (kmakaula23@gmail.com) was filed as a different tier; he is an apprentice.
-- tier is pay band and scorecard only; role (is_admin) is untouched.
-- Raises if the row is missing so a wrong id cannot read as success.

begin;

do $$
declare n int;
begin
  update public.profiles set tier = 'apprentice'
   where id = '0152abad-6cc0-49f6-846a-042bf528ae30';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Expected to update 1 profile, updated %', n;
  end if;
end $$;

commit;

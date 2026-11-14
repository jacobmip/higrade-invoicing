-- 126_client_name_split_couples.sql
-- ─── Couples get first / last name too ──────────────────────────────────────
--
-- 125's trigger only accepted plain words, so "Neil & Mariane Hannahs" (text
-- lead, EST1211, 2026-11-12) was skipped and the edit form showed blank First
-- and Last. Jake, 2026-11-14.
--
-- Now "&" and "and" are allowed between first names. A couple keeps both first
-- names in first_name and the shared surname in last_name:
--   "Neil & Mariane Hannahs"  -> first "Neil & Mariane", last "Hannahs"
--   "Neil and Mariane Hannahs" -> first "Neil and Mariane", last "Hannahs"
--   "Neil & Mariane"          -> first "Neil & Mariane", no last
-- Everything else splits exactly as 125 did.

begin;

create or replace function public.tg_split_client_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v text := btrim(regexp_replace(coalesce(NEW.name, ''), '\s+', ' ', 'g'));
begin
  if NEW.first_name is not null or NEW.last_name is not null or NEW.company_name is not null then
    return NEW;
  end if;
  if v = '' or v !~ '^[A-Za-z][A-Za-z''.-]*( (&|[A-Za-z][A-Za-z''.-]*))*$'
     or v ~* '\m(llc|inc|corp|construction|contracting|services|company|co|lead|test|plumbing)\M' then
    return NEW;
  end if;
  if v ~* ' (&|and) ' then
    if v ~* ' (&|and)$' or v ~* '^[^ ]+ (&|and) [^ ]+$' then
      -- "Neil & Mariane": no surname given, both names are the first name.
      NEW.first_name := regexp_replace(v, ' (&|and)$', '', 'i');
      NEW.last_name  := null;
    else
      NEW.first_name := regexp_replace(v, ' [^ ]+$', '');
      NEW.last_name  := substring(v from ' ([^ ]+)$');
    end if;
    return NEW;
  end if;
  NEW.first_name := split_part(v, ' ', 1);
  NEW.last_name  := nullif(substring(v from position(' ' in v) + 1), v);
  return NEW;
end;
$$;

commit;

-- 060_allocate_doc_number.sql
--
-- Hand out document numbers from the database, one at a time, under a row lock.
--
-- The number was previously computed in the browser:
--
--   nextDocNum = Math.max(persistedDoc, highestAnyDoc + 1, SHARED_NUMBER_FLOOR)
--
-- from the snapshot loaded at app start, then written back after the save. That
-- is correct for one tab and wrong for everything else. Any second writer --
-- another device, the Telegram manager bot, the AI receptionist, a direct SQL
-- insert -- issues a number the first one has already decided to use.
--
-- The damage is not a duplicate id; the id is a primary key and the second
-- write would simply fail. The damage is to estimate/invoice PAIRING. Conversion
-- keeps the number so EST1040 becomes INV1040, but only while INV1040 is free.
-- Once an unrelated job has taken it, convertInvoice falls back to a fresh
-- number and that estimate and its invoice are mismatched forever. Both known
-- breaks came from exactly this:
--
--   EST1035 (29 Sep) took 1035, already held by INV1035 (27 Sep)
--   EST1040 (01 Oct) was inserted by direct SQL, so the app re-issued 1040
--
-- With one monotonic counter, issuing EST1040 moves the counter to 1041 and
-- nothing can ever be handed 1040 again. INV1040 stays reserved for that
-- estimate's conversion no matter how long it sits unapproved.
--
-- SECURITY DEFINER because settings has RLS and every signed-in plumber needs
-- to draw a number without being able to write the settings table generally.
-- search_path is pinned so the definer's rights cannot be aimed at a shadowed
-- table.
--
-- The counter self-heals: it is clamped to one above the highest number in use,
-- including soft-deleted rows, so a stale or hand-edited setting can never
-- re-issue a number that is already on a document a customer has seen.

create or replace function public.allocate_doc_number()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  counter int;
  highest int;
  issued  int;
begin
  -- Serialise allocations. Concurrent callers queue here rather than each
  -- reading the same value and believing it is theirs.
  select nullif(value, '')::int into counter
    from public.settings
   where key = 'next_doc_num'
     for update;

  -- Never below reality. Counts soft-deleted documents too: the number was
  -- issued and may be printed on something already sent.
  select coalesce(max(nullif(regexp_replace(id, '[^0-9]', '', 'g'), '')::int), 0)
    into highest
    from public.invoices
   where id ~ '^(EST|INV)[0-9]+$';

  -- 1000 is the shared-sequence floor from src/db.js. Legacy documents below it
  -- came from the old side-by-side EST/INV counters, where INV0767 and EST0767
  -- are unrelated, so the shared sequence must start above all of them.
  issued := greatest(coalesce(counter, 0), highest + 1, 1000);

  update public.settings set value = (issued + 1)::text where key = 'next_doc_num';
  if not found then
    insert into public.settings (key, value) values ('next_doc_num', (issued + 1)::text);
  end if;

  -- Keep the two legacy counters at or above the shared one. Nothing should be
  -- reading them any more, but if something does it must not hand back a
  -- number this function has already issued.
  update public.settings set value = (issued + 1)::text
   where key in ('next_num', 'next_estimate_num')
     and coalesce(nullif(value, '')::int, 0) <= issued;

  return issued;
end;
$function$;

comment on function public.allocate_doc_number() is
  'Allocates the next shared EST/INV document number atomically. Every writer must use this rather than computing a number client-side, or estimate/invoice pairing breaks on conversion.';

revoke all on function public.allocate_doc_number() from public;
grant execute on function public.allocate_doc_number() to authenticated, service_role;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default, and REVOKE ... FROM PUBLIC does not take those back: they are
-- explicit grants to named roles. Without this line the allocator is reachable
-- unauthenticated at /rest/v1/rpc/allocate_doc_number, where anyone could spin
-- the counter and burn document numbers. Caught by the security advisor
-- immediately after the first apply.
revoke execute on function public.allocate_doc_number() from anon;

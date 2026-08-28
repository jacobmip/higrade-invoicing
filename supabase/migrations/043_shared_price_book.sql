-- 043_shared_price_book.sql
-- ─── One price book, readable by every plumber, editable only by admin ──────
--
-- saved_items is scoped per user (owner_id, unique on (owner_id, name)) and the
-- price book was seeded to Jake's uuid alone, so a journeyman signing in got an
-- empty Saved Items tab and an empty Price Book picker. They would then type
-- prices by hand and the flat rates stop being flat.
--
-- The AI receptionist already ignores the per-user model: create_estimate_from_lead
-- hardcodes c_owner to Jake's uuid and prices every lead from his book whoever is
-- on shift. So the shared book is already how the business behaves; this only
-- makes the app agree with it.
--
-- Reads widen, writes do not. A plumber can still create and edit their OWN
-- items -- those carry their owner_id -- but cannot touch an admin's, because
-- the existing owner-scoped write policies are left exactly as they are.
--
-- Additive on purpose. Migration 017 set up the current policies and its file is
-- not in this repo, so nothing here drops or replaces a policy it cannot see.
-- Postgres ORs permissive policies together, so adding one widens SELECT and
-- leaves everything else untouched.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

-- Admin ids, read through SECURITY DEFINER so the lookup is not itself subject
-- to whatever RLS profiles carries. Same reasoning as is_admin_uid: a policy
-- that reads profiles under RLS can recurse or silently return nothing.
create or replace function public.admin_owner_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.profiles where role = 'admin'
$$;

grant execute on function public.admin_owner_ids() to anon, authenticated;

drop policy if exists saved_items_read_shared on public.saved_items;
create policy saved_items_read_shared on public.saved_items
  for select to authenticated
  using (
    owner_id = auth.uid()
    or owner_id in (select public.admin_owner_ids())
  );

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Every admin-owned item is now readable by every signed-in plumber. Personal
-- items stay private to whoever made them.
select
  coalesce(p.display_name, '(no profile)') as owner,
  coalesce(p.role, '—')                    as role,
  count(*)                                 as items,
  case when p.role = 'admin' then 'shared with everyone' else 'private to this user' end as visibility
from public.saved_items si
left join public.profiles p on p.id = si.owner_id
group by p.display_name, p.role
order by items desc;

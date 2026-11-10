-- 121_yelp_threads_admin_read.sql
-- The app's AI header reads Lisa's Yelp conversations (tool yelp_threads,
-- v1.70.0). Until now the table was service-role only (migration 115), so the
-- header, which runs as the signed-in user, saw nothing. Admins may READ.
-- Writes stay service-role only: Lisa and the Zaps are the only writers.
drop policy if exists yelp_threads_admin_select on public.yelp_threads;
create policy yelp_threads_admin_select on public.yelp_threads
  for select to authenticated
  using (public.is_admin());
notify pgrst, 'reload schema';

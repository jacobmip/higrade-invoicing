-- 116_yelp_thread_client.sql
-- ─── Tie a Yelp thread to a client and a booked visit (v1.63.0) ─────────────
--
-- Yelp never gives Lisa a phone number, so a Yelp thread is anonymous until
-- she matches it to a client. Once matched it stays matched, so message five
-- does not have to re-identify the customer.
--
--   client_id     the matched client, null until matched
--   match_level   how sure: 'phone' or 'address' (verified, can request
--                 changes) or 'name' (Yelp name + last initial, unique among
--                 clients with an upcoming visit: may confirm a day and time,
--                 nothing else)
--   address       service address the customer gave in the thread
--   estimate_id   the estimate Lisa filed from this thread, so a second
--                 "sounds good" never books a second visit
--
-- invoices.id is text (EST1161), so estimate_id is text. No RLS change: the
-- table stays service-role only (migration 115).

begin;

alter table public.yelp_threads
  add column if not exists client_id   uuid references public.clients(id) on delete set null,
  add column if not exists match_level text check (match_level in ('phone', 'address', 'name')),
  add column if not exists address     text,
  add column if not exists estimate_id text;

commit;

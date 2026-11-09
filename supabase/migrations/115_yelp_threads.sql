-- 115_yelp_threads.sql
-- ─── One row per Yelp lead conversation (v1.61.0) ───────────────────────────
--
-- Yelp's Leads API (reached through Zapier) fires once per message and carries
-- only that message. Lisa needs the whole thread to answer the third message
-- like she read the first two, and she needs a hard ceiling on replies per
-- thread so two autoresponders can never loop. This table holds both.
--
--   lead_id        Yelp's lead id (text, the primary key)
--   first_name     as Yelp gave it, may be null
--   messages       jsonb array of { role: 'consumer' | 'business', text, at }
--   replies_sent   how many replies Lisa has produced for this thread
--   phone, email   filled only if Yelp ever shares them (opt-in phone, masked
--                  email); never required
--   held_reason    why the last draft was held back for Jake instead of sent
--
-- Service role only. RLS is on with no policies, so the browser can never read
-- a customer's thread through the anon key.

begin;

create table if not exists public.yelp_threads (
  lead_id       text primary key,
  first_name    text,
  messages      jsonb       not null default '[]'::jsonb,
  replies_sent  integer     not null default 0,
  phone         text,
  email         text,
  held_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.yelp_threads enable row level security;

commit;

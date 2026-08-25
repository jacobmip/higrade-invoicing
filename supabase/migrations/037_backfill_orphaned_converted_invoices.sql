-- 037_backfill_orphaned_converted_invoices.sql
--
-- One-time repair for invoices auto-created by /api/paypal-capture-order when
-- a customer paid a down payment from an estimate link.
--
-- That endpoint inserts with the service-role key, where auth.uid() is NULL.
-- The set_owner_id BEFORE INSERT trigger therefore stamped owner_id NULL, and
-- RLS hid the row from every account. The invoice was in the database but
-- never appeared in the app, so the estimate looked like it had never
-- converted at all.
--
-- The code fix ships in the same release (the endpoint now inherits the
-- estimate's owner_id and backfills it with a PATCH). This migration repairs
-- the rows that were already created before that fix.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

-- ── Step 1: look before you leap ─────────────────────────────────────────────
-- Run this on its own first. It lists every invoice that is about to be
-- claimed, and which estimate it came from. Expect one row per online down
-- payment taken since the down-payment flow went live.
select
  inv.id            as invoice_id,
  inv.client_name,
  inv.date,
  est.id            as from_estimate,
  est.owner_id      as will_be_owned_by
from public.invoices inv
join public.invoices est
  on est.converted_to_id = inv.id
where inv.owner_id is null
  and est.owner_id is not null
order by inv.date desc;

-- ── Step 2: claim them ───────────────────────────────────────────────────────
-- Each orphaned invoice takes the owner_id of the estimate it was created
-- from. The SQL editor runs as the postgres role, which bypasses RLS, so this
-- lands regardless of who is signed in.
update public.invoices inv
   set owner_id = est.owner_id
  from public.invoices est
 where est.converted_to_id = inv.id
   and inv.owner_id is null
   and est.owner_id is not null;

-- ── Step 3: sweep up anything the join missed ────────────────────────────────
-- Covers rows whose source estimate was itself orphaned, or was deleted after
-- the conversion. Same reasoning as migration 020: an invoice with no owner
-- belongs to Jake.
update public.invoices
   set owner_id = '0a3bcefd-6faf-4bae-b43b-cd4492dd9938'
 where owner_id is null;

-- ── Step 4: verify ───────────────────────────────────────────────────────────
-- Should return 0.
select count(*) as still_orphaned
  from public.invoices
 where owner_id is null;

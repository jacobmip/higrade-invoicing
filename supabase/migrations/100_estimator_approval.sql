-- 100_estimator_approval.sql
--
-- AI ballpark estimate for web / SMS / Yelp leads, gated on Jake's approval.
--
-- estimator_items    the proposal the AI estimator produced, as jsonb:
--                    { items: [{name, desc, qty, price}], total, min, max,
--                      assumptions, summary, generated_at }. Non-null means a
--                    proposal exists, so it is also the "already asked" guard.
-- estimator_approval null = waiting on Jake, 'approved' or 'declined'.
--                    Written by the HI Grade Manager Telegram bot from an
--                    APPROVE / DECLINE reply. Nothing reaches the customer
--                    until this reads 'approved'.
--
-- Deliberately NOT in save_invoice_with_items: like declined_at, these columns
-- are written by their own writers, so a full save from the app cannot revive
-- or clear a pending approval.

begin;

alter table public.invoices
  add column if not exists estimator_items    jsonb,
  add column if not exists estimator_approval text;

alter table public.invoices
  drop constraint if exists invoices_estimator_approval_check;
alter table public.invoices
  add constraint invoices_estimator_approval_check
  check (estimator_approval is null or estimator_approval in ('approved', 'declined'));

comment on column public.invoices.estimator_items is
  'AI ballpark proposal for a web/sms/yelp lead; non-null = Telegram approval was requested.';
comment on column public.invoices.estimator_approval is
  'null = waiting on Jake, approved | declined. Set by the Telegram manager bot.';

commit;

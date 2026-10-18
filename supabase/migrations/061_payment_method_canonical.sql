-- 061_payment_method_canonical.sql
--
-- Make the canonical payment-method spelling durable at the database level.
--
-- public.payments.method is plain nullable text (migration 001, line 60): no
-- default, no check constraint, no trigger. Until 2026-10-16 the table held
-- fifteen spellings of eight methods -- "CHECK" on 207 rows, "Check" on 41,
-- "check" on 1, plus "PAYPAL", "CASH", "OTHER", "CREDIT CARD" and three labels
-- inherited from the old app. Those rows were repaired on 2026-10-16 and the
-- app now canonicalizes on read and on write (src/paymentMethods.js).
--
-- That is not enough on its own, because the app is not the only writer:
--
--   * src/backup.js importBackup upserts raw snapshot rows straight into the
--     table, past db.js and past save_invoice_with_items. The PRE-REPAIR
--     snapshots are still on disk in AI-OS/backups/payment-repair/, so one
--     restore would put all fifteen spellings back in a single click.
--   * The HI Grade Manager bot and any ad-hoc REST or psql write reach the
--     table directly.
--
-- A trigger is the only thing all of them pass through.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT. A check constraint would reject an
-- unrecognised label outright. That would turn a restore of an old snapshot
-- into a hard failure, and it would reject a method nobody has thought of yet
-- without a migration. This trigger instead mirrors canonicalMethod() in
-- src/paymentMethods.js exactly, with the same two rules in the same order:
--
--   1. Fold case against the eight canonical labels.
--   2. Leave an UNRECOGNISED value alone.
--
-- Rule 2 is deliberate in both places. Relabelling a method we do not
-- recognise would quietly rewrite what Jake recorded, and a payment is money.
-- An unfamiliar spelling should look wrong on screen so it gets noticed.
--
-- DO NOT use initcap() here. initcap('PAYPAL') is 'Paypal', not 'PayPal', and
-- the same for 'Bank transfer' vs 'Bank Transfer' -- it would create a ninth
-- and tenth spelling instead of removing any.
--
-- Idempotent: safe to run more than once, and a no-op on already-clean rows.

create or replace function public.canonical_payment_method(m text)
returns text
language sql
immutable
as $$
  select case
    -- Rule 1: the eight canonical labels, matched case-insensitively.
    when m is null                      then m
    when btrim(m) = ''                  then m
    when lower(btrim(m)) = 'cash'          then 'Cash'
    when lower(btrim(m)) = 'check'         then 'Check'
    when lower(btrim(m)) = 'venmo'         then 'Venmo'
    when lower(btrim(m)) = 'zelle'         then 'Zelle'
    when lower(btrim(m)) = 'credit card'   then 'Credit Card'
    when lower(btrim(m)) = 'paypal'        then 'PayPal'
    when lower(btrim(m)) = 'bank transfer' then 'Bank Transfer'
    when lower(btrim(m)) = 'other'         then 'Other'
    -- Aliases with a precedent, matching ALIASES in src/paymentMethods.js.
    -- 'card' is what the record_payment tool description suggested to the
    -- model for months; 'bank' is how the old app labelled a transfer, and the
    -- 2026-10-16 repair mapped its one "BANK" row to Bank Transfer.
    when lower(btrim(m)) in ('card', 'cc') then 'Credit Card'
    when lower(btrim(m)) = 'bank'          then 'Bank Transfer'
    -- Rule 2: anything else keeps its own spelling. btrim only, to match the
    -- JS, which trims before it gives up on recognising a value.
    else btrim(m)
  end;
$$;

comment on function public.canonical_payment_method(text) is
  'Folds a payment method spelling to its canonical label. Mirrors canonicalMethod() in src/paymentMethods.js: case-insensitive match against the eight labels, a small alias map, and an unrecognised value passed through unchanged. Added migration 061.';

create or replace function public.payments_canonical_method()
returns trigger
language plpgsql
as $$
begin
  new.method := public.canonical_payment_method(new.method);
  return new;
end;
$$;

drop trigger if exists trg_payments_canonical_method on public.payments;

create trigger trg_payments_canonical_method
  before insert or update of method on public.payments
  for each row
  execute function public.payments_canonical_method();

-- Repair anything already stored non-canonically. Expected to touch 0 rows on
-- a database repaired on 2026-10-16; it exists so this migration is sufficient
-- on its own if it ever runs against an unrepaired copy.
update public.payments
   set method = public.canonical_payment_method(method)
 where method is distinct from public.canonical_payment_method(method);

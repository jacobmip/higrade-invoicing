-- 062_canonical_method_trims_blank.sql
--
-- canonical_payment_method('   ') returned '   ', where the JS returns ''.
--
-- Migration 061 claims in its own header to mirror canonicalMethod() in
-- src/paymentMethods.js exactly. On every real input it does, verified against
-- seventeen cases including all eight labels, the three aliases, the uppercase
-- legacy spellings and the pass-through values. One input disagreed:
--
--   input   JS                      SQL (061)
--   '   '   '' (trims, then empty)  '   ' (returned the argument untouched)
--
-- Because 061 read `when btrim(m) = '' then m` -- it detected the blank
-- correctly and then handed back the original rather than the trimmed value.
--
-- Not a scenario anyone will hit on purpose, but worth closing for two
-- reasons. A method of three spaces is strictly worse to store than an empty
-- one: it is falsy in neither SQL nor JS, so it survives every `is not null`
-- and `<> ''` guard while displaying as nothing at all. And the claim of exact
-- parity is load-bearing -- the whole design rests on the database and the app
-- agreeing about a spelling, so an exception that is true but undocumented is
-- how the next person gets caught out.
--
-- null is still returned as null, which is NOT a divergence: the app's layer
-- hands callers a string so they can apply their own fallback wording, while
-- the column stays honestly null. That difference is deliberate and 061's
-- header already says so.
--
-- create or replace, so this is idempotent and safe to re-run. The trigger
-- installed by 061 picks the new definition up automatically; it is not
-- redefined here.

create or replace function public.canonical_payment_method(m text)
returns text
language sql
immutable
as $$
  select case
    -- Rule 1: the eight canonical labels, matched case-insensitively.
    when m is null                         then m
    when btrim(m) = ''                     then btrim(m)   -- '' , not the blank input
    when lower(btrim(m)) = 'cash'          then 'Cash'
    when lower(btrim(m)) = 'check'         then 'Check'
    when lower(btrim(m)) = 'venmo'         then 'Venmo'
    when lower(btrim(m)) = 'zelle'         then 'Zelle'
    when lower(btrim(m)) = 'credit card'   then 'Credit Card'
    when lower(btrim(m)) = 'paypal'        then 'PayPal'
    when lower(btrim(m)) = 'bank transfer' then 'Bank Transfer'
    when lower(btrim(m)) = 'other'         then 'Other'
    -- Aliases with a precedent, matching ALIASES in src/paymentMethods.js.
    when lower(btrim(m)) in ('card', 'cc') then 'Credit Card'
    when lower(btrim(m)) = 'bank'          then 'Bank Transfer'
    -- Rule 2: anything else keeps its own spelling, trimmed, as the JS does.
    else btrim(m)
  end;
$$;

comment on function public.canonical_payment_method(text) is
  'Folds a payment method spelling to its canonical label. Mirrors canonicalMethod() in src/paymentMethods.js: case-insensitive match against the eight labels, a small alias map, an unrecognised value passed through trimmed, and a blank folded to the empty string. null is returned as null. Added migration 061, blank handling corrected in 062.';

-- Fold any blank already stored. Expected to touch 0 rows.
update public.payments
   set method = public.canonical_payment_method(method)
 where method is distinct from public.canonical_payment_method(method);

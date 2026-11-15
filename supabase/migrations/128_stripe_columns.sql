-- Stripe Checkout payment tracking.
--
-- Mirrors 010_paypal_columns.sql for the Stripe rail.
--
-- Why two ids:
--   * stripe_session_id is the Checkout Session we create and hand to the
--     browser. It is the only id we know before the customer pays, so it is
--     what correlates a return redirect back to an invoice.
--   * stripe_payment_intent_id is what the settlement and failure webhook
--     events carry, and it is the dedupe key. Stripe retries a webhook until
--     it gets a 2xx, so the same event can arrive several times. One session
--     yields exactly one intent, so a unique index on the intent is what
--     stops a payment being recorded twice.
--
-- ACH note: a bank debit can succeed at checkout and still fail days later.
-- Nothing here records a payment until the money actually settles. The
-- webhook writes a row on payment_intent.succeeded only, never on
-- checkout.session.completed, so the ledger cannot show "paid" before the
-- funds move. Jake is notified at checkout time instead.

alter table payments
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent_id text;

-- Dedupe key. Partial so the existing PayPal and manual rows (null here)
-- do not collide with each other.
create unique index if not exists payments_stripe_intent_idx
  on payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists payments_stripe_session_idx
  on payments (stripe_session_id)
  where stripe_session_id is not null;

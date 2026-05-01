-- PayPal payment tracking.
--
-- When a customer pays an invoice via the PayPal Smart Buttons on the
-- public viewer page, /api/paypal-capture-order inserts a payment row
-- with the PayPal order + capture IDs stored alongside the amount. The
-- capture ID is unique per transaction and is what we de-dupe on so a
-- refresh or retry can't double-record the payment.

alter table payments
  add column if not exists paypal_order_id   text,
  add column if not exists paypal_capture_id text;

create unique index if not exists payments_paypal_capture_idx
  on payments (paypal_capture_id)
  where paypal_capture_id is not null;

-- 059: GE half tax per client.
-- A client flagged ge_half_tax is a general contractor HI Grade works under.
-- New invoices for them default to 0.5% GET and print the GE license number.
-- The invoice itself carries no flag: it is a GE half tax invoice when its
-- tax rate is 0.5 (see src/geTax.js), so each invoice can switch it off.
alter table public.clients
  add column if not exists ge_half_tax boolean not null default false;

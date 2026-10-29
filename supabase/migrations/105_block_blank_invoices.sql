-- 105_block_blank_invoices.sql
-- Backstop against blank invoices: the app autosaved a new document before a
-- client name was entered, minting empty INV#### rows. The app now refuses to
-- save without a name; this stops any other writer too.
--
-- NULL is allowed (some paths set it later); an empty or whitespace-only string
-- is not. Soft-deleted rows are exempt: 62 blank rows already exist, all
-- soft-deleted, and exempting them lets the constraint validate and keeps those
-- rows updatable. Restoring one of them is refused until it is given a name.
--
-- Checked against the live data first: no live row has a blank client_name.
-- Other writers (Lisa, sms-agent, abandoned-call capture) use placeholder names.

begin;

alter table public.invoices
  add constraint invoices_client_name_not_empty
  check (deleted_at is not null or client_name is null or btrim(client_name) <> '');

commit;

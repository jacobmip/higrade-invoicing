-- Store per-invoice client detail overrides (address, email, phone)
-- without modifying the client's permanent profile record.
alter table invoices add column if not exists client_info jsonb;

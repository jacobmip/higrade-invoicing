-- 112_invoice_job_dates.sql
-- ─── Job started / completed dates on an invoice (v1.58.0) ──────────────────
--
-- The estimate marks when it was sent (its first invoice_events 'sent' row)
-- and approved (signed_at), with no new column. The invoice marks when the
-- job started and when it was completed: these two columns.
--
-- Written only by db.setInvoiceJobDates() as a direct update, like
-- material_entries: save_invoice_with_items never names them, so a full save
-- cannot clobber them. Job started falls back to the first visit on display
-- while it is null; Job completed is filled the first time the invoice is sent
-- (sending the invoice means the work is done) unless Jake set it already.
--
-- Plain nullable date columns: no RLS change (the invoices policies already
-- decide who may update the row), no trigger, nothing existing touched.

begin;

alter table public.invoices
  add column if not exists job_started_on   date,
  add column if not exists job_completed_on date;

comment on column public.invoices.job_started_on   is 'When the job started (v1.58.0). Null: shown as the first visit date.';
comment on column public.invoices.job_completed_on is 'When the job was completed (v1.58.0). Set on first send of the invoice when blank.';

commit;

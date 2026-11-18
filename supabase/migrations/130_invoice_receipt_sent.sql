-- 130: auto-receipt when an invoice is paid in full (v1.85.20).
--
-- receipt_sent_at is the one-time claim. api/_lib/receipt.js sets it with a
-- conditional PATCH (receipt_sent_at=is.null), so two saves racing each other
-- send one receipt, not two. save_invoice does not list this column, so an
-- app save never clears it.
--
-- Backfill: every invoice already paid today counts as receipted, so the
-- deploy never mails a surprise receipt for an old job.

alter table public.invoices add column if not exists receipt_sent_at timestamptz;

update public.invoices
   set receipt_sent_at = now()
 where receipt_sent_at is null
   and coalesce(type, 'invoice') <> 'estimate'
   and status = 'paid';

Apply invoicing migration 112 (job dates) to the HI Grade Supabase database.

File: higrade-invoicing/supabase/migrations/112_invoice_job_dates.sql (pull main first).
It adds two nullable date columns to public.invoices: job_started_on and job_completed_on.
No RLS or trigger change; nothing existing is modified.

1. Dry-run: copy the file with its final `commit;` changed to `rollback;` and run it with
   AI-OS/scripts/apply-migration.py. It must finish with no error.
2. Apply the real file the same way.
3. Verify by exercising it, inside rolled-back transactions:
   - Confirm both columns exist with type date (information_schema.columns).
   - As Jake (set local role authenticated; set local request.jwt.claims =
     '{"sub":"0a3bcefd-6faf-4bae-b43b-cd4492dd9938","role":"authenticated"}'):
     `update invoices set job_completed_on = '2026-11-08' where id = (select id from invoices
     where type = 'invoice' and deleted_at is null order by created_at desc limit 1) returning id, job_completed_on`
     must return one row with that date. Then roll back.
4. Update higrade-invoicing/CLAUDE.md: change the **112** line from "written 2026-11-08, NOT applied"
   to "applied and verified <date>", and remove "which is written but NOT yet applied" from the schema
   heading. Commit and push to main. Note it in AI-OS/STATUS.md too.

Report back: dry-run result, apply result, and the result of each check in step 3.

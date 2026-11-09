Apply invoicing migration 113 (document origin) to the HI Grade Supabase database.

File: higrade-invoicing/supabase/migrations/113_document_origin.sql (pull main first).
It adds invoices.created_via, created_from, created_by, a BEFORE INSERT trigger
aa_invoices_stamp_origin that fills them, and backfills Lisa leads and conversions.
No RLS change.

1. Dry-run: copy the file with its final `commit;` changed to `rollback;` and run it with
   AI-OS/scripts/apply-migration.py. It must finish with no error.
2. Apply the real file the same way.
3. Verify, inside rolled-back transactions:
   - The three columns exist (information_schema.columns) and the trigger exists (pg_trigger).
   - As the service role (no jwt claims): insert a throwaway estimate row
     (id 'EST9999', type 'estimate', client_name 'Origin test') and read back
     created_via = 'outside_app'. Roll back.
   - As Jake (set local role authenticated; set local request.jwt.claims =
     '{"sub":"0a3bcefd-6faf-4bae-b43b-cd4492dd9938","role":"authenticated"}'): the same insert
     reads back created_via = 'app' and created_by = Jake's uuid. Roll back.
   - Report counts: select created_via, count(*) from invoices group by 1.
4. Update higrade-invoicing/CLAUDE.md: the **113** line from "written 2026-11-09, NOT applied" to
   "applied and verified <date>", and drop "which is written but NOT yet applied" from the schema
   heading. Commit and push to main. Note it in AI-OS/STATUS.md, and tell Lani (her reference docs)
   that invoices.created_via / created_from say how a document was made, with the values listed
   in the migration header, so she can answer "how was INV#### made?".

Report back: dry-run result, apply result, each check in step 3, and the counts.

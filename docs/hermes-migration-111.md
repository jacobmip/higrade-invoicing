Apply invoicing migration 111 (change orders) to the HI Grade Supabase database.

File: higrade-invoicing/supabase/migrations/111_change_orders.sql (pull main first).
It creates one new table, public.change_orders, with RLS. It changes nothing that exists.

1. Dry-run: copy the file with its final `commit;` changed to `rollback;` and run it with
   AI-OS/scripts/apply-migration.py. It must finish with no error.
2. Apply the real file the same way.
3. Verify by exercising it, inside rolled-back transactions:
   - As the test journeyman (set local role authenticated; set local request.jwt.claims =
     '{"sub":"fbf88c7c-ae9c-4601-af22-d0959d59a040","role":"authenticated"}'):
     inserting a change order on a job NOT assigned to him must be refused with an RLS error,
     and `update change_orders set status = 'approved'` must affect 0 rows or be refused.
   - Confirm the table has `sent_email` and `photos` columns (information_schema.columns).
   - As Jake ("sub":"0a3bcefd-6faf-4bae-b43b-cd4492dd9938"): insert a change order on any
     invoice (seq 1, a view_token of 20+ characters) and read it back. Then roll back.
4. Update higrade-invoicing/CLAUDE.md: change the **111** line from "NOT applied" to
   "applied and verified <date>", and the schema heading's "111 not yet applied". Commit and push to main.

Report back: dry-run result, apply result, and the result of each check in step 3.

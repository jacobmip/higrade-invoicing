-- ─── Fix invoice→client foreign key to ON DELETE SET NULL ──────────────────
--
-- Migration 001 declared the FK as `on delete set null`, but the production
-- schema ended up with the default RESTRICT/NO ACTION behavior (most likely
-- because the column type was changed from bigint to uuid in a separate
-- migration which recreated the constraint without the modifier).
--
-- Result: the UI's "delete client" button silently failed for any client who
-- had ever been on an invoice. Server returned a 409 FK violation; the
-- frontend's catch-less await swallowed it.
--
-- Fix: drop and recreate the constraint with the intended behavior.
-- Invoice rows keep their client_name / client_info snapshot so the invoice
-- remains readable after the client is removed.

alter table public.invoices
  drop constraint if exists invoices_client_id_fkey;

alter table public.invoices
  add constraint invoices_client_id_fkey
  foreign key (client_id) references public.clients(id)
  on delete set null;

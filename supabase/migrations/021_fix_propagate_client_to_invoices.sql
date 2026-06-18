-- 021_fix_propagate_client_to_invoices.sql
--
-- The propagate_client_to_invoices RPC was matching only on client_id, which
-- is null on all invoices created before we started reliably writing client_id
-- to the invoices table (the form was never setting it on new/selected clients).
--
-- This migration:
--   1. Re-creates the RPC to match on client_id OR (client_id IS NULL AND
--      client_name = p_client_name) so existing name-linked invoices get the
--      update too.
--   2. Also writes client_id onto those name-matched rows so they become
--      properly linked for all future propagations.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

create or replace function public.propagate_client_to_invoices(
  p_client_id   uuid,
  p_client_name text,
  p_client_info jsonb,
  p_billing_address jsonb default null,
  p_addresses   jsonb default null
) returns void
language sql
security invoker
as $$
  update public.invoices
    set
      client_name     = p_client_name,
      client_id       = p_client_id,
      client_info     = p_client_info,
      billing_address = p_billing_address
    where
      -- Primary: invoices already linked by UUID
      client_id = p_client_id
      -- Fallback: older invoices linked only by name (client_id was never written)
      or (client_id is null and client_name = p_client_name);
$$;

grant execute on function public.propagate_client_to_invoices(uuid, text, jsonb, jsonb, jsonb) to anon, authenticated;

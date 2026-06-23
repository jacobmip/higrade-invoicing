-- 022_add_address_unit.sql
--
-- Adds a dedicated apt/unit field to clients so apartment/suite numbers
-- can be stored separately from the street address line.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql/new

alter table public.clients
  add column if not exists address_unit text;

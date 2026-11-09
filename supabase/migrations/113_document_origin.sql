-- 113_document_origin.sql
-- ─── How every estimate and invoice came to exist (v1.60.0) ─────────────────
--
-- Jake asked to always be able to tell how a document was made, so the app,
-- Lani and Lisa can answer "how did INV1201 get here?" straight away.
--
--   created_via   text  how it was made (values below)
--   created_from  text  the document it came from (conversion, duplicate,
--                       customer signature, deposit), else null
--   created_by    uuid  the logged-in person who made it (auth.uid() at insert),
--                       null for server and service-role writers
--
-- created_via values:
--   app            set by this trigger for any insert by a logged-in user;
--                  the app then narrows it to app_manual | app_ai_chat |
--                  app_header_ai | app_price_book | app_conversion | app_duplicate
--   customer_signed | paypal_deposit   _lib/convert-estimate.js
--   lisa_<lead_channel>   source = 'ai_lead' (Lisa's phone/SMS/web/yelp leads)
--   outside_app    any other insert with no logged-in user (Lani, Hermes,
--                  scripts) that did not say what it was
--
-- The trigger only fills what the writer left blank, so a writer that knows
-- better (the app, convert-estimate) wins. Nothing else changes: no RLS
-- change, save_invoice_with_items never names these columns, so a save cannot
-- clobber them.

begin;

alter table public.invoices
  add column if not exists created_via  text,
  add column if not exists created_from text,
  add column if not exists created_by   uuid;

create or replace function public.stamp_document_origin()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.created_via is null then
    new.created_via := case
      when new.source = 'ai_lead' then 'lisa_' || coalesce(nullif(new.lead_channel, ''), 'phone')
      when auth.uid() is null then 'outside_app'
      else 'app'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_invoices_stamp_origin on public.invoices;
create trigger aa_invoices_stamp_origin
  before insert on public.invoices
  for each row execute function public.stamp_document_origin();

-- Backfill only what the existing rows prove; everything else stays null and
-- reads "before origin tracking".
update public.invoices
   set created_via = 'lisa_' || coalesce(nullif(lead_channel, ''), 'phone')
 where created_via is null and source = 'ai_lead';

-- An invoice an estimate converted into, made after that estimate.
update public.invoices i
   set created_via = 'app_conversion', created_from = e.id
  from public.invoices e
 where i.created_via is null and i.type = 'invoice'
   and e.type = 'estimate' and e.converted_to_id = i.id
   and coalesce(i.created_at, now()) >= coalesce(e.created_at, '-infinity');

-- An estimate made FROM an invoice (invoice -> estimate keeps the invoice and
-- links the new estimate to it): the estimate is the younger of the two.
update public.invoices e
   set created_via = 'app_conversion', created_from = e.converted_to_id
  from public.invoices i
 where e.created_via is null and e.type = 'estimate'
   and i.id = e.converted_to_id and i.type = 'invoice'
   and e.created_at > i.created_at;

commit;

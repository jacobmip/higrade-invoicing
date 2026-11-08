-- 111_change_orders.sql
-- ─── Change orders: extra work the customer approves mid-job ───────────────
--
-- A change order belongs to one invoice (the job). Jake writes the extra lines
-- in the app and sends a link (/co/<view_token>) by email, text or both. The
-- customer approves by signing on that page or by texting YES back. On approval the
-- server (service role, api/_lib/change-order.js) adds the lines to the
-- invoice, so nothing waits on Jake. Declined: the invoice is untouched.
--
-- Its own table, not an invoices row: an EST/INV row would get a number, show
-- in the lists and reports, and be picked up by every writer and trigger that
-- keys on invoices. The change order is shown as <invoice id>-CO<seq>.
--
-- status: draft (being written) | sent | approved | declined
-- approved_via: signature | sms
-- applied_at: when the lines were added to the invoice (set with approval).
--
-- Access: admin everything; the job's assigned or commission tech can read,
-- create and edit change orders on that job (is_my_assigned_job, 069/090).
-- The customer never reads this table directly: the public page goes through
-- /api/public-invoice?co=<token> with the service role, which returns only the
-- fields the page needs. No delete for non-admins.

begin;

create table if not exists public.change_orders (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     text not null references public.invoices(id) on delete cascade,
  seq            integer not null check (seq > 0),
  items          jsonb not null default '[]'::jsonb,   -- [{name, desc, qty, price, taxable}]
  note           text,                                 -- shown to the customer
  status         text not null default 'draft'
                 check (status in ('draft', 'sent', 'approved', 'declined')),
  view_token     text not null unique check (length(view_token) >= 16),
  sent_at        timestamptz,
  sent_to        text,                                 -- E.164 phone it was texted to
  sent_email     text,                                 -- email address it was emailed to
  approved_at    timestamptz,
  approved_via   text check (approved_via in ('signature', 'sms')),
  approved_name  text,
  signature_data text,
  approval_message text,                               -- the customer's YES text, verbatim
  declined_at    timestamptz,
  applied_at     timestamptz,
  owner_id       uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (invoice_id, seq)
);

create index if not exists change_orders_invoice_idx on public.change_orders (invoice_id);
create index if not exists change_orders_sent_idx on public.change_orders (sent_to) where status = 'sent';

alter table public.change_orders enable row level security;

drop policy if exists change_orders_admin on public.change_orders;
create policy change_orders_admin on public.change_orders
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists change_orders_tech_select on public.change_orders;
create policy change_orders_tech_select on public.change_orders
  for select to authenticated
  using (public.is_my_assigned_job(invoice_id));

drop policy if exists change_orders_tech_insert on public.change_orders;
create policy change_orders_tech_insert on public.change_orders
  for insert to authenticated
  with check (public.is_my_assigned_job(invoice_id) and status in ('draft', 'sent'));

-- A tech may edit and send his job's change order, never mark it approved:
-- approval comes only from the customer, through the service role.
drop policy if exists change_orders_tech_update on public.change_orders;
create policy change_orders_tech_update on public.change_orders
  for update to authenticated
  using (public.is_my_assigned_job(invoice_id) and status in ('draft', 'sent'))
  with check (public.is_my_assigned_job(invoice_id) and status in ('draft', 'sent'));

commit;

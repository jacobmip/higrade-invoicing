-- 055_invoice_reminders.sql
--
-- Log of automated payment reminders, written by the invoice follow-up script
-- in the AI-OS repo (scripts/invoice_followup.py, a daily Hermes cron on the
-- Mac mini). It is a writer outside the app: it inserts here with the service
-- role key and never touches invoices.
--
-- One row per invoice per reminder tier (1, 7, 14, 30 days past due). The
-- partial unique index is the duplicate guard: a tier can be recorded as
-- 'sent' once per invoice, so a double run cannot send the same reminder
-- twice. 'failed' rows are kept for the record and do not block a retry.
--
-- invoice_followup_live gates every customer send. While it reads 'false' the
-- script only sends Jake a Telegram preview of what it would have sent.

create table if not exists public.invoice_reminders (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   text not null references public.invoices(id) on delete cascade,
  tier         int  not null check (tier in (1, 7, 14, 30)),
  days_overdue int  not null,
  channel      text not null check (channel in ('sms', 'email')),
  status       text not null default 'sent' check (status in ('sent', 'failed')),
  recipient    text,
  amount_due   numeric(12,2),
  message      text,
  provider_id  text,
  error        text,
  sent_at      timestamptz not null default now()
);

create unique index if not exists invoice_reminders_once_per_tier
  on public.invoice_reminders (invoice_id, tier) where status = 'sent';

create index if not exists invoice_reminders_invoice_idx
  on public.invoice_reminders (invoice_id, sent_at desc);

alter table public.invoice_reminders enable row level security;

-- Admins can read the log from the app. Writes come only from the service
-- role, which bypasses RLS, so no write policy is granted to anyone.
drop policy if exists invoice_reminders_select on public.invoice_reminders;
create policy invoice_reminders_select on public.invoice_reminders
  for select using (public.is_admin());

insert into public.settings (key, value) values
  ('invoice_followup_live', 'false')
on conflict (key) do nothing;

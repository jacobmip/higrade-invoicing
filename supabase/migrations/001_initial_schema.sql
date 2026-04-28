-- HiGrade Invoicing — Initial Schema
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/sql

create table if not exists clients (
  id bigint primary key generated always as identity,
  name text not null,
  email text,
  secondary_email text,
  mobile text,
  phone text,
  fax text,
  contact text,
  address1 text,
  address2 text,
  address3 text,
  created_at timestamptz default now()
);

create table if not exists invoices (
  id text primary key,
  type text not null default 'invoice',
  client_id bigint references clients(id) on delete set null,
  client_name text,
  date date,
  due_date date,
  status text not null default 'outstanding',
  tax numeric default 4.712,
  discount numeric default 0,
  discount_type text default '$',
  notes text,
  year integer,
  gcal_date text,
  gcal_event_id text,
  follow_up_date date,
  follow_up_event_id text,
  signature_data text,
  signed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists invoice_items (
  id bigint primary key generated always as identity,
  invoice_id text references invoices(id) on delete cascade,
  name text,
  desc text,
  qty numeric default 1,
  price numeric default 0,
  unit text default 'ea',
  discount numeric default 0,
  discount_type text default '%',
  taxable boolean default true,
  sort_order integer default 0
);

create table if not exists payments (
  id bigint primary key generated always as identity,
  invoice_id text references invoices(id) on delete cascade,
  amount numeric not null,
  method text,
  date date,
  note text,
  created_at timestamptz default now()
);

create table if not exists saved_items (
  id bigint primary key generated always as identity,
  category text,
  name text not null,
  desc text,
  price numeric,
  taxable boolean default true,
  unit text
);

create table if not exists invoice_history (
  id bigint primary key generated always as identity,
  invoice_id text references invoices(id) on delete cascade,
  event text,
  created_at timestamptz default now()
);

create table if not exists expenses (
  id bigint primary key generated always as identity,
  date date,
  merchant text,
  amount numeric,
  category text,
  description text,
  receipt_data text,
  created_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value text
);

insert into settings (key, value) values ('next_num', '753') on conflict (key) do nothing;

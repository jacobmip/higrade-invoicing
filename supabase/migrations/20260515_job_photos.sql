-- 20260515_job_photos.sql
-- Job photo documentation attached to invoices.
-- Photos are stored in Supabase Storage (bucket: job-photos) and referenced here.
--
-- NOTE: invoices.id is type TEXT (e.g. "INV-753"), not uuid, so invoice_id
-- here is TEXT to match — consistent with invoice_items, payments, etc.
--
-- STORAGE BUCKET SETUP (do this manually in the Supabase dashboard):
--   1. Go to Storage → New bucket
--   2. Name: job-photos
--   3. Public bucket: YES (so photo URLs work without auth tokens)
--   4. File size limit: 10 MB (recommended)
--   5. Allowed MIME types: image/jpeg, image/png, image/webp, image/heic
--   6. Go to Storage → Policies → job-photos bucket and add:
--      - SELECT (read): authenticated users — using (true)
--      - INSERT (upload): authenticated users — with check (true)
--      - DELETE: authenticated users — using (true)

create table if not exists public.job_photos (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  text not null references public.invoices(id) on delete cascade,
  url         text not null,
  caption     text,
  type        text not null default 'other' check (type in ('before', 'after', 'other')),
  created_at  timestamptz not null default now()
);

create index if not exists job_photos_invoice_id_idx
  on public.job_photos (invoice_id, created_at desc);

alter table public.job_photos enable row level security;

drop policy if exists job_photos_auth_all on public.job_photos;
create policy job_photos_auth_all on public.job_photos
  for all to authenticated
  using (true)
  with check (true);

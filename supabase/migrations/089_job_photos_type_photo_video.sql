-- 089_job_photos_type_photo_video.sql
-- attach_media_to_recent_estimate() (051) inserts job_photos.type = 'photo' or
-- 'video', but the live check only allowed before | after | other, so every
-- texted attachment failed to reach the job (sms-inbound logged and swallowed
-- the error). Live state checked 2026-10-27: zero photo/video rows, and the
-- job-photos bucket already has no size or MIME limit, so no bucket change.
begin;

alter table public.job_photos drop constraint if exists job_photos_type_check;
alter table public.job_photos
  add constraint job_photos_type_check
  check (type = any (array['before','after','other','photo','video']));

commit;

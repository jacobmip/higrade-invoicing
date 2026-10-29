-- 104: Google review link used by the review-request text sent when an invoice
-- is paid (src/reviewRequest.js). Jake sets the real link in Settings. The
-- placeholder is treated as "unset" by the app, so nothing is texted until then.
begin;
insert into settings (key, value) values ('google_review_link', 'https://g.page/r/PLACEHOLDER/review') on conflict (key) do nothing;
commit;

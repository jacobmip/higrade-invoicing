-- 103_client_blacklist.sql
-- Flag a client as blacklisted. The app shows a warning (never blocks), and
-- /api/vapi-call-ended skips lead capture, kickoff text and drip for a caller
-- whose number matches a blacklisted client.
begin;
alter table clients add column if not exists blacklisted boolean default false;
alter table clients add column if not exists blacklist_reason text;
commit;

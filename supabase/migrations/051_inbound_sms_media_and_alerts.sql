-- 051_inbound_sms_media_and_alerts.sql
-- ─── Make inbound texts visible, and keep the photos ────────────────────────
--
-- Two failures found the same morning, both from a real customer message.
--
-- 1. A texted photo was thrown away. Twilio delivers attachments as separate
--    MediaUrl0, MediaUrl1... parameters and log_client_message only stored
--    Body. A customer texting a picture of their shower valve had the caption
--    saved and the image dropped. Collecting photos is the entire reason the
--    post-call follow-up text exists, so the flow ended one step short of its
--    own purpose.
--
-- 2. Nothing announced the message. It landed in client_messages correctly and
--    then sat there. No email, no notification, and no screen in the app reads
--    that table. Jake replied to the follow-up text with his address and email
--    and had no idea where it had gone -- because nowhere surfaced it. Same
--    shape as internal_notes before the editor box existed: captured
--    perfectly, invisible in practice.
--
-- Media is stored as jsonb on the message:
--   [{"url": "<supabase public url>", "type": "image/jpeg"}, ...]
-- The route downloads from Twilio using the account credentials and re-uploads
-- to the existing public job-photos bucket. Twilio's own media URLs are no use
-- for storage: they require auth to fetch and are deleted after a retention
-- window, so a saved link rots.

alter table public.client_messages
  add column if not exists media jsonb;

comment on column public.client_messages.media is
  'Attachments re-hosted in Supabase Storage: [{url,type}]. Twilio media URLs are auth-gated and expire, so they are never stored directly.';

-- ── Write path ─────────────────────────────────────────────────────────────
-- Adds p_media, and raises an in-app notification for inbound messages so the
-- bell fires the same way it does for a new lead.
create or replace function public.log_client_message(
  p_secret    text,
  p_phone     text,
  p_direction text,
  p_body      text,
  p_call_id   text default null,
  p_media     jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_digits text;
  v_client record;
  v_owner  uuid;
  v_id     uuid;
  v_count  int := 0;
begin
  select value into v_secret from public.settings where key = 'sms_webhook_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing sms webhook secret';
  end if;

  if p_direction not in ('outbound', 'inbound') then
    raise exception 'INVALID_INPUT: direction must be outbound or inbound';
  end if;

  -- An MMS can legitimately carry photos with no caption, so an empty body is
  -- only invalid when there is also no media.
  if coalesce(btrim(coalesce(p_body, '')), '') = ''
     and coalesce(jsonb_array_length(coalesce(p_media, '[]'::jsonb)), 0) = 0 then
    raise exception 'INVALID_INPUT: body or media is required';
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);

  if length(v_digits) = 10 then
    select id, name, owner_id into v_client
      from public.clients
     where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_digits
        or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_digits
     order by created_at asc
     limit 1;
  end if;

  v_owner := coalesce(
    v_client.owner_id,
    (select id from public.profiles where role = 'admin' order by created_at asc limit 1)
  );

  insert into public.client_messages
    (client_id, owner_id, phone_number, direction, body, related_call_id, media)
  values
    (v_client.id, v_owner, p_phone, p_direction,
     coalesce(nullif(btrim(coalesce(p_body,'')), ''), '(no text)'),
     nullif(btrim(coalesce(p_call_id,'')), ''),
     nullif(p_media, '[]'::jsonb))
  returning id into v_id;

  v_count := coalesce(jsonb_array_length(coalesce(p_media, '[]'::jsonb)), 0);

  -- Ring the in-app bell on inbound only. An outbound row is something we did.
  if p_direction = 'inbound' then
    insert into public.notifications (type, title, body, data)
    values (
      'sms',
      'Text from ' || coalesce(v_client.name, p_phone),
      coalesce(nullif(btrim(coalesce(p_body,'')), ''), '(photo only)')
        || case when v_count > 0 then E'\n[' || v_count || ' attachment(s)]' else '' end,
      jsonb_build_object('phone', p_phone, 'client_id', v_client.id, 'message_id', v_id)
    );
  end if;

  return jsonb_build_object(
    'message_id',  v_id,
    'client_id',   v_client.id,
    'client_name', v_client.name,
    'matched',     v_client.id is not null,
    'owner_id',    v_owner,
    'media_count', v_count
  );
end;
$$;

revoke execute on function public.log_client_message(text, text, text, text, text, jsonb) from public;
grant  execute on function public.log_client_message(text, text, text, text, text, jsonb) to anon, authenticated;

-- ── Attach texted photos to the open job ───────────────────────────────────
-- A photo is only useful next to the estimate it belongs to. Finds the client's
-- most recent live estimate and files the media against it, so texted pictures
-- appear on the job rather than only in the message thread.
create or replace function public.attach_media_to_recent_estimate(
  p_secret    text,
  p_client_id uuid,
  p_media     jsonb,
  p_caption   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_inv    text;
  v_item   jsonb;
  v_n      int := 0;
begin
  select value into v_secret from public.settings where key = 'sms_webhook_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing sms webhook secret';
  end if;

  if p_client_id is null or coalesce(jsonb_array_length(coalesce(p_media,'[]'::jsonb)),0) = 0 then
    return jsonb_build_object('attached', 0);
  end if;

  -- Most recent live estimate for this client. Deliberately estimates only:
  -- a photo texted during quoting belongs on the quote, not on a paid invoice.
  select id into v_inv
    from public.invoices
   where client_id = p_client_id
     and type = 'estimate'
     and deleted_at is null
   order by created_at desc
   limit 1;

  if v_inv is null then
    return jsonb_build_object('attached', 0, 'reason', 'no open estimate for this client');
  end if;

  for v_item in select * from jsonb_array_elements(p_media) loop
    insert into public.job_photos (invoice_id, url, caption, type)
    values (
      v_inv,
      v_item->>'url',
      coalesce(nullif(btrim(coalesce(p_caption,'')), ''), 'Texted by customer'),
      case when coalesce(v_item->>'type','') like 'video/%' then 'video' else 'photo' end
    );
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('attached', v_n, 'estimate_id', v_inv);
end;
$$;

revoke execute on function public.attach_media_to_recent_estimate(text, uuid, jsonb, text) from public;
grant  execute on function public.attach_media_to_recent_estimate(text, uuid, jsonb, text) to anon, authenticated;

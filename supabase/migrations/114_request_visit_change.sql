-- 114_request_visit_change.sql
-- ─── Let Lisa take a reschedule or cancel request for a booked visit ────────
--
-- Follows 113 (Lisa can now SEE a caller's appointments). This lets her act on
-- them without ever touching the schedule herself.
--
-- WHY A REQUEST AND NOT A CHANGE. Moving or deleting a Google Calendar event
-- goes through /api/gcal with a signed-in app session. The Apps Script webhook
-- only creates events, and the project is at its cap of Node serverless routes
-- (see CLAUDE.md). Rewriting invoices.visits from SQL without the matching
-- calendar call would leave the app and the calendar disagreeing, which is the
-- bug class 047 fixed. So Lisa records what the customer asked for, Jake gets a
-- push and an email, and Jake makes the change in the app, where the calendar
-- stays in sync. Nothing here writes to invoices.
--
-- WHO. The caller is identified server-side from caller ID, never from a name
-- Lisa passes, so a request can only ever name the caller's OWN appointments.
--
-- WHAT IT WRITES: one notifications row (push fan-out, 011), one
-- invoice_events row (visible in the document's history), one email through
-- /api/send-email to settings.lead_notify_to. Same channels as a new lead.
--
-- RETURN. Never raises on a caller-side problem. Returns {ok:false, reason}
-- so Lisa can say something sensible instead of the call erroring:
--   no_account      caller id matches no client
--   no_appointment  nothing from today onward
--   which_one       several upcoming visits and none was named; options listed
--   bad_time        reschedule without a usable future YYYY-MM-DDTHH:MM
-- A repeat of the same request within 30 minutes is a no-op that returns
-- ok:true, duplicate:true, so a retried tool call cannot spam Jake.

create or replace function public.request_visit_change(
  p_secret      text,
  p_phone       text,
  p_action      text,            -- 'reschedule' | 'cancel'
  p_visit_start text default null,   -- which visit, e.g. 2026-11-10T09:00
  p_new_time    text default null,   -- reschedule only, YYYY-MM-DDTHH:MM
  p_reason      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_secret   text;
  v_digits   text;
  v_c        record;
  v_today    text;
  v_now      text;
  v_hits     jsonb;
  v_n        int;
  v_pick     jsonb;
  v_doc      text;
  v_start    text;
  v_what     text;
  v_when     text;
  v_newwhen  text;
  v_title    text;
  v_body     text;
  v_subject  text;
  v_to       jsonb;
begin
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  if p_action not in ('reschedule', 'cancel') then
    return jsonb_build_object('ok', false, 'reason', 'bad_action');
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  select id, name, phone, mobile into v_c
    from public.clients
   where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_digits
      or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_digits
   order by created_at asc
   limit 1;

  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  v_today := to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM-DD');
  v_now   := to_char(now() at time zone 'Pacific/Honolulu', 'YYYY-MM-DD"T"HH24:MI');

  -- The caller's upcoming visits (same rule as lookup_client_by_phone, 113).
  select coalesce(jsonb_agg(x.j order by x.s), '[]'::jsonb), count(*)
    into v_hits, v_n
    from (
      select vis->>'start' as s,
             jsonb_build_object(
               'start', vis->>'start',
               'what',  coalesce(nullif(vis->>'label', ''), vis->>'kind', ''),
               'document', i.id
             ) as j
        from public.invoices i
       cross join lateral jsonb_array_elements(
              case when jsonb_typeof(i.visits) = 'array' then i.visits else '[]'::jsonb end
            ) as vis
       where i.client_id = v_c.id
         and i.deleted_at is null
         and coalesce(vis->>'start', '') >= v_today
    ) x;

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_appointment');
  end if;

  -- Pick the visit. A named start wins; a single visit is unambiguous.
  if nullif(btrim(coalesce(p_visit_start, '')), '') is not null then
    select e into v_pick
      from jsonb_array_elements(v_hits) e
     where e->>'start' like btrim(p_visit_start) || '%'
     order by e->>'start'
     limit 1;
  elsif v_n = 1 then
    v_pick := v_hits->0;
  end if;

  if v_pick is null then
    return jsonb_build_object('ok', false, 'reason', 'which_one', 'options', v_hits);
  end if;

  v_doc   := v_pick->>'document';
  v_start := v_pick->>'start';
  v_what  := v_pick->>'what';

  if p_action = 'reschedule' then
    if p_new_time is null
       or p_new_time !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
       or p_new_time <= v_now then
      return jsonb_build_object('ok', false, 'reason', 'bad_time');
    end if;
    v_newwhen := to_char(p_new_time::timestamp, 'FMDy Mon FMDD "at" FMHH12:MI AM');
  end if;

  -- Retry guard.
  if exists (
    select 1 from public.notifications n
     where n.type = 'visit_change'
       and n.invoice_id = v_doc
       and n.data->>'action' = p_action
       and n.data->>'visit_start' = v_start
       and coalesce(n.data->>'new_time', '') = coalesce(p_new_time, '')
       and n.created_at > now() - interval '30 minutes'
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  v_when := to_char(v_start::timestamp, 'FMDy Mon FMDD "at" FMHH12:MI AM');

  if p_action = 'reschedule' then
    v_title   := 'RESCHEDULE request: ' || coalesce(v_c.name, 'customer');
    v_subject := 'RESCHEDULE REQUEST: ' || coalesce(v_c.name, 'customer')
                 || ' - ' || coalesce(v_c.mobile, v_c.phone, '');
    v_body := coalesce(v_c.name, 'A customer') || ' called Lisa and asked to MOVE their visit.' || E'\n'
              || 'Job: ' || coalesce(nullif(v_what, ''), v_doc) || ' (' || v_doc || ')' || E'\n'
              || 'Currently: ' || v_when || E'\n'
              || 'Wants: ' || v_newwhen;
  else
    v_title   := 'CANCEL request: ' || coalesce(v_c.name, 'customer');
    v_subject := 'CANCEL REQUEST: ' || coalesce(v_c.name, 'customer')
                 || ' - ' || coalesce(v_c.mobile, v_c.phone, '');
    v_body := coalesce(v_c.name, 'A customer') || ' called Lisa and asked to CANCEL their visit.' || E'\n'
              || 'Job: ' || coalesce(nullif(v_what, ''), v_doc) || ' (' || v_doc || ')' || E'\n'
              || 'Scheduled: ' || v_when;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    v_body := v_body || E'\n' || 'Reason: ' || btrim(p_reason);
  end if;
  v_body := v_body || E'\n\n' || 'The calendar and the visit have NOT been changed. '
            || 'Make the change in the app, then text the customer to confirm.';

  insert into public.notifications (type, title, body, invoice_id, data)
  values ('visit_change', v_title, v_body, v_doc,
          jsonb_build_object('action', p_action, 'visit_start', v_start,
                             'new_time', p_new_time, 'client_id', v_c.id,
                             'phone', coalesce(v_c.mobile, v_c.phone)));

  insert into public.invoice_events (invoice_id, kind, recipient, meta)
  values (v_doc, 'visit_change_requested', null,
          jsonb_build_object('action', p_action, 'visit_start', v_start,
                             'new_time', p_new_time, 'reason', p_reason,
                             'via', 'lisa'));

  -- Email, never allowed to fail the request.
  begin
    select coalesce(
             jsonb_agg(to_jsonb(btrim(addr))) filter (where btrim(addr) <> ''),
             '["higradeplumbing@gmail.com"]'::jsonb)
      into v_to
      from unnest(string_to_array(
             coalesce((select value from public.settings where key = 'lead_notify_to'), ''), ',')) as addr;

    perform net.http_post(
      url  := 'https://higrade-invoicing.vercel.app/api/send-email',
      body := jsonb_build_object(
                'to',         v_to,
                'subject',    v_subject,
                'clientName', coalesce(v_c.name, 'Customer'),
                'invoiceId',  v_doc,
                'total',      '',
                'message',    v_body,
                'bccAdmin',   false),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 20000);
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok',        true,
    'action',    p_action,
    'was',       v_when,
    'wants',     v_newwhen,
    'what',      v_what);
end;
$$;

revoke execute on function public.request_visit_change(text, text, text, text, text, text) from public;
grant  execute on function public.request_visit_change(text, text, text, text, text, text) to anon, authenticated;

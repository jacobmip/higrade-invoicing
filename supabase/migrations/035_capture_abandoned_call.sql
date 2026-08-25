-- 035_capture_abandoned_call.sql
-- ─── Never lose a caller, even when they hang up mid-call ───────────────────
--
-- Lisa files the estimate at the end of the call, once she has collected
-- everything. That gives complete, properly priced estimates, which is what
-- Jake wants. It also means a caller who hangs up part-way leaves NO record
-- at all: no estimate, no email, no phone number to ring back.
--
-- That is not hypothetical. A live test call on 2026-08-25 ran 87 seconds,
-- the caller hung up while Lisa was still collecting, and nothing whatsoever
-- was recorded. On an emergency plumbing line, stressed callers hang up.
--
-- This is the safety net. Vapi's end-of-call report hits
-- /api/vapi-call-ended, which calls this function. If the call already
-- produced a lead, it does nothing. If it did not, it files one from the
-- caller ID and the transcript so there is always something to follow up on.
--
-- Caller ID is what makes this worth doing: even a ten second call yields a
-- real, dialable number.

create or replace function public.capture_abandoned_call(
  p_secret     text,
  p_caller_id  text,
  p_call_id    text default null,
  p_transcript text default null,
  p_summary    text default null,
  p_name       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret   text;
  v_digits   text;
  v_existing text;
  v_lead     text;
  v_result   jsonb;
  v_problem  text;
  v_notes    text;
begin
  select value into v_secret from public.settings where key = 'sms_webhook_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing webhook secret';
  end if;

  v_digits := right(regexp_replace(coalesce(p_caller_id, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then
    return jsonb_build_object('skipped', 'no usable caller id');
  end if;

  -- Did this call already file a lead? Match on phone within a short window
  -- rather than call id, because create_estimate_from_lead does not record
  -- one. 30 minutes is far longer than any real call and short enough that a
  -- genuine second call later in the day still gets its own estimate.
  select id into v_existing
    from public.invoices
   where source = 'ai_lead'
     and created_at > now() - interval '30 minutes'
     and right(regexp_replace(coalesce(client_info->>'phone', ''), '\D', '', 'g'), 10) = v_digits
   order by created_at desc
   limit 1;

  if v_existing is not null then
    return jsonb_build_object('skipped', 'lead already filed', 'estimate_id', v_existing);
  end if;

  -- Best effort at a problem description so the price book has something to
  -- match. Falls back to a marker rather than inventing detail.
  v_problem := nullif(btrim(coalesce(p_summary, '')), '');
  if v_problem is null then
    v_problem := 'Caller hung up before details were collected. See transcript in notes.';
  end if;

  select public.create_estimate_from_lead(
           (select value from public.settings where key = 'lead_secret'),
           coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Missed call - no name given'),
           null,                    -- nothing spoken, rely on caller id
           null,                    -- no address
           v_problem,
           'unknown - call ended early',
           null, null, null, null,
           null,                    -- no service match, office will price it
           null,                    -- no appointment
           p_caller_id
         ) into v_result;

  v_lead := v_result->>'estimate_id';

  -- Append the raw transcript so Jake can read exactly how far they got.
  v_notes := coalesce((select internal_notes from public.invoices where id = v_lead), '')
             || E'\n\n--- ABANDONED CALL ---'
             || E'\nThe caller hung up before Lisa finished collecting details.'
             || coalesce(E'\nVapi call id: ' || p_call_id, '')
             || coalesce(E'\n\nTranscript:\n' || p_transcript, E'\n\n(no transcript captured)');

  perform public.set_invoice_internal_notes(v_lead, v_notes);

  return jsonb_build_object(
    'created',     true,
    'estimate_id', v_lead,
    'phone',       v_result->>'phone'
  );
end;
$$;

revoke execute on function public.capture_abandoned_call(text, text, text, text, text, text) from public;
grant  execute on function public.capture_abandoned_call(text, text, text, text, text, text) to anon, authenticated;

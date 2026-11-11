-- 124_visit_change_channel.sql
-- ─── Say where a visit change request came from (v1.72.4) ───────────────────
--
-- request_visit_change() (114) is called by phone Lisa (Vapi) AND by Lisa on
-- Yelp (api/_lib/yelp-booking.js requestChange). Its notification, email and
-- history text always said "<name> called Lisa", so a Yelp request (Dan,
-- 2026-11-11) read as a phone call that has no recording. The Yelp caller
-- already marks its reason "Yelp: ..." or "Requested on Yelp", so the function
-- reads the channel from that: no new parameter, no signature change, no
-- overload for Vapi's named-argument call to trip over.
--
-- Patched on the LIVE definition by anchors (CLAUDE.md: never rebuild a live
-- function from an old file). Each anchor must occur exactly once or nothing
-- is changed. Re-running is a no-op.
--
-- Also corrects the notifications already written for Yelp requests.

begin;

do $mig$
declare
  v_def text;
  v_yelp text := $a$coalesce(p_reason, '') ~* '^(yelp:|requested on yelp)'$a$;
  v_pairs text[][] := array[
    array[$a$' called Lisa and asked to MOVE their visit.'$a$,
          $a$(case when $a$ || v_yelp || $a$ then ' asked on Yelp to MOVE their visit.' else ' called Lisa and asked to MOVE their visit.' end)$a$],
    array[$a$' called Lisa and asked to CANCEL their visit.'$a$,
          $a$(case when $a$ || v_yelp || $a$ then ' asked on Yelp to CANCEL their visit.' else ' called Lisa and asked to CANCEL their visit.' end)$a$],
    array[$a$'via', 'lisa')$a$,
          $a$'via', case when $a$ || v_yelp || $a$ then 'lisa_yelp' else 'lisa' end)$a$]
  ];
  v_i int;
  v_n int;
begin
  v_def := pg_get_functiondef('public.request_visit_change(text, text, text, text, text, text)'::regprocedure);
  if position('asked on Yelp' in v_def) > 0 then
    raise notice '124 already applied, nothing to do';
    return;
  end if;
  for v_i in 1 .. array_length(v_pairs, 1) loop
    v_n := (length(v_def) - length(replace(v_def, v_pairs[v_i][1], ''))) / length(v_pairs[v_i][1]);
    if v_n <> 1 then
      raise exception '124: anchor % found % times in the live definition, expected 1. Nothing changed.', v_pairs[v_i][1], v_n;
    end if;
    v_def := replace(v_def, v_pairs[v_i][1], v_pairs[v_i][2]);
  end loop;
  execute v_def;
end
$mig$;

-- Notifications already written for Yelp requests.
update public.notifications
   set body = replace(body, ' called Lisa and asked to', ' asked on Yelp to')
 where type = 'visit_change'
   and body like '% called Lisa and asked to%'
   and (body like '%Reason: Yelp:%' or body like '%Reason: Requested on Yelp%');

commit;

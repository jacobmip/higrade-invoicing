-- 062_lead_channel_attribution.sql
-- ─── Where the lead came from, as a column you can group by ─────────────────
--
-- Goal: know which marketing actually pays. Not lead counts, revenue. Because
-- leads here become estimates and estimates become invoices, a channel stamped
-- on the estimate lets one query answer "what did Yelp earn us last quarter".
--
-- ─── Why this does NOT reuse invoices.source ────────────────────────────────
--
-- The obvious move is to write 'web_yelp' into invoices.source instead of the
-- hardcoded 'ai_lead'. That would silently break two things:
--
--   trg_notify_owner_of_lead   (026)  when (NEW.source = 'ai_lead')
--   trg_push_lead_appointment  (033)  when (NEW.source = 'ai_lead')
--
-- The first is the email and SMS alert. The second pushes the requested
-- appointment to Google Calendar. Both are WHEN-gated on that exact string, so
-- a web lead with a different source would create an estimate that never
-- alerts anybody and never reaches the calendar. It would look like it worked.
--
-- That is the same shape as the bug that cost 41 days of website leads: a
-- change that passes every test except the one nobody wrote. So source keeps
-- meaning "this arrived through the automated lead pipeline" and stays
-- 'ai_lead' for every lead, phone or web. Attribution gets its own column,
-- which nothing branches on.
--
-- ─── Shape ──────────────────────────────────────────────────────────────────
--
-- lead_channel is a short slug: 'yelp', 'google_ads', 'truck', 'flyer_kaimuki',
-- 'phone'. Normalised on the way in, so the website cannot poison reporting
-- with casing or punctuation variants. NULL on every historical row, which is
-- honest: we did not know.

alter table public.invoices
  add column if not exists lead_channel text;

comment on column public.invoices.lead_channel is
  'Marketing channel this lead came from, as a lowercase slug (yelp, google_ads, truck). '
  'Set by create_estimate_from_lead. NULL means unknown, including every row before 2026-10-18. '
  'Deliberately separate from source, which stays ''ai_lead'' because two triggers are gated on it.';

-- Phone leads through Lisa are a channel too, and the most important one to
-- compare against. Everything before today is genuinely unknown, so it stays
-- NULL rather than being guessed at.
-- created_at is the real clock; `date` is a plain date the function sets to
-- current_date and the app lets you edit on the document.
update public.invoices
   set lead_channel = 'phone'
 where source = 'ai_lead'
   and lead_channel is null
   and created_at >= timestamptz '2026-10-18 00:00+00';

-- New 14-arg signature; the 13-arg version from 030 is dropped to avoid
-- overload ambiguity, same as 030 did to 025.
drop function if exists public.create_estimate_from_lead(
  text, text, text, text, text, text, text, text, text, text, text[], text, text
);

create or replace function public.create_estimate_from_lead(
  p_secret          text,
  p_name            text,
  p_phone           text default null,
  p_address         text default null,
  p_problem         text default null,
  p_urgency         text default null,
  p_callback_window text default null,
  p_owner_or_tenant text default null,
  p_new_or_existing text default null,
  p_heard_from      text default null,
  p_services        text[] default null,
  p_appointment     text default null,  -- ISO local 'YYYY-MM-DDTHH:MM' Hawaii time
  p_caller_id       text default null,  -- Vapi {{customer.number}}, E.164
  p_lead_channel    text default null   -- 'yelp', 'google_ads', 'truck'; defaults to 'phone'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_owner    constant uuid := '0a3bcefd-6faf-4bae-b43b-cd4492dd9938';
  v_secret        text;
  v_spoken        text;
  v_callerid      text;
  v_phone_raw     text;
  v_phone_src     text;
  v_phone_out     text;
  v_phone_digits  text;
  v_client_id     clients.id%type;
  v_is_new_client boolean := false;
  v_num           int;
  v_max           int;
  v_persisted     int;
  v_id            text;
  v_token         text := replace(gen_random_uuid()::text, '-', '');
  v_internal      text;
  v_job_address   jsonb;
  v_client_info   jsonb;
  v_svc           text;
  v_item          record;
  v_sort          int := 0;
  v_matched       int := 0;
  v_channel       text;
begin
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'INVALID_INPUT: caller name is required';
  end if;

  -- Normalise rather than reject. A caller sending 'Yelp!' or 'Google Ads'
  -- means a real channel and should not be dropped on the floor, but it must
  -- not create a second spelling either: one spelling per channel, or the
  -- reporting splits in half and every number is wrong.
  v_channel := lower(btrim(coalesce(p_lead_channel, '')));
  v_channel := regexp_replace(v_channel, '[^a-z0-9]+', '_', 'g');
  v_channel := btrim(v_channel, '_');
  v_channel := left(nullif(v_channel, ''), 40);
  v_channel := coalesce(v_channel, 'phone');

  -- Resolve the phone number. Spoken wins over caller ID.
  v_spoken := nullif(btrim(coalesce(p_phone, '')), '');

  v_callerid := nullif(btrim(coalesce(p_caller_id, '')), '');
  if v_callerid is not null
     and (lower(v_callerid) in ('anonymous', 'unavailable', 'restricted', 'private')
          or regexp_replace(v_callerid, '\D', '', 'g') = '266696687'
          or length(regexp_replace(v_callerid, '\D', '', 'g')) < 10)
  then
    v_callerid := null;  -- withheld or unusable
  end if;

  v_phone_raw := coalesce(v_spoken, v_callerid);
  v_phone_src := case
                   when v_spoken   is not null then 'given by caller'
                   when v_callerid is not null then 'caller ID'
                   else 'not captured'
                 end;

  v_phone_digits := right(regexp_replace(coalesce(v_phone_raw, ''), '\D', '', 'g'), 10);

  -- Store in a consistent (808) 555-1234 shape when we have 10 clean digits.
  v_phone_out := case
                   when length(v_phone_digits) = 10
                     then '(' || substr(v_phone_digits, 1, 3) || ') '
                          || substr(v_phone_digits, 4, 3) || '-'
                          || substr(v_phone_digits, 7, 4)
                   else v_phone_raw
                 end;

  if length(v_phone_digits) = 10 then
    select id into v_client_id
      from public.clients
     where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_phone_digits
        or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_phone_digits
     order by created_at asc
     limit 1;
  end if;

  if v_client_id is null then
    insert into public.clients (name, mobile, address1)
    values (p_name, v_phone_out, nullif(trim(coalesce(p_address, '')), ''))
    returning id into v_client_id;
    v_is_new_client := true;
  end if;

  select max((regexp_replace(id, '\D', '', 'g'))::int) into v_max
    from public.invoices
   where type = 'estimate' and id ~ '^EST[0-9]+$';
  select nullif(value, '')::int into v_persisted
    from public.settings where key = 'next_estimate_num';
  v_num := greatest(coalesce(v_persisted, 1), coalesce(v_max, 0) + 1, 712);
  loop
    v_id := 'EST' || lpad(v_num::text, 4, '0');
    exit when not exists (select 1 from public.invoices where id = v_id);
    v_num := v_num + 1;
  end loop;

  -- The first line is load-bearing: 031 and 032 strip it from the emailed copy
  -- by matching '^AI receptionist \(Lisa\) lead'. Keep the wording byte for
  -- byte or the bookkeeping header starts showing up in the alert again.
  --
  -- 'Channel:' is deliberately NOT stripped. When a lead comes off the website
  -- rather than the phone, that is the first thing worth knowing.
  v_internal :=
      'AI receptionist (Lisa) lead - ' || to_char(now(), 'Mon DD, HH12:MI AM') || E'\n' ||
      'Phone source: '      || v_phone_src || E'\n' ||
      'Channel: '           || v_channel || E'\n' ||
      'Caller''s words: '   || coalesce(nullif(trim(p_problem), ''), '(not specified)') || E'\n' ||
      'Urgency: '           || coalesce(nullif(trim(p_urgency), ''), '(not specified)') || E'\n' ||
      'Preferred callback: '|| coalesce(nullif(trim(p_callback_window), ''), '(not specified)') || E'\n' ||
      'Owner/Tenant: '      || coalesce(nullif(trim(p_owner_or_tenant), ''), '(not specified)') || E'\n' ||
      'New/Existing: '      || coalesce(nullif(trim(p_new_or_existing), ''), '(not specified)') || E'\n' ||
      'Heard about us: '    || coalesce(nullif(trim(p_heard_from), ''), '(not specified)');

  v_job_address := case
    when nullif(trim(coalesce(p_address, '')), '') is not null
      then jsonb_build_object('label', 'Service address', 'line1', trim(p_address), 'line2', '', 'line3', '')
    else null
  end;

  v_client_info := jsonb_build_object(
    'name',     p_name,
    'phone',    v_phone_out,
    'address1', nullif(trim(coalesce(p_address, '')), '')
  );

  -- source stays 'ai_lead'. See the header: two triggers are gated on it.
  insert into public.invoices (
    id, type, client_id, client_name, date, status,
    notes, internal_notes, source, lead_channel, job_address, gcal_date, year,
    client_info, view_token, updated_at
  ) values (
    v_id, 'estimate', v_client_id, p_name, current_date, 'outstanding',
    '', v_internal, 'ai_lead', v_channel, v_job_address,
    nullif(trim(coalesce(p_appointment, '')), '')::timestamptz,
    extract(year from current_date)::int, v_client_info, v_token, now()
  );

  if p_services is not null then
    foreach v_svc in array p_services loop
      if coalesce(trim(v_svc), '') = '' then continue; end if;
      select name, description, price, unit, taxable into v_item
        from public.saved_items
       where owner_id = c_owner
         and (lower(name) = lower(trim(v_svc)) or name ilike '%' || trim(v_svc) || '%')
       order by (lower(name) = lower(trim(v_svc))) desc
       limit 1;
      if found then
        insert into public.invoice_items (invoice_id, name, description, qty, price, unit, taxable, sort_order)
        values (v_id, v_item.name, v_item.description, 1, v_item.price,
                coalesce(v_item.unit, 'each'), coalesce(v_item.taxable, false), v_sort);
        v_sort := v_sort + 1;
        v_matched := v_matched + 1;
      end if;
    end loop;
  end if;

  if v_matched = 0 then
    select name, description, price, unit, taxable into v_item
      from public.saved_items
     where owner_id = c_owner and lower(name) = 'service call / diagnostic'
     limit 1;
    if found then
      insert into public.invoice_items (invoice_id, name, description, qty, price, unit, taxable, sort_order)
      values (v_id, v_item.name, v_item.description, 1, v_item.price,
              coalesce(v_item.unit, 'each'), coalesce(v_item.taxable, false), 0);
    else
      insert into public.invoice_items (invoice_id, name, description, qty, price, unit, taxable, sort_order)
      values (v_id, 'Service Call / Diagnostic',
              coalesce(nullif(trim(p_problem), ''), 'See internal notes'), 1, 225, 'each', false, 0);
    end if;
  end if;

  insert into public.settings (key, value)
  values ('next_estimate_num', (v_num + 1)::text)
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object(
    'estimate_id',    v_id,
    'client_id',      v_client_id,
    'is_new_client',  v_is_new_client,
    'items_priced',   greatest(v_matched, 1),
    'appointment',    nullif(trim(coalesce(p_appointment, '')), ''),
    'phone',          v_phone_out,
    'phone_source',   v_phone_src,
    'lead_channel',   v_channel,
    'view_token',     v_token
  );
end;
$$;

grant execute on function public.create_estimate_from_lead(
  text, text, text, text, text, text, text, text, text, text, text[], text, text, text
) to anon, authenticated;

-- ─── The report this whole exercise exists for ──────────────────────────────
--
-- Revenue, not lead count. A channel sending four $200 drain clears loses to
-- one sending a single $4k repipe, and counting leads tells you the opposite.
-- Converted estimates are the ones that became real money.
-- There is no total column on invoices; a document's value is the sum of
-- qty * price on its line items. Discounts and tax are applied downstream in
-- the app, so this is GROSS line-item value and the column name says so. It is
-- the right number for comparing channels against each other, and the wrong
-- number to put on a tax return.
create or replace view public.lead_channel_performance as
with lead_value as (
  select
    i.id,
    coalesce(i.lead_channel, 'unknown') as channel,
    i.date,
    i.converted_to_id,
    coalesce((select sum(ii.qty * ii.price)
                from public.invoice_items ii
               where ii.invoice_id = i.id), 0) as gross
  from public.invoices i
  where i.source = 'ai_lead'
    -- Soft deletes are still rows. A deleted estimate counting toward a
    -- channel's performance would quietly inflate whichever channel Jake
    -- cleaned up after, which is the opposite of what this is for.
    and i.deleted_at is null
)
select
  channel,
  count(*)                                                   as leads,
  count(*) filter (where converted_to_id is not null)        as converted,
  round(100.0 * count(*) filter (where converted_to_id is not null)
        / nullif(count(*), 0), 1)                            as convert_pct,
  round(sum(gross) filter (where converted_to_id is not null), 2)
                                                             as gross_converted,
  round(avg(gross) filter (where converted_to_id is not null), 2)
                                                             as avg_converted_job,
  min(date)                                                  as first_lead,
  max(date)                                                  as last_lead
from lead_value
group by channel
order by gross_converted desc nulls last, leads desc;

comment on view public.lead_channel_performance is
  'Leads, conversion and gross converted value by marketing channel. gross_converted is the sum '
  'of qty*price on converted estimates, BEFORE discount and tax, so it compares channels but is '
  'not an accounting figure. Divide ad spend per channel by gross_converted for return on spend. '
  'Rows before 2026-10-18 show as ''unknown'' because the column did not exist.';

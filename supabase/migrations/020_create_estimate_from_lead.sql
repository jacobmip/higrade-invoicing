-- 020_create_estimate_from_lead.sql
-- ─── Turn an inbound AI-receptionist call into a draft estimate ──────────────
--
-- Called by the Vapi voice agent ("Lisa") at the end of a call. Takes the raw
-- lead details, matches or creates the client, and creates a DRAFT estimate
-- (type='estimate', no prices — Jake fills those in) using the same EST####
-- numbering the app itself uses, so the two never collide.
--
-- Numbering: mirrors db.js loadAll() — next number is
--   greatest(persisted settings.next_estimate_num, max existing EST id + 1).
-- We allocate inside the function and bump settings.next_estimate_num so the
-- browser app picks up the same next value on its next load.
--
-- Security: SECURITY DEFINER so it can insert past RLS, but gated by a shared
-- secret (settings.lead_secret). The caller (Vapi) must pass the matching
-- secret or the call is rejected. The secret is auto-generated on first run;
-- read it with:  select value from settings where key = 'lead_secret';

-- Generate a lead secret once, if one doesn't already exist.
-- gen_random_uuid() is built into Postgres 13+ (Supabase runs 15), no extension needed.
insert into public.settings (key, value)
values ('lead_secret', replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.create_estimate_from_lead(
  p_secret          text,
  p_name            text,
  p_phone           text,
  p_address         text default null,
  p_problem         text default null,
  p_urgency         text default null,
  p_callback_window text default null,
  p_owner_or_tenant text default null,
  p_new_or_existing text default null,
  p_heard_from      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret        text;
  v_phone_digits  text;
  v_client_id     clients.id%type;
  v_is_new_client boolean := false;
  v_num           int;
  v_max           int;
  v_persisted     int;
  v_id            text;
  v_token         text := replace(gen_random_uuid()::text, '-', '');
  v_notes         text;
  v_client_info   jsonb;
begin
  -- 1. Auth gate.
  select value into v_secret from public.settings where key = 'lead_secret';
  if p_secret is null or v_secret is null or p_secret <> v_secret then
    raise exception 'FORBIDDEN: bad or missing lead secret';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'INVALID_INPUT: caller name is required';
  end if;

  -- 2. Match an existing client on the last 10 digits of the phone.
  v_phone_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);

  if length(v_phone_digits) = 10 then
    select id into v_client_id
      from public.clients
     where right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 10) = v_phone_digits
        or right(regexp_replace(coalesce(phone,  ''), '\D', '', 'g'), 10) = v_phone_digits
     order by created_at asc
     limit 1;
  end if;

  -- 3. Create the client if there was no match.
  if v_client_id is null then
    insert into public.clients (name, mobile, address1)
    values (p_name, p_phone, nullif(trim(coalesce(p_address, '')), ''))
    returning id into v_client_id;
    v_is_new_client := true;
  end if;

  -- 4. Allocate the next EST#### number, collision-safe.
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

  -- 5. Assemble the notes block and the client_info snapshot.
  v_notes :=
      'Lead captured by AI receptionist (Lisa).' || E'\n' ||
      'Problem: '  || coalesce(nullif(trim(p_problem), ''), '(not specified)') || E'\n' ||
      'Urgency: '  || coalesce(nullif(trim(p_urgency), ''), '(not specified)') || E'\n' ||
      'Preferred callback: ' || coalesce(nullif(trim(p_callback_window), ''), '(not specified)') || E'\n' ||
      'Owner/Tenant: '  || coalesce(nullif(trim(p_owner_or_tenant), ''), '(not specified)') || E'\n' ||
      'New/Existing: '  || coalesce(nullif(trim(p_new_or_existing), ''), '(not specified)') || E'\n' ||
      'Heard about us: '|| coalesce(nullif(trim(p_heard_from), ''), '(not specified)') || E'\n' ||
      'Phone: '   || coalesce(p_phone, '(none)') || E'\n' ||
      'Address: ' || coalesce(nullif(trim(p_address), ''), '(none)');

  v_client_info := jsonb_build_object(
    'name',     p_name,
    'phone',    p_phone,
    'address1', nullif(trim(coalesce(p_address, '')), '')
  );

  -- 6. Create the draft estimate. Columns with defaults (tax, discount, …) are
  --    left unset so the table defaults apply, exactly like a normal save.
  insert into public.invoices (
    id, type, client_id, client_name, date, status, notes, year,
    client_info, view_token, updated_at
  ) values (
    v_id, 'estimate', v_client_id, p_name, current_date, 'outstanding', v_notes,
    extract(year from current_date)::int, v_client_info, v_token, now()
  );

  -- 7. One placeholder line item so the estimate isn't empty; Jake prices it.
  insert into public.invoice_items (invoice_id, name, description, qty, price, unit, taxable, sort_order)
  values (v_id, 'Service call (from phone lead)',
          coalesce(nullif(trim(p_problem), ''), 'See notes'), 1, 0, 'ea', true, 0);

  -- 8. Advance the shared counter so the browser app stays in sync.
  insert into public.settings (key, value)
  values ('next_estimate_num', (v_num + 1)::text)
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object(
    'estimate_id',   v_id,
    'client_id',     v_client_id,
    'is_new_client', v_is_new_client,
    'view_token',    v_token
  );
end;
$$;

grant execute on function public.create_estimate_from_lead(
  text, text, text, text, text, text, text, text, text, text
) to anon, authenticated;

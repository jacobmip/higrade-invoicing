-- 069_assigned_tech_can_work_the_job.sql
--
-- Make a job assigned to an apprentice actually usable by that apprentice,
-- and stop every logged-in account from reading the phone-system secrets.
--
-- THE PROBLEM THIS FIXES
-- Migration 053 widened only `invoices_select` to the assigned tech. Verified
-- against production on 2026-10-26 by assuming the test account's identity:
-- assigning a job to a non-admin got them the invoice row and nothing else.
-- Line items, the client record, payments, the version history and every
-- write were all still gated on `owner_id = auth.uid() OR is_admin()`, so the
-- job showed up as a client name, an address and a calendar slot with no
-- scope of work, a $0 total, no phone number and no way to save anything.
--
-- THE MODEL
-- Access to a document's children is decided by the PARENT INVOICE, not by
-- who happened to insert the child row. `owner_id` on invoice_items and
-- payments is set by a trigger to whoever wrote them, which makes it useless
-- as an access key the moment two people touch one job.
--
-- WHAT THE ASSIGNED TECH CAN AND CANNOT DO
--   can:    read and edit the jobs assigned to him, including line items,
--           pricing, payments, the client's contact record, photos, history
--   cannot: delete or trash a job, restore one, reassign it to anyone else
--           (including unassigning himself, which would hide it from his own
--           list), or touch any job that is not assigned to him
--
-- Every policy here is ADDITIVE. Permissive policies OR together, so nothing
-- an owner or an admin could do before changes.

begin;

-- ── 1. Two linkage helpers ──────────────────────────────────────────────────
-- SECURITY DEFINER on purpose. A policy on invoice_items that queries invoices
-- would otherwise re-enter the invoices policies on every row; the definer
-- boundary evaluates the lookup once against the real table. auth.uid() reads
-- a GUC, so it survives the boundary — same pattern as is_admin().
--
-- Both are STABLE, so the planner evaluates them once per statement per
-- argument rather than once per row.
--
-- Neither leaks: each answers one yes/no question about the caller's own
-- assignments and returns nothing about anybody else's work.

create or replace function public.is_my_assigned_job(p_invoice_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.invoices i
     where i.id = p_invoice_id
       and i.assigned_tech_id = auth.uid()
       and i.deleted_at is null
  );
$$;

comment on function public.is_my_assigned_job(text) is
  'True when the calling user is the assigned tech on this live document. '
  'The access key for every child row of an invoice (migration 069).';

create or replace function public.is_my_assigned_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.invoices i
     where i.client_id = p_client_id
       and i.assigned_tech_id = auth.uid()
       and i.deleted_at is null
  );
$$;

comment on function public.is_my_assigned_client(uuid) is
  'True when the calling user has at least one live job assigned to them for '
  'this client. Grants the contact record, not the client''s whole history.';

-- is_my_assigned_client filters on client_id and there was no index on it:
-- without this the policy is a sequential scan of invoices per client row.
create index if not exists invoices_client_id_idx
  on public.invoices (client_id)
  where deleted_at is null;

-- ── 2. The invoice itself: edit, but do not trash or reassign ───────────────
-- UPDATE only. DELETE stays with the owner and the admin.
--
-- `deleted_at is null` on BOTH sides is what blocks the trash button: the new
-- row may not carry a deleted_at (no soft-delete) and the old row may not have
-- one either (no restore).
--
-- `assigned_tech_id = auth.uid()` in the WITH CHECK is what stops him handing
-- the job to someone else or unassigning himself.
drop policy if exists invoices_update_assigned on public.invoices;
create policy invoices_update_assigned on public.invoices
  for update
  using      (assigned_tech_id = auth.uid() and deleted_at is null)
  with check (assigned_tech_id = auth.uid() and deleted_at is null);

-- ── 3. Line items and payments: keyed on the parent job ────────────────────
-- Both are FOR ALL because save_invoice_with_items does a DELETE-then-INSERT
-- of the whole set on every save. Read without write would be worse than
-- nothing here: the RPC's `delete from payments where invoice_id = ...` is
-- silently filtered to zero rows by RLS rather than erroring, so the tech's
-- client would read the payments, send them straight back, delete none and
-- insert copies — a duplicate payment row per save. That exact class of bug
-- has already cost this database a $18k repair script.
drop policy if exists invoice_items_assigned on public.invoice_items;
create policy invoice_items_assigned on public.invoice_items
  for all
  using      (public.is_my_assigned_job(invoice_id))
  with check (public.is_my_assigned_job(invoice_id));

drop policy if exists payments_assigned on public.payments;
create policy payments_assigned on public.payments
  for all
  using      (public.is_my_assigned_job(invoice_id))
  with check (public.is_my_assigned_job(invoice_id));

-- ── 4. The client's contact record ─────────────────────────────────────────
-- He needs the phone number to call ahead and the address to find the place.
-- Scoped to clients he has a live job for — not the whole book.
--
-- UPDATE is included because the person standing at the door is the one who
-- finds out the gate code or the real unit number. Every such edit is
-- snapshotted into client_versions by the app, so it is auditable.
-- INSERT and DELETE are deliberately not granted.
drop policy if exists clients_assigned_select on public.clients;
create policy clients_assigned_select on public.clients
  for select
  using (public.is_my_assigned_client(id));

drop policy if exists clients_assigned_update on public.clients;
create policy clients_assigned_update on public.clients
  for update
  using      (public.is_my_assigned_client(id))
  with check (public.is_my_assigned_client(id));

-- ── 5. History and send events, read-only ──────────────────────────────────
-- Not cosmetic. recordInvoiceVersion() computes the next version number by
-- reading back the highest one it can SEE. Without this, a tech sending an
-- estimate Jake had already sent once would read zero rows, call it version 1
-- and write a second row labelled v1 over the top of the real history.
drop policy if exists invoice_versions_assigned on public.invoice_versions;
create policy invoice_versions_assigned on public.invoice_versions
  for select using (public.is_my_assigned_job(invoice_id));

drop policy if exists invoice_events_assigned on public.invoice_events;
create policy invoice_events_assigned on public.invoice_events
  for select using (public.is_my_assigned_job(invoice_id));

drop policy if exists client_versions_assigned on public.client_versions;
create policy client_versions_assigned on public.client_versions
  for select using (public.is_my_assigned_client(client_id));

-- ── 6. Job photos: stop showing every job's photos to everybody ────────────
-- Was `for all using (true)` to authenticated, which is 222 photos of every
-- customer's house to any account that can log in. Replaced with the same
-- parent-document rule: you see the photos for the jobs you can see.
--
-- The EXISTS is deliberately NOT a definer helper — it runs under the caller's
-- own invoices policies, which is exactly the intent ("jobs I can see",
-- whether I own them, am assigned them, or am admin).
--
-- The public estimate page is unaffected: api/public-invoice.js reads this
-- table server-side under its own key, and this policy only ever applied to
-- the `authenticated` role.
drop policy if exists job_photos_auth_all on public.job_photos;
create policy job_photos_scoped on public.job_photos
  for all
  to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.invoices i where i.id = job_photos.invoice_id)
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.invoices i where i.id = job_photos.invoice_id)
  );

-- ── 7. Stop a save from transferring ownership of the job ──────────────────
-- Rebuilt from the LIVE definition pulled 2026-10-26 (per CLAUDE.md: never
-- from an old migration file). Exactly one line differs, marked CHANGED.
--
-- Why it has to change now. The ON CONFLICT branch ended with
-- `owner_id = excluded.owner_id`, and excluded.owner_id is whatever the
-- BEFORE INSERT trigger stamped for the caller. Migration 053's own header
-- called this out as the reason owner_id is unusable for incentive pay. It
-- was survivable while only the owner could write. Now that the assigned tech
-- can write, the first time the apprentice saves Jake's job the document
-- changes hands — it would leave Jake's name on nothing and move it under the
-- apprentice in the per-user counts and the view-as-user filter.
--
-- coalesce() keeps the original owner and still stamps one on a row that
-- somehow has none. Deliberate ownership transfer is unaffected: it goes
-- through claimInvoiceOwner(), which only ever runs on a freshly minted
-- document.

CREATE OR REPLACE FUNCTION public.save_invoice_with_items(inv jsonb, items jsonb DEFAULT '[]'::jsonb, payments jsonb DEFAULT '[]'::jsonb, expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, is_new boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  inv_id           text := inv->>'id';
  current_updated  timestamptz;
  next_num         int;
  result           jsonb;
begin
  if inv_id is null or inv_id = '' then
    raise exception 'INVALID_INPUT: invoice id is required';
  end if;

  if expected_updated_at is not null and not is_new then
    select updated_at into current_updated
      from public.invoices where id = inv_id;
    if current_updated is not null and current_updated <> expected_updated_at then
      raise exception 'CONCURRENT_EDIT: invoice was modified on another device (db=% expected=%)',
        current_updated, expected_updated_at;
    end if;
  end if;

  insert into public.invoices (
    id, type, client_id, client_name, date, due_date, status,
    tax, discount, discount_type, notes, internal_notes, year,
    gcal_date, gcal_event_id, follow_up_date, follow_up_event_id,
    signature_data, signed_at, client_info, converted_to_id, view_token,
    job_address, billing_address,
    down_payment_pct, down_payment_invoice_id,
    late_fee_waived,
    assigned_tech_id,
    updated_at
  ) values (
    inv_id,
    coalesce(inv->>'type', 'invoice'),
    nullif(inv->>'client_id', '')::uuid,
    coalesce(inv->>'client_name', ''),
    nullif(inv->>'date', '')::date,
    nullif(inv->>'due_date', '')::date,
    coalesce(inv->>'status', 'outstanding'),
    coalesce((inv->>'tax')::numeric, 4.712),
    coalesce((inv->>'discount')::numeric, 0),
    coalesce(inv->>'discount_type', '$'),
    coalesce(inv->>'notes', ''),
    coalesce(inv->>'internal_notes', ''),
    nullif(inv->>'year', '')::int,
    to_char(nullif(inv->>'gcal_date', '')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
    nullif(inv->>'gcal_event_id', ''),
    nullif(inv->>'follow_up_date', '')::timestamptz,
    nullif(inv->>'follow_up_event_id', ''),
    nullif(inv->>'signature_data', ''),
    nullif(inv->>'signed_at', '')::timestamptz,
    case when inv ? 'client_info' and inv->'client_info' <> 'null'::jsonb
         then inv->'client_info' else null end,
    nullif(inv->>'converted_to_id', ''),
    nullif(inv->>'view_token', ''),
    case when inv ? 'job_address' and inv->'job_address' <> 'null'::jsonb
         then inv->'job_address' else null end,
    case when inv ? 'billing_address' and inv->'billing_address' <> 'null'::jsonb
         then inv->'billing_address' else null end,
    coalesce((inv->>'down_payment_pct')::smallint, 0),
    nullif(inv->>'down_payment_invoice_id', ''),
    coalesce((inv->>'late_fee_waived')::boolean, false),
    case when inv->>'assigned_tech_id' = 'none' then null
         else coalesce(nullif(inv->>'assigned_tech_id', '')::uuid, auth.uid()) end,
    now()
  )
  on conflict (id) do update set
    type               = excluded.type,
    client_id          = excluded.client_id,
    client_name        = excluded.client_name,
    date               = excluded.date,
    due_date           = excluded.due_date,
    status             = excluded.status,
    tax                = excluded.tax,
    discount           = excluded.discount,
    discount_type      = excluded.discount_type,
    notes              = excluded.notes,
    internal_notes     = case
                           when inv ? 'internal_notes' then excluded.internal_notes
                           else public.invoices.internal_notes
                         end,
    year               = excluded.year,
    gcal_date          = excluded.gcal_date,
    gcal_event_id      = excluded.gcal_event_id,
    follow_up_date     = excluded.follow_up_date,
    follow_up_event_id = excluded.follow_up_event_id,
    signature_data     = excluded.signature_data,
    signed_at          = excluded.signed_at,
    client_info        = excluded.client_info,
    converted_to_id    = excluded.converted_to_id,
    view_token         = coalesce(excluded.view_token, public.invoices.view_token),
    job_address        = excluded.job_address,
    billing_address    = excluded.billing_address,
    down_payment_pct   = excluded.down_payment_pct,
    down_payment_invoice_id = coalesce(excluded.down_payment_invoice_id, public.invoices.down_payment_invoice_id),
    late_fee_waived    = excluded.late_fee_waived,
    assigned_tech_id   = case
                           when inv->>'assigned_tech_id' = 'none' then null
                           else coalesce(nullif(inv->>'assigned_tech_id', '')::uuid,
                                         public.invoices.assigned_tech_id)
                         end,
    -- CHANGED (069): never restamp ownership. excluded.owner_id is whatever
    -- the BEFORE INSERT trigger stamped for the *caller*, so the old line
    -- handed the document to whoever saved it last. With an assigned tech who
    -- can now edit, that meant the apprentice silently took ownership of
    -- Jake's job the first time he saved it. Ownership changes only through
    -- claimInvoiceOwner(), which is called on a brand-new document.
    owner_id           = coalesce(public.invoices.owner_id, excluded.owner_id),
    updated_at         = now();

  delete from public.invoice_items where invoice_id = inv_id;

  if jsonb_array_length(items) > 0 then
    insert into public.invoice_items (
      invoice_id, name, description, qty, price, unit,
      discount, discount_type, taxable, sort_order
    )
    select
      inv_id,
      coalesce(it->>'name', ''),
      coalesce(it->>'description', ''),
      coalesce((it->>'qty')::numeric, 1),
      coalesce((it->>'price')::numeric, 0),
      coalesce(it->>'unit', 'ea'),
      coalesce((it->>'discount')::numeric, 0),
      coalesce(it->>'discount_type', '%'),
      coalesce((it->>'taxable')::boolean, true),
      coalesce((it->>'sort_order')::int, idx::int - 1)
    from jsonb_array_elements(items) with ordinality as t(it, idx);
  end if;

  delete from public.payments
   where invoice_id = inv_id
     and paypal_capture_id is null;

  if jsonb_array_length(payments) > 0 then
    insert into public.payments (
      invoice_id, amount, method, date, note,
      paypal_order_id, paypal_capture_id, surcharge
    )
    select
      inv_id,
      coalesce((p->>'amount')::numeric, 0),
      coalesce(p->>'method', ''),
      nullif(p->>'date', '')::date,
      coalesce(p->>'note', ''),
      nullif(p->>'paypal_order_id', ''),
      nullif(p->>'paypal_capture_id', ''),
      coalesce((p->>'surcharge')::numeric, 0)
    from jsonb_array_elements(payments) as t(p)
    where (p->>'paypal_capture_id') is null
       or (p->>'paypal_capture_id') = '';
  end if;

  if is_new then
    next_num := (regexp_replace(inv_id, '[^0-9]', '', 'g'))::int + 1;
    if inv_id like 'EST%' then
      insert into public.settings (key, value)
        values ('next_estimate_num', next_num::text)
        on conflict (key) do update set value = greatest(
          excluded.value::int,
          (settings.value)::int
        )::text;
    else
      insert into public.settings (key, value)
        values ('next_num', next_num::text)
        on conflict (key) do update set value = greatest(
          excluded.value::int,
          (settings.value)::int
        )::text;
    end if;
  end if;

  select jsonb_build_object(
    'id', id,
    'updated_at', updated_at
  ) into result
  from public.invoices where id = inv_id;

  return result;
end;
$function$;

commit;

-- 099: soft-deleting an invoice/estimate deletes its Google Calendar events.
--
-- A BEFORE UPDATE trigger, so it covers every writer: the app, the chat agent,
-- the receptionist's RPCs, REST and psql. When deleted_at goes null -> a value
-- it collects the event ids (gcal_event_id and every visits[].eventId), asks
-- /api/gcal to delete them via pg_net, and clears gcal_event_id, gcal_date,
-- gcal_duration_minutes and visits on the row.
--
-- pg_net queues the request and sends it on commit, so a rolled-back delete
-- deletes nothing. It is fire-and-forget: a failed call (Google disconnected)
-- is not retried, see net._http_response.
--
-- An event id still referenced by another live document is NOT deleted. The
-- app's invoice -> estimate conversion saves the new estimate carrying the same
-- visits/event, then soft-deletes the source invoice; deleting the event there
-- would wipe the job's only calendar entry.
--
-- Restoring a deleted document does not bring its calendar event back.
--
-- sync_first_visit only acts on a non-empty visits array, so nulling visits
-- here is not undone by it. Auth to /api/gcal is the webhook secret, which
-- only the 'delete' op accepts.

begin;

create or replace function public.delete_gcal_events_on_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_ids    text[];
  v_id     text;
  v_secret text;
  v_base   text;
begin
  if not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;

  select array_agg(distinct e) into v_ids
    from (
      select nullif(btrim(new.gcal_event_id), '') as e
      union all
      select nullif(btrim(v->>'eventId'), '')
        from jsonb_array_elements(
               case when jsonb_typeof(new.visits) = 'array' then new.visits else '[]'::jsonb end
             ) v
    ) t
   where e is not null;

  if v_ids is not null then
    select value into v_secret from public.settings where key = 'sms_webhook_secret';
    select coalesce(nullif(btrim(value), ''), 'https://higrade-invoicing.vercel.app')
      into v_base from public.settings where key = 'app_base_url';
    v_base := coalesce(v_base, 'https://higrade-invoicing.vercel.app');

    if coalesce(v_secret, '') <> '' then
      foreach v_id in array v_ids loop
        -- Shared with another live document (conversion copy): leave it.
        if exists (
          select 1 from public.invoices o
           where o.id <> new.id and o.deleted_at is null
             and (o.gcal_event_id = v_id
                  or (jsonb_typeof(o.visits) = 'array'
                      and o.visits @> jsonb_build_array(jsonb_build_object('eventId', v_id))))
        ) then
          continue;
        end if;
        perform net.http_post(
          url     := v_base || '/api/gcal',
          body    := jsonb_build_object('op', 'delete', 'id', v_id),
          headers := jsonb_build_object('Content-Type', 'application/json',
                                        'Authorization', 'Bearer ' || v_secret),
          timeout_milliseconds := 15000
        );
      end loop;
    end if;
  end if;

  new.gcal_event_id         := null;
  new.gcal_date             := null;
  new.gcal_duration_minutes := null;
  new.visits                := null;
  return new;
end;
$function$;

drop trigger if exists aa_invoices_delete_gcal_events on public.invoices;
create trigger aa_invoices_delete_gcal_events
  before update of deleted_at on public.invoices
  for each row execute function public.delete_gcal_events_on_soft_delete();

commit;

-- V1.153 - official ANP synchronization and consented city-opening contact queue.
-- Existing merchant eligibility, global commerce switch and city pause stay authoritative.

-- Preserve human prospecting pipeline status and notes on official source refresh.
create or replace function public.upsert_anp_prospect_batch(p_rows jsonb)
returns integer
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_count integer:=0;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows)>100 then
    raise exception 'INVALID_ANP_BATCH' using errcode='22023';
  end if;
  insert into public.anp_glp_prospects(
    cnpj,state,city_key,city_name,legal_name,address_text,
    distributor,anp_authorization,sigaf_status,source_checked_at
  )
  select
    r.cnpj,r.state,r.city_key,r.city_name,r.legal_name,
    r.address_text,r.distributor,r.anp_authorization,r.sigaf_status,
    r.source_checked_at
  from jsonb_to_recordset(p_rows) as r(
    cnpj text,state text,city_key text,city_name text,legal_name text,
    address_text text,distributor text,anp_authorization text,
    sigaf_status text,source_checked_at timestamptz
  )
  where r.cnpj ~ '^[0-9]{14}$' and r.state ~ '^[A-Z]{2}$'
    and length(r.city_key) between 2 and 120 and length(r.legal_name)>1
  on conflict(cnpj) do update set
    state=excluded.state,city_key=excluded.city_key,
    city_name=excluded.city_name,legal_name=excluded.legal_name,
    address_text=excluded.address_text,distributor=excluded.distributor,
    anp_authorization=excluded.anp_authorization,
    sigaf_status=excluded.sigaf_status,source_checked_at=excluded.source_checked_at,
    updated_at=clock_timestamp();
  get diagnostics v_count=row_count;
  return v_count;
end;
$func$;
revoke all on function public.upsert_anp_prospect_batch(jsonb) from public,anon,authenticated;
grant execute on function public.upsert_anp_prospect_batch(jsonb) to service_role;

-- Track city interests across phones/CEPs without forcing any marketplace activation.
create or replace function public.discover_expansion_city()
returns trigger
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_city text:=trim(coalesce(new.city,''));
  v_state text:=upper(trim(coalesce(new.state,'')));
  v_key text:=public.market_city_key(v_city);
begin
  if length(v_city) between 2 and 120
    and v_state ~ '^[A-Z]{2}$' and length(v_key) between 2 and 120 then
    insert into public.market_cities(state,city_key,city_name)
    values(v_state,v_key,v_city)
    on conflict(state,city_key) do nothing;
  end if;
  return new;
end;
$func$;
revoke all on function public.discover_expansion_city() from public,anon,authenticated;
drop trigger if exists trg_market_interest_discovery on public.market_city_interests;
create trigger trg_market_interest_discovery
  after insert or update of city,state on public.market_city_interests
  for each row execute function public.discover_expansion_city();
drop trigger if exists trg_merchant_city_discovery on public.merchant_business_details;
create trigger trg_merchant_city_discovery
  after insert or update of city,state on public.merchant_business_details
  for each row execute function public.discover_expansion_city();

-- Seed only geographic metadata, NEVER fabricate partners or commerce availability.
insert into public.market_cities(state,city_key,city_name,ibge_code)
values('RS','SAO GABRIEL','São Gabriel','4318309')
on conflict(state,city_key) do nothing;

create table if not exists public.city_opening_notifications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.prelaunch_leads(id) on delete cascade,
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  city text not null check (length(city) between 2 and 120),
  state text not null check (state ~ '^[A-Z]{2}$'),
  notification_type text not null default 'city_ready'
    check (notification_type='city_ready'),
  channel text not null default 'whatsapp' check(channel='whatsapp'),
  status text not null default 'queued' check(status in ('queued','sent','skipped','cancelled')),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  handled_at timestamptz,
  handled_by uuid,
  note text,
  unique(lead_id,postal_code,notification_type)
);
create index if not exists city_opening_notifications_status_idx
  on public.city_opening_notifications(status,state,city,queued_at);
alter table public.city_opening_notifications enable row level security;
revoke all on public.city_opening_notifications from public,anon,authenticated;
grant all on public.city_opening_notifications to service_role;

-- Called only by trusted worker. Creates drafts, NEVER sends messages.
create or replace function public.queue_ready_city_notifications()
returns jsonb
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_added integer:=0;
  v_cancelled integer:=0;
begin
  -- Cancel unsent items when contact was revoked/closed or municipality is no longer ready.
  update public.city_opening_notifications n
  set status='cancelled',handled_at=clock_timestamp(),note='Cancelado por consentimento ou cobertura indisponível'
  from public.prelaunch_leads l
  where l.id=n.lead_id and n.status='queued'
    and (l.status='closed' or l.consent_at is null
      or not public.market_city_ready(n.city,n.state));
  get diagnostics v_cancelled=row_count;

  insert into public.city_opening_notifications(lead_id,postal_code,city,state)
  select i.lead_id,i.postal_code,i.city,i.state
  from public.market_city_interests i
  join public.prelaunch_leads l on l.id=i.lead_id
  where l.lead_type='customer'
    and l.consent_at is not null and l.status not in ('closed','converted')
    and i.city is not null and i.state is not null
    and public.market_city_ready(i.city,i.state)
    and not exists(
      select 1 from public.city_opening_notifications prev
      where prev.lead_id=i.lead_id and prev.postal_code=i.postal_code
        and prev.notification_type='city_ready'
    )
  order by i.last_seen_at desc
  limit 100
  on conflict(lead_id,postal_code,notification_type) do nothing;
  get diagnostics v_added=row_count;
  return jsonb_build_object('queued',v_added,'cancelled',v_cancelled);
end;
$func$;
revoke all on function public.queue_ready_city_notifications() from public,anon,authenticated;
grant execute on function public.queue_ready_city_notifications() to service_role;

create or replace function public.admin_handle_city_notification(
  p_actor_user_id uuid,p_notification_id uuid,p_status text,p_note text
)
returns jsonb
language plpgsql security definer
set search_path to pg_catalog
as $func$
declare
  v_row public.city_opening_notifications%rowtype;
begin
  if not exists (
    select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations')
  ) then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501'; end if;
  if p_status not in ('sent','skipped')
    or length(trim(coalesce(p_note,'')))<5 or length(p_note)>240 then
    raise exception 'INVALID_NOTIFICATION_ACTION' using errcode='22023';
  end if;
  select * into v_row from public.city_opening_notifications
  where id=p_notification_id for update;
  if not found then raise exception 'NOTIFICATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_row.status<>'queued' then
    raise exception 'NOTIFICATION_ALREADY_HANDLED' using errcode='55000';
  end if;
  update public.city_opening_notifications
    set status=p_status,handled_at=clock_timestamp(),handled_by=p_actor_user_id,
        sent_at=case when p_status='sent' then clock_timestamp() else null end,
        note=trim(p_note)
  where id=p_notification_id;

  insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
  values(p_actor_user_id,'city-opening-notification','city_notification',p_notification_id::text,
    jsonb_build_object('status',p_status,'city',v_row.city,'state',v_row.state,
      'postal_code',v_row.postal_code,'note',trim(p_note)));
  return jsonb_build_object('id',p_notification_id,'status',p_status);
end;
$func$;
revoke all on function public.admin_handle_city_notification(uuid,uuid,text,text)
from public,anon,authenticated;
grant execute on function public.admin_handle_city_notification(uuid,uuid,text,text) to service_role;


-- Serve the oldest stale city first, not just the first rows of a growing table.
create or replace function public.expansion_due_cities(p_limit integer default 4)
returns table(city text,state text,city_key text)
language sql stable security definer
set search_path to pg_catalog
as $func$
select c.city_name,c.state,c.city_key
from public.market_cities c
left join public.anp_prospect_refreshes r
  on r.state=c.state and r.city_key=c.city_key
where r.last_checked_at is null
  or r.last_checked_at<=statement_timestamp() -
    (case when r.status='unavailable' then interval '1 hour'
          else interval '24 hours' end)
order by r.last_checked_at asc nulls first,c.discovered_at asc
limit least(greatest(coalesce(p_limit,4),1),5);
$func$;
revoke all on function public.expansion_due_cities(integer)
from public,anon,authenticated;
grant execute on function public.expansion_due_cities(integer) to service_role;

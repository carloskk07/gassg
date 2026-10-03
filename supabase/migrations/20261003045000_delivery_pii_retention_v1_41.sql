-- Chama São Gabriel — delivery PII retention v1.41
-- Operational delivery contact/location data is minimized after terminal orders age out.
-- Financial/accounting/order history remains intact.

create table if not exists public.data_retention_policy (
  policy_key text primary key,
  terminal_delivery_pii_days smallint not null default 90
    check (terminal_delivery_pii_days between 7 and 730),
  updated_at timestamptz not null default now()
);

alter table public.data_retention_policy enable row level security;
revoke all on table public.data_retention_policy from public, anon, authenticated;
grant all on table public.data_retention_policy to service_role;

insert into public.data_retention_policy(
  policy_key,terminal_delivery_pii_days
)
values('default',90)
on conflict(policy_key) do nothing;

alter table public.orders
  add column if not exists delivery_pii_redacted_at timestamptz;

create index if not exists orders_delivery_pii_retention_idx
  on public.orders(updated_at)
  where status in ('SETTLED','CANCELLED')
    and delivery_pii_redacted_at is null;

create or replace function public.require_order_delivery_contact()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_phone text;
  v_status text;
  v_redacted_at timestamptz;
begin
  select
    o.customer_phone_digits,
    o.status,
    o.delivery_pii_redacted_at
  into
    v_phone,
    v_status,
    v_redacted_at
  from public.orders o
  where o.id=new.id;

  if v_phone is null or v_phone!~'^[0-9]{10,11}$' then
    if not (
      v_status in ('SETTLED','CANCELLED')
      and v_redacted_at is not null
    ) then
      raise exception 'ORDER_DELIVERY_CONTACT_REQUIRED' using errcode='23514';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.require_order_delivery_contact()
from public, anon, authenticated;
grant execute on function public.require_order_delivery_contact()
to postgres, service_role;

create or replace function public.process_data_retention()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_quotes integer:=0;
  v_actions integer:=0;
  v_pins integer:=0;
  v_rates integer:=0;
  v_requotes integer:=0;
  v_delivery_pii integer:=0;
  v_delivery_pii_days integer:=90;
begin
  select p.terminal_delivery_pii_days::integer
  into v_delivery_pii_days
  from public.data_retention_policy p
  where p.policy_key='default';

  v_delivery_pii_days:=coalesce(v_delivery_pii_days,90);

  delete from public.order_delivery_secrets s
  using public.orders o
  where o.id=s.order_id
    and o.status in ('SETTLED','CANCELLED')
    and o.updated_at<clock_timestamp()-interval '1 hour';
  get diagnostics v_pins=row_count;

  delete from public.quotes
  where expires_at<clock_timestamp()-interval '2 hours';
  get diagnostics v_quotes=row_count;

  delete from public.action_requests
  where coalesce(completed_at,created_at)<clock_timestamp()-interval '30 days';
  get diagnostics v_actions=row_count;

  delete from public.api_rate_limits
  where window_started_at<clock_timestamp()-interval '2 days';
  get diagnostics v_rates=row_count;

  delete from public.order_requote_items ri
  using public.orders o
  where o.id=ri.order_id
    and (
      o.status<>'REQUOTE_REQUIRED'
      or o.proposed_merchant_id is null
    );
  get diagnostics v_requotes=row_count;

  with candidates as (
    select o.id
    from public.orders o
    where o.status in ('SETTLED','CANCELLED')
      and o.delivery_pii_redacted_at is null
      and (
        case
          when o.status='SETTLED'
            then coalesce(o.settled_at,o.delivered_at,o.updated_at)
          else o.updated_at
        end
      ) < clock_timestamp()-make_interval(days=>v_delivery_pii_days)
      and not exists (
        select 1
        from public.support_cases sc
        where sc.order_id=o.id
          and sc.status in ('open','in_review')
      )
    order by o.updated_at
    limit 500
    for update skip locked
  ),
  redacted as (
    update public.orders o
    set address_text='[dados de entrega removidos]',
        customer_phone_digits=null,
        address_complement=null,
        delivery_reference=null,
        delivery_notes=null,
        delivery_pii_redacted_at=clock_timestamp()
    from candidates c
    where o.id=c.id
    returning o.id
  ),
  logged as (
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    select
      r.id,
      null,
      'system',
      'DELIVERY_PII_REDACTED',
      'Dados operacionais de entrega removidos',
      'Telefone, localização detalhada e instruções de chegada foram minimizados pela política de retenção.',
      jsonb_build_object(
        'retentionDays',v_delivery_pii_days
      )
    from redacted r
    returning 1
  )
  select count(*)::integer
  into v_delivery_pii
  from logged;

  return jsonb_build_object(
    'quotesDeleted',v_quotes,
    'actionsDeleted',v_actions,
    'deliverySecretsDeleted',v_pins,
    'rateBucketsDeleted',v_rates,
    'requoteSnapshotsDeleted',v_requotes,
    'deliveryPiiRedacted',v_delivery_pii,
    'deliveryPiiRetentionDays',v_delivery_pii_days
  );
end;
$$;

revoke all on function public.process_data_retention()
from public, anon, authenticated;
grant execute on function public.process_data_retention()
to postgres, service_role;

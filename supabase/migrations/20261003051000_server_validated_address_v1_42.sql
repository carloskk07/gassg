-- Chama São Gabriel — server-validated delivery address v1.42
-- CEP is resolved server-side and service area is keyed by official municipality IBGE code.

create table if not exists public.service_areas (
  ibge_code text primary key check (ibge_code~'^[0-9]{7}$'),
  city_name text not null check (char_length(trim(city_name)) between 2 and 120),
  uf text not null check (uf~'^[A-Z]{2}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_areas enable row level security;
revoke all on table public.service_areas from public, anon, authenticated;
grant all on table public.service_areas to service_role;

insert into public.service_areas(ibge_code,city_name,uf,active)
values('4318309','São Gabriel','RS',true)
on conflict(ibge_code) do update
set city_name=excluded.city_name,
    uf=excluded.uf,
    active=true,
    updated_at=clock_timestamp();

create table if not exists public.postal_code_cache (
  postal_code text primary key check (postal_code~'^[0-9]{8}$'),
  street text not null check (char_length(trim(street)) between 2 and 180),
  neighborhood text,
  city_name text not null check (char_length(trim(city_name)) between 2 and 120),
  uf text not null check (uf~'^[A-Z]{2}$'),
  ibge_code text not null check (ibge_code~'^[0-9]{7}$'),
  source text not null default 'viacep' check (source='viacep'),
  source_checked_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (neighborhood is null or char_length(neighborhood)<=160)
);

alter table public.postal_code_cache enable row level security;
revoke all on table public.postal_code_cache from public, anon, authenticated;
grant all on table public.postal_code_cache to service_role;

create index if not exists postal_code_cache_ibge_idx
  on public.postal_code_cache(ibge_code,source_checked_at desc);

alter table public.merchants
  add column if not exists service_area_ibge_code text not null default '4318309';

alter table public.merchants
  drop constraint if exists merchants_service_area_ibge_code_check,
  add constraint merchants_service_area_ibge_code_check
    check (service_area_ibge_code~'^[0-9]{7}
  add column if not exists postal_code text,
  add column if not exists address_number text;

alter table public.quotes
  drop constraint if exists quotes_postal_code_check,
  add constraint quotes_postal_code_check check (
    postal_code is null or postal_code~'^[0-9]{8}$'
  ),
  drop constraint if exists quotes_address_number_check,
  add constraint quotes_address_number_check check (
    address_number is null or address_number~'^[0-9]{1,6}[A-Za-z]?$'
  );

alter table public.orders
  add column if not exists delivery_postal_code text,
  add column if not exists delivery_address_number text;

alter table public.orders
  drop constraint if exists orders_delivery_postal_code_check,
  add constraint orders_delivery_postal_code_check check (
    delivery_postal_code is null or delivery_postal_code~'^[0-9]{8}$'
  ),
  drop constraint if exists orders_delivery_address_number_check,
  add constraint orders_delivery_address_number_check check (
    delivery_address_number is null or delivery_address_number~'^[0-9]{1,6}[A-Za-z]?$'
  );

create or replace function public.create_order_from_quote_v6(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null,
  p_cash_tender_cents integer default null,
  p_customer_phone text default null,
  p_address_complement text default null,
  p_delivery_reference text default null,
  p_delivery_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_postal_code text;
  v_address_number text;
begin
  select q.postal_code,q.address_number
  into v_postal_code,v_address_number
  from public.quotes q
  where q.id=p_quote_id
    and q.customer_id=p_user_id;

  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_postal_code is null
     or v_postal_code!~'^[0-9]{8}$'
     or v_address_number is null
     or v_address_number!~'^[0-9]{1,6}[A-Za-z]?$' then
    raise exception 'QUOTE_ADDRESS_NOT_VALIDATED' using errcode='22023';
  end if;

  v_result:=public.create_order_from_quote_v5(
    p_user_id,
    p_quote_id,
    p_payment_method,
    p_use_cashback,
    p_idempotency_key,
    p_request_hash,
    p_referral_code,
    p_cash_tender_cents,
    p_customer_phone,
    p_address_complement,
    p_delivery_reference,
    p_delivery_notes
  );

  v_order_id:=(v_result->>'orderId')::uuid;

  update public.orders
  set delivery_postal_code=v_postal_code,
      delivery_address_number=v_address_number
  where id=v_order_id
    and customer_id=p_user_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  return v_result||jsonb_build_object(
    'deliveryPostalCode',v_postal_code,
    'deliveryAddressNumber',v_address_number
  );
end;
$$;

revoke all on function public.create_order_from_quote_v6(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v6(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) to service_role;

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
        delivery_postal_code=null,
        delivery_address_number=null,
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
      jsonb_build_object('retentionDays',v_delivery_pii_days)
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
);

create index if not exists merchants_service_area_offer_idx
  on public.merchants(service_area_ibge_code,status,online,accepts_citywide,last_seen_at);

alter table public.quotes
  add column if not exists postal_code text,
  add column if not exists address_number text;

alter table public.quotes
  drop constraint if exists quotes_postal_code_check,
  add constraint quotes_postal_code_check check (
    postal_code is null or postal_code~'^[0-9]{8}$'
  ),
  drop constraint if exists quotes_address_number_check,
  add constraint quotes_address_number_check check (
    address_number is null or address_number~'^[0-9]{1,6}[A-Za-z]?$'
  );

alter table public.orders
  add column if not exists delivery_postal_code text,
  add column if not exists delivery_address_number text;

alter table public.orders
  drop constraint if exists orders_delivery_postal_code_check,
  add constraint orders_delivery_postal_code_check check (
    delivery_postal_code is null or delivery_postal_code~'^[0-9]{8}$'
  ),
  drop constraint if exists orders_delivery_address_number_check,
  add constraint orders_delivery_address_number_check check (
    delivery_address_number is null or delivery_address_number~'^[0-9]{1,6}[A-Za-z]?$'
  );

create or replace function public.create_order_from_quote_v6(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text,
  p_use_cashback boolean,
  p_idempotency_key text,
  p_request_hash text,
  p_referral_code text default null,
  p_cash_tender_cents integer default null,
  p_customer_phone text default null,
  p_address_complement text default null,
  p_delivery_reference text default null,
  p_delivery_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_postal_code text;
  v_address_number text;
begin
  select q.postal_code,q.address_number
  into v_postal_code,v_address_number
  from public.quotes q
  where q.id=p_quote_id
    and q.customer_id=p_user_id;

  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_postal_code is null
     or v_postal_code!~'^[0-9]{8}$'
     or v_address_number is null
     or v_address_number!~'^[0-9]{1,6}[A-Za-z]?$' then
    raise exception 'QUOTE_ADDRESS_NOT_VALIDATED' using errcode='22023';
  end if;

  v_result:=public.create_order_from_quote_v5(
    p_user_id,
    p_quote_id,
    p_payment_method,
    p_use_cashback,
    p_idempotency_key,
    p_request_hash,
    p_referral_code,
    p_cash_tender_cents,
    p_customer_phone,
    p_address_complement,
    p_delivery_reference,
    p_delivery_notes
  );

  v_order_id:=(v_result->>'orderId')::uuid;

  update public.orders
  set delivery_postal_code=v_postal_code,
      delivery_address_number=v_address_number
  where id=v_order_id
    and customer_id=p_user_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  return v_result||jsonb_build_object(
    'deliveryPostalCode',v_postal_code,
    'deliveryAddressNumber',v_address_number
  );
end;
$$;

revoke all on function public.create_order_from_quote_v6(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v6(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) to service_role;

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
        delivery_postal_code=null,
        delivery_address_number=null,
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
      jsonb_build_object('retentionDays',v_delivery_pii_days)
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

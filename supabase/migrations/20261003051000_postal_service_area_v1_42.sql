-- Chama São Gabriel — postal-code service-area authority v1.42
-- External CEP resolution is cached server-side; quote creation requires a fresh
-- cache record explicitly eligible for São Gabriel/RS.

create table if not exists public.postal_code_validation_cache (
  postal_code text primary key
    check (postal_code~'^[0-9]{8}$'),
  city text not null
    check (char_length(trim(city)) between 2 and 120),
  state text not null
    check (state~'^[A-Z]{2}$'),
  ibge_code text,
  provider text not null
    check (provider in ('brasilapi','viacep')),
  service_area_allowed boolean not null,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ibge_code is null or ibge_code~'^[0-9]{7}$')
);

alter table public.postal_code_validation_cache enable row level security;
revoke all on table public.postal_code_validation_cache from public, anon, authenticated;
grant all on table public.postal_code_validation_cache to service_role;

create index if not exists postal_code_validation_cache_verified_idx
  on public.postal_code_validation_cache(verified_at);

alter table public.quotes
  add column if not exists postal_code text;

alter table public.quotes
  drop constraint if exists quotes_postal_code_check,
  add constraint quotes_postal_code_check check (
    postal_code is null or postal_code~'^[0-9]{8}$'
  );

create index if not exists quotes_postal_code_idx
  on public.quotes(postal_code)
  where postal_code is not null;

alter table public.orders
  add column if not exists postal_code text;

alter table public.orders
  drop constraint if exists orders_postal_code_check,
  add constraint orders_postal_code_check check (
    postal_code is null or postal_code~'^[0-9]{8}$'
  );

create or replace function public.create_quote_snapshot_v2(
  p_user_id uuid,
  p_merchant_id uuid,
  p_address text,
  p_postal_code text,
  p_delivery_fee_cents integer,
  p_eta_min_minutes integer,
  p_eta_max_minutes integer,
  p_expires_at timestamptz,
  p_items jsonb,
  p_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
  v_quote_id uuid;
  v_postal public.postal_code_validation_cache%rowtype;
begin
  if p_postal_code is null or p_postal_code!~'^[0-9]{8}$' then
    raise exception 'INVALID_POSTAL_CODE' using errcode='22023';
  end if;

  select *
  into v_postal
  from public.postal_code_validation_cache pc
  where pc.postal_code=p_postal_code
    and pc.verified_at>=clock_timestamp()-interval '30 days';

  if not found then
    raise exception 'POSTAL_CODE_UNVERIFIED' using errcode='40001';
  end if;

  if not v_postal.service_area_allowed then
    raise exception 'POSTAL_CODE_OUTSIDE_SERVICE_AREA' using errcode='22023';
  end if;

  v_result:=public.create_quote_snapshot(
    p_user_id,
    p_merchant_id,
    p_address,
    p_delivery_fee_cents,
    p_eta_min_minutes,
    p_eta_max_minutes,
    p_expires_at,
    p_items,
    p_fingerprint
  );

  v_quote_id:=(v_result->>'quoteId')::uuid;

  update public.quotes
  set postal_code=p_postal_code
  where id=v_quote_id
    and customer_id=p_user_id
    and merchant_id=p_merchant_id;

  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;

  return v_result||jsonb_build_object(
    'postalCode',p_postal_code,
    'serviceCity',v_postal.city,
    'serviceState',v_postal.state,
    'postalValidated',true
  );
end;
$$;

revoke all on function public.create_quote_snapshot_v2(
  uuid,uuid,text,text,integer,integer,integer,timestamptz,jsonb,text
) from public, anon, authenticated;
grant execute on function public.create_quote_snapshot_v2(
  uuid,uuid,text,text,integer,integer,integer,timestamptz,jsonb,text
) to service_role;

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
  v_action public.action_requests%rowtype;
begin
  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key;

  if found and v_action.completed_at is not null then
    if v_action.user_id<>p_user_id
       or v_action.action_name<>'create-order'
       or v_action.request_hash<>p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;

    v_result:=v_action.result_json;
    v_order_id:=(v_result->>'orderId')::uuid;

    select o.postal_code
    into v_postal_code
    from public.orders o
    where o.id=v_order_id
      and o.customer_id=p_user_id;

    if not found then
      raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
    end if;

    return v_result||jsonb_build_object(
      'postalCode',v_postal_code,
      'postalValidated',v_postal_code is not null
    );
  end if;

  select q.postal_code
  into v_postal_code
  from public.quotes q
  join public.postal_code_validation_cache pc
    on pc.postal_code=q.postal_code
   and pc.service_area_allowed
   and pc.verified_at>=clock_timestamp()-interval '30 days'
  where q.id=p_quote_id
    and q.customer_id=p_user_id;

  if not found or v_postal_code is null then
    raise exception 'POSTAL_CODE_UNVERIFIED' using errcode='40001';
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
  set postal_code=v_postal_code
  where id=v_order_id
    and customer_id=p_user_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  return v_result||jsonb_build_object(
    'postalCode',v_postal_code,
    'postalValidated',true
  );
end;
$$;

revoke all on function public.create_order_from_quote_v6(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_order_from_quote_v6(
  uuid,uuid,text,boolean,text,text,text,integer,text,text,text,text
) to service_role;

-- Extend v1.41 retention to minimize CEP with the rest of delivery location data.
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
  v_postal_cache integer:=0;
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

  delete from public.postal_code_validation_cache pc
  where pc.verified_at<clock_timestamp()-interval '60 days';
  get diagnostics v_postal_cache=row_count;

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
        postal_code=null,
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
      'CEP, telefone, localização detalhada e instruções de chegada foram minimizados pela política de retenção.',
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
    'postalCacheDeleted',v_postal_cache,
    'deliveryPiiRedacted',v_delivery_pii,
    'deliveryPiiRetentionDays',v_delivery_pii_days
  );
end;
$$;

revoke all on function public.process_data_retention()
from public, anon, authenticated;
grant execute on function public.process_data_retention()
to postgres, service_role;

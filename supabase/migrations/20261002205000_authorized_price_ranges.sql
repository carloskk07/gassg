-- Chama v1.32 — merchant-authorized price ranges.
-- price_cents remains the merchant's preferred/reference price.
-- Automatic prices are chosen only inside [min_price_cents,max_price_cents].

alter table public.catalog_items
  add column if not exists pricing_mode text not null default 'fixed',
  add column if not exists min_price_cents integer,
  add column if not exists max_price_cents integer,
  add column if not exists pricing_strategy text not null default 'balanced';

update public.catalog_items
set min_price_cents=coalesce(min_price_cents,price_cents),
    max_price_cents=coalesce(max_price_cents,price_cents);

alter table public.catalog_items
  alter column min_price_cents set not null,
  alter column max_price_cents set not null;

alter table public.catalog_items
  drop constraint if exists catalog_items_pricing_mode_check,
  drop constraint if exists catalog_items_pricing_strategy_check,
  drop constraint if exists catalog_items_price_range_check,
  drop constraint if exists catalog_items_fixed_price_range_check;

alter table public.catalog_items
  add constraint catalog_items_pricing_mode_check
    check (pricing_mode in ('fixed','range')),
  add constraint catalog_items_pricing_strategy_check
    check (pricing_strategy in ('volume','balanced','margin')),
  add constraint catalog_items_price_range_check
    check (
      min_price_cents between 1 and 1000000
      and max_price_cents between 1 and 1000000
      and min_price_cents<=price_cents
      and price_cents<=max_price_cents
    ),
  add constraint catalog_items_fixed_price_range_check
    check (
      pricing_mode='range'
      or (min_price_cents=price_cents and max_price_cents=price_cents)
    );

create or replace function public.create_quote_snapshot(
  p_user_id uuid,
  p_merchant_id uuid,
  p_address text,
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
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_expected_count integer;
  v_catalog_count integer;
  v_subtotal bigint;
  v_gross integer;
begin
  if p_user_id is null or p_merchant_id is null then
    raise exception 'INVALID_QUOTE_OWNER' using errcode='22023';
  end if;

  if p_address is null
     or char_length(trim(p_address))<5
     or char_length(trim(p_address))>240 then
    raise exception 'INVALID_ADDRESS' using errcode='22023';
  end if;

  if p_delivery_fee_cents is null or p_delivery_fee_cents<0 then
    raise exception 'INVALID_DELIVERY_FEE' using errcode='22023';
  end if;

  if p_eta_min_minutes is null
     or p_eta_min_minutes<1
     or p_eta_max_minutes is null
     or p_eta_max_minutes<p_eta_min_minutes
     or p_eta_max_minutes>240 then
    raise exception 'INVALID_ETA' using errcode='22023';
  end if;

  if p_expires_at is null
     or p_expires_at<=clock_timestamp()+interval '30 seconds'
     or p_expires_at>clock_timestamp()+interval '10 minutes' then
    raise exception 'INVALID_QUOTE_EXPIRY' using errcode='22023';
  end if;

  if p_fingerprint is null or p_fingerprint!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_QUOTE_FINGERPRINT' using errcode='22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)<1
     or jsonb_array_length(p_items)>10 then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_user_id::text||':'||p_merchant_id::text||':'||p_fingerprint,
      0
    )
  );

  select *
  into v_quote
  from public.quotes
  where customer_id=p_user_id
    and merchant_id=p_merchant_id
    and snapshot_fingerprint=p_fingerprint
    and consumed_at is null
    and expires_at>clock_timestamp()+interval '60 seconds'
  order by expires_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'quoteId',v_quote.id,
      'grossTotalCents',v_quote.gross_total_cents,
      'etaMinMinutes',v_quote.eta_min_minutes,
      'etaMaxMinutes',v_quote.eta_max_minutes,
      'expiresAt',v_quote.expires_at,
      'reused',true
    );
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
     or v_merchant.price_confirmed_at is null
     or v_merchant.price_confirmed_at<clock_timestamp()-interval '24 hours'
     or v_merchant.delivery_fee_cents<>p_delivery_fee_cents then
    raise exception 'QUOTE_SOURCE_STALE' using errcode='40001';
  end if;

  with requested as (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  )
  select count(*),count(distinct product_code)
  into v_expected_count,v_catalog_count
  from requested
  where product_code is not null
    and quantity between 1 and 99
    and unit_price_cents between 1 and 1000000;

  if v_expected_count<>jsonb_array_length(p_items)
     or v_catalog_count<>v_expected_count then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode='22023';
  end if;

  with requested as (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  )
  select
    count(*),
    coalesce(sum(r.unit_price_cents::bigint*r.quantity),0)
  into v_catalog_count,v_subtotal
  from requested r
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=r.product_code
   and ci.active
   and ci.available_stock>=r.quantity
   and (
     (ci.pricing_mode='fixed' and r.unit_price_cents=ci.price_cents)
     or
     (ci.pricing_mode='range' and r.unit_price_cents between ci.min_price_cents and ci.max_price_cents)
   );

  if v_catalog_count<>v_expected_count then
    raise exception 'QUOTE_SOURCE_STALE' using errcode='40001';
  end if;

  if v_subtotal+p_delivery_fee_cents>2147483647 then
    raise exception 'QUOTE_TOTAL_TOO_LARGE' using errcode='22003';
  end if;

  v_gross:=(v_subtotal+p_delivery_fee_cents)::integer;

  insert into public.quotes(
    customer_id,merchant_id,address_text,gross_total_cents,delivery_fee_cents,
    eta_min_minutes,eta_max_minutes,expires_at,snapshot_fingerprint
  )
  values(
    p_user_id,p_merchant_id,trim(p_address),v_gross,p_delivery_fee_cents,
    p_eta_min_minutes,p_eta_max_minutes,p_expires_at,p_fingerprint
  )
  returning * into v_quote;

  insert into public.quote_items(
    quote_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select
    v_quote.id,
    ci.product_code,
    ci.product_name,
    r.quantity,
    r.unit_price_cents,
    r.unit_price_cents*r.quantity
  from (
    select
      upper(trim(x.product_code)) product_code,
      x.quantity,
      x.unit_price_cents
    from jsonb_to_recordset(p_items) as x(
      product_code text,
      quantity integer,
      unit_price_cents integer
    )
  ) r
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=r.product_code
   and ci.active
   and ci.available_stock>=r.quantity
   and (
     (ci.pricing_mode='fixed' and r.unit_price_cents=ci.price_cents)
     or
     (ci.pricing_mode='range' and r.unit_price_cents between ci.min_price_cents and ci.max_price_cents)
   )
  order by ci.product_code;

  return jsonb_build_object(
    'quoteId',v_quote.id,
    'grossTotalCents',v_quote.gross_total_cents,
    'etaMinMinutes',v_quote.eta_min_minutes,
    'etaMaxMinutes',v_quote.eta_max_minutes,
    'expiresAt',v_quote.expires_at,
    'reused',false
  );
end;
$$;

revoke all on function public.create_quote_snapshot(
  uuid,uuid,text,integer,integer,integer,timestamptz,jsonb,text
) from public, anon, authenticated;

grant execute on function public.create_quote_snapshot(
  uuid,uuid,text,integer,integer,integer,timestamptz,jsonb,text
) to service_role;

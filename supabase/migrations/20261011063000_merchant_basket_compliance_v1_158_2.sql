-- V1.158.2: regulatory checks by basket, independent of payment channel.
-- Requires V1.158.1. Never weaken GLP/ANP requirements.
create or replace function public.merchant_basket_compliance_current(
 p_merchant_id uuid,p_product_codes text[]
)
returns boolean language sql stable security definer
set search_path to pg_catalog
as $func$
select coalesce(
 p_merchant_id is not null
 and p_product_codes is not null
 and cardinality(p_product_codes)>0
 and public.merchant_cnpj_compliance_current(p_merchant_id)
 and (
   select count(*)=cardinality(p_product_codes)
     and bool_and(code<>''
       and (p.product_code is not null
         or public.is_glp_product_code(code)
         or public.is_glp_container_product_code(code)))
     and (not bool_or(
       public.is_glp_product_code(code)
       or public.is_glp_container_product_code(code)
       or coalesce(p.delivery_class in ('regulated_glp','regulated_glp_container'),false)
     ) or public.merchant_anp_verification_current(p_merchant_id))
   from (
     select upper(trim(coalesce(x,''))) as code
     from unnest(p_product_codes) as v(x)
   ) requested
   left join public.product_delivery_profiles p
     on p.product_code=requested.code and p.active
 ),false);
$func$;
revoke all on function public.merchant_basket_compliance_current(uuid,text[])
  from public,anon,authenticated;
grant execute on function public.merchant_basket_compliance_current(uuid,text[])
  to service_role;

create or replace function public.merchant_has_compliant_catalog_item(p_merchant_id uuid)
returns boolean language sql stable security definer set search_path to pg_catalog
as $func$
select p_merchant_id is not null and exists(
 select 1 from public.catalog_items ci
 where ci.merchant_id=p_merchant_id and ci.active
   and public.merchant_basket_compliance_current(p_merchant_id,array[ci.product_code])
);
$func$;
revoke all on function public.merchant_has_compliant_catalog_item(uuid)
  from public,anon,authenticated;
grant execute on function public.merchant_has_compliant_catalog_item(uuid)
  to service_role;

create or replace function public.enforce_quote_item_regulatory_authority()
returns trigger language plpgsql security definer set search_path to pg_catalog
as $func$
declare v_merchant_id uuid;
begin
 select merchant_id into v_merchant_id from public.quotes
 where id=new.quote_id for share;
 if v_merchant_id is null or not public.merchant_basket_compliance_current(
     v_merchant_id,array[new.product_code]
 ) then
   raise exception 'QUOTE_PRODUCT_REGULATORY_NOT_AUTHORIZED' using errcode='40001';
 end if;
 return new;
end;
$func$;
revoke all on function public.enforce_quote_item_regulatory_authority()
  from public,anon,authenticated;
drop trigger if exists quote_item_regulatory_authority_trg on public.quote_items;
create trigger quote_item_regulatory_authority_trg
before insert or update of quote_id,product_code on public.quote_items
for each row execute function public.enforce_quote_item_regulatory_authority();

create or replace function public.enforce_order_item_regulatory_authority()
returns trigger language plpgsql security definer set search_path to pg_catalog
as $func$
declare v_merchant_id uuid;
begin
 select merchant_id into v_merchant_id from public.orders
 where id=new.order_id for share;
 if v_merchant_id is null or not public.merchant_basket_compliance_current(
     v_merchant_id,array[new.product_code]
 ) then
   raise exception 'ORDER_PRODUCT_REGULATORY_NOT_AUTHORIZED' using errcode='40001';
 end if;
 return new;
end;
$func$;
revoke all on function public.enforce_order_item_regulatory_authority()
  from public,anon,authenticated;
drop trigger if exists order_item_regulatory_authority_trg on public.order_items;
create trigger order_item_regulatory_authority_trg
before insert or update of order_id,product_code on public.order_items
for each row execute function public.enforce_order_item_regulatory_authority();

create or replace function public.enforce_order_basket_regulatory_authority()
returns trigger language plpgsql security definer set search_path to pg_catalog
as $func$
declare v_codes text[];
begin
 if (
   new.merchant_id is distinct from old.merchant_id
   and new.status not in ('CANCELLED','SETTLED')
 ) or (
   new.status in ('PREPARING','OUT_FOR_DELIVERY')
   and old.status is distinct from new.status
 ) then
   select array_agg(oi.product_code order by oi.product_code)
     into v_codes from public.order_items oi where oi.order_id=new.id;
   if coalesce(cardinality(v_codes),0)>0
      and not public.merchant_basket_compliance_current(new.merchant_id,v_codes)
   then
     raise exception 'ORDER_BASKET_REGULATORY_NOT_AUTHORIZED'
       using errcode='40001';
   end if;
 end if;
 return new;
end;
$func$;
revoke all on function public.enforce_order_basket_regulatory_authority()
  from public,anon,authenticated;
drop trigger if exists order_basket_regulatory_authority_trg on public.orders;
create trigger order_basket_regulatory_authority_trg
before update of merchant_id,status on public.orders
for each row execute function public.enforce_order_basket_regulatory_authority();

-- Replace legacy global-regulatory blocks in operation, quote, rescue and reporting paths.
CREATE OR REPLACE FUNCTION public.enforce_active_merchant_compliance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.status='active' or new.online then
    if not public.merchant_cnpj_compliance_current(new.id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='23514';
    end if;

  end if;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.enforce_compliance_continuity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_merchant_id uuid;
  v_active boolean:=false;
begin
  v_merchant_id:=case when tg_op='DELETE' then old.merchant_id else new.merchant_id end;

  select m.status='active'
  into v_active
  from public.merchants m
  where m.id=v_merchant_id;

  if coalesce(v_active,false)
     and (
       not public.merchant_cnpj_compliance_current(v_merchant_id)

     ) then

    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_merchant_id
      and status='active';

    insert into public.merchant_compliance_events(
      merchant_id,event_type,reason,metadata
    )
    values(
      v_merchant_id,
      'compliance_suspended',
      'Evidência regulatória ausente, rejeitada ou vencida.',
      jsonb_build_object('source','continuity_trigger')
    );
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$function$;


CREATE OR REPLACE FUNCTION public.process_compliance_expiry()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_row record;
  v_count integer:=0;
begin
  for v_row in
    select m.id
    from public.merchants m
    where m.status='active'
      and (
        not public.merchant_cnpj_compliance_current(m.id)

      )
    order by m.id
    for update skip locked
  loop
    update public.merchants
    set status='suspended',
        online=false,
        updated_at=clock_timestamp()
    where id=v_row.id
      and status='active';

    if found then
      insert into public.merchant_compliance_events(
        merchant_id,event_type,reason,metadata
      )
      values(
        v_row.id,
        'compliance_expired',
        'A janela operacional de revalidação expirou.',
        jsonb_build_object('source','scheduled_watchdog')
      );
      v_count:=v_count+1;
    end if;
  end loop;

  return jsonb_build_object('suspendedMerchants',v_count);
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_set_merchant_status(p_actor_user_id uuid, p_merchant_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_merchant public.merchants%rowtype;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_status not in ('active','suspended') then
    raise exception 'INVALID_MERCHANT_STATUS' using errcode='22023';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=p_merchant_id
  for update;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_merchant.status=p_status then
    return jsonb_build_object(
      'ok',true,
      'merchantId',v_merchant.id,
      'status',v_merchant.status,
      'online',v_merchant.online,
      'alreadyInState',true
    );
  end if;

  if p_status='active' then
    if v_merchant.status not in ('pending','suspended') then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;

    if not public.merchant_cnpj_compliance_current(v_merchant.id) then
      raise exception 'CNPJ_REVERIFICATION_REQUIRED' using errcode='40001';
    end if;

  else
    if v_merchant.status<>'active' then
      raise exception 'INVALID_MERCHANT_STATUS_TRANSITION' using errcode='40001';
    end if;
  end if;

  update public.merchants
  set status=p_status,
      online=false,
      updated_at=clock_timestamp()
  where id=v_merchant.id
  returning * into v_merchant;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_status='active' then 'merchant_activated' else 'merchant_suspended' end,
    'merchant',
    v_merchant.id::text,
    jsonb_build_object('status',p_status)
  );

  return jsonb_build_object(
    'ok',true,
    'merchantId',v_merchant.id,
    'status',v_merchant.status,
    'online',v_merchant.online,
    'alreadyInState',false
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_order_from_quote(p_user_id uuid, p_quote_id uuid, p_payment_method text, p_use_cashback boolean, p_idempotency_key text, p_request_hash text, p_referral_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_action public.action_requests%rowtype;
  v_quote public.quotes%rowtype;
  v_merchant public.merchants%rowtype;
  v_order_id uuid;
  v_public_code text;
  v_cashback_balance bigint := 0;
  v_reserved integer := 0;
  v_total integer := 0;
  v_offer_expires_at timestamptz;
  v_result jsonb;
  v_referrer uuid;
  v_prior_order_count integer:=0;
  v_product_codes text[];
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_payment_method not in ('pix','card','cash') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<12 or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or char_length(p_request_hash)<>64 then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_user_id,'create-order',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if v_action.user_id<>p_user_id or v_action.action_name<>'create-order' or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    if v_action.result_json is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return v_action.result_json;
  end if;

  select * into v_quote
  from public.quotes
  where id=p_quote_id and customer_id=p_user_id
  for update;

  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if v_quote.consumed_at is not null then raise exception 'QUOTE_ALREADY_USED' using errcode='23505'; end if;
  if v_quote.expires_at<=clock_timestamp() then raise exception 'QUOTE_EXPIRED' using errcode='22023'; end if;

  select * into v_merchant
  from public.merchants
  where id=v_quote.merchant_id
  for share;

  if not found
     or v_merchant.status<>'active'
     or not v_merchant.online
     or not v_merchant.accepts_citywide
     or v_merchant.last_seen_at is null
     or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if not public.merchant_cnpj_compliance_current(v_quote.merchant_id) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  select array_agg(qi.product_code order by qi.product_code)
  into v_product_codes
  from public.quote_items qi
  where qi.quote_id=v_quote.id;

  if coalesce(cardinality(v_product_codes),0)<1
     or not public.merchant_basket_compliance_current(
       v_quote.merchant_id,v_product_codes
     )
     or not public.merchant_cart_delivery_compatible(
       v_quote.merchant_id,
       v_product_codes
     ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1
    from public.quote_items qi
    left join public.catalog_items ci
      on ci.merchant_id=v_quote.merchant_id and ci.product_code=qi.product_code
    where qi.quote_id=v_quote.id
      and (ci.merchant_id is null or not ci.active or ci.available_stock<qi.quantity)
  ) then
    raise exception 'QUOTE_STALE' using errcode='40001';
  end if;

  if exists(
    select 1 from public.orders
    where customer_id=p_user_id and status not in ('SETTLED','CANCELLED')
  ) then
    raise exception 'ACTIVE_ORDER_EXISTS' using errcode='23505';
  end if;

  select count(*)
  into v_prior_order_count
  from public.orders
  where customer_id=p_user_id;

  if p_referral_code is not null
     and char_length(trim(p_referral_code)) between 6 and 20
     and v_prior_order_count=0 then
    select user_id into v_referrer
    from public.profiles
    where referral_code=upper(trim(p_referral_code))
    limit 1;

    if v_referrer is not null and v_referrer<>p_user_id then
      insert into public.referrals(referred_user_id,referrer_user_id,referral_code)
      values(p_user_id,v_referrer,upper(trim(p_referral_code)))
      on conflict(referred_user_id) do nothing;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('cashback-user:'||p_user_id::text,0)
  );

  select (public.cashback_position(p_user_id)->>'spendableCents')::bigint
  into v_cashback_balance;

  if p_use_cashback then
    v_reserved:=least(v_quote.gross_total_cents,v_cashback_balance)::integer;
  end if;

  v_total:=v_quote.gross_total_cents-v_reserved;
  v_order_id:=gen_random_uuid();
  v_public_code:='SG-'||upper(substr(replace(v_order_id::text,'-',''),1,12));
  v_offer_expires_at:=clock_timestamp()+interval '3 minutes';

  insert into public.orders(
    id,public_code,customer_id,merchant_id,status,address_text,payment_method,
    gross_total_cents,delivery_fee_cents_snapshot,cashback_reserved_cents,total_cents,pin_hash,
    attempted_merchant_ids,offer_expires_at
  ) values(
    v_order_id,v_public_code,p_user_id,v_quote.merchant_id,'OFFERED_TO_MERCHANT',
    v_quote.address_text,p_payment_method,v_quote.gross_total_cents,v_quote.delivery_fee_cents,v_reserved,v_total,
    null,array[v_quote.merchant_id],v_offer_expires_at
  );

  insert into public.order_items(
    order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  )
  select v_order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  from public.quote_items where quote_id=v_quote.id;

  if v_reserved>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    ) values(
      p_user_id,v_order_id,'cashback','cashback_reserve',-v_reserved,
      p_idempotency_key||':cashback-reserve',
      jsonb_build_object('quoteId',v_quote.id)
    );
  end if;

  insert into public.order_events(order_id,actor_user_id,actor_type,event_type,title,detail)
  values
    (v_order_id,p_user_id,'customer','CREATED','Pedido recebido','Pedido criado a partir de uma cotação válida.'),
    (v_order_id,p_user_id,'system','QUOTE_LOCKED','Preço protegido','Preço, itens e endereço foram congelados para este pedido.'),
    (v_order_id,p_user_id,'system','OFFERED_TO_MERCHANT','Aguardando confirmação da revenda','A revenda precisa aceitar antes de o pedido ser considerado confirmado.');

  update public.quotes set consumed_at=clock_timestamp() where id=v_quote.id;

  v_result:=jsonb_build_object(
    'orderId',v_order_id,'publicCode',v_public_code,'status','OFFERED_TO_MERCHANT',
    'grossTotalCents',v_quote.gross_total_cents,'cashbackReservedCents',v_reserved,
    'totalCents',v_total,'offerExpiresAt',v_offer_expires_at
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_quote_snapshot(p_user_id uuid, p_merchant_id uuid, p_address text, p_delivery_fee_cents integer, p_eta_min_minutes integer, p_eta_max_minutes integer, p_expires_at timestamp with time zone, p_items jsonb, p_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  if not public.merchant_basket_compliance_current(
    p_merchant_id,array(
      select upper(trim(x.product_code))
      from jsonb_to_recordset(p_items)
        as x(product_code text,quantity integer,unit_price_cents integer)
    )
  ) then
    raise exception 'QUOTE_PRODUCT_REGULATORY_NOT_AUTHORIZED' using errcode='40001';
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
     or v_merchant.delivery_fee_confirmed_at is null
     or v_merchant.delivery_fee_confirmed_at<clock_timestamp()-interval '24 hours'
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

  -- Keep each SKU's range/freshness/stock stable while the snapshot is built.
  perform ci.product_code
  from jsonb_to_recordset(p_items) as x(
    product_code text,
    quantity integer,
    unit_price_cents integer
  )
  join public.catalog_items ci
    on ci.merchant_id=p_merchant_id
   and ci.product_code=upper(trim(x.product_code))
  order by ci.product_code
  for share of ci;

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
   and ci.price_confirmed_at is not null
   and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours'
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
   and ci.price_confirmed_at is not null
   and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours'
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
$function$;


CREATE OR REPLACE FUNCTION public.merchant_order_action(p_user_id uuid, p_order_id uuid, p_action text, p_expected_version integer, p_idempotency_key text, p_request_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
declare
  v_action public.action_requests%rowtype;
  v_order public.orders%rowtype;
  v_merchant public.merchants%rowtype;
  v_member_role text;
  v_item record;
  v_locked_stock integer;
  v_locked_active boolean;
  v_product_codes text[];
  v_accept_issue text:=null;
  v_dispatch_minutes integer;
  v_pin_bytes bytea;
  v_pin_seed integer;
  v_pin_code text;
  v_pin_hash text;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_action not in ('accept','reject','dispatch','arriving') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;

  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_VERSION' using errcode='22023';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_user_id,'merchant-action:'||p_action,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;

  if v_action.user_id<>p_user_id
     or v_action.action_name<>'merchant-action:'||p_action
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  select mm.member_role
  into v_member_role
  from public.merchant_members mm
  where mm.merchant_id=v_order.merchant_id
    and mm.user_id=p_user_id
    and mm.active
  limit 1;

  if not found
     or (
       v_member_role not in ('owner','manager','operator')
       and not (
         v_member_role='driver'
         and p_action in ('dispatch','arriving')
         and v_order.assigned_delivery_user_id=p_user_id
       )
     ) then
    raise exception 'MERCHANT_ACCESS_DENIED' using errcode='42501';
  end if;

  if v_order.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;

  select *
  into v_merchant
  from public.merchants
  where id=v_order.merchant_id
  for share;

  if not found then
    raise exception 'MERCHANT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_action='accept' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if v_order.offer_expires_at is null
       or v_order.offer_expires_at<=clock_timestamp() then
      v_result:=public.system_reassign_expired_order(v_order.id)
        ||jsonb_build_object(
          'accepted',false,
          'autoRescued',true,
          'rescueReason','offer_expired'
        );

    else
      if not public.merchant_basket_compliance_current(
        v_order.merchant_id,
        array(select oi.product_code from public.order_items oi where oi.order_id=v_order.id)
      ) then
        v_accept_issue:='merchant_compliance_expired_before_accept';
      elsif v_merchant.status<>'active'
         or not v_merchant.online
         or v_merchant.last_seen_at is null
         or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
        v_accept_issue:='merchant_unavailable_before_accept';
      end if;

      select array_agg(oi.product_code order by oi.product_code)
      into v_product_codes
      from public.order_items oi
      where oi.order_id=v_order.id;

      if v_accept_issue is null
         and not public.merchant_cart_delivery_compatible(
           v_order.merchant_id,
           coalesce(v_product_codes,array[]::text[])
         ) then
        v_accept_issue:='delivery_capability_changed_before_accept';
      end if;

      if v_accept_issue is null then
        for v_item in
          select oi.product_code,oi.quantity
          from public.order_items oi
          where oi.order_id=v_order.id
          order by oi.product_code
        loop
          v_locked_stock:=null;
          v_locked_active:=null;

          select ci.available_stock,ci.active
          into v_locked_stock,v_locked_active
          from public.catalog_items ci
          where ci.merchant_id=v_order.merchant_id
            and ci.product_code=v_item.product_code
          for update;

          if not found
             or not coalesce(v_locked_active,false)
             or coalesce(v_locked_stock,0)<v_item.quantity then
            v_accept_issue:='stock_changed_before_accept';
            exit;
          end if;
        end loop;
      end if;

      if v_accept_issue is not null then
        v_result:=public.rescue_offered_order_now(
          v_order.id,
          v_accept_issue,
          p_user_id,
          'ACCEPT_PRECONDITION_CHANGED',
          'Pedido redirecionado',
          'Uma condição necessária mudou antes do aceite; o sistema iniciou resgate automático.'
        );

      else
        for v_item in
          select oi.product_code,oi.quantity
          from public.order_items oi
          where oi.order_id=v_order.id
          order by oi.product_code
        loop
          update public.catalog_items
          set available_stock=available_stock-v_item.quantity,
              updated_at=clock_timestamp()
          where merchant_id=v_order.merchant_id
            and product_code=v_item.product_code;
        end loop;

        v_dispatch_minutes:=greatest(
          3,
          least(10,ceil(v_merchant.base_eta_minutes*0.35)::integer)
        );

        update public.orders
        set status='PREPARING',
            supplier_name_snapshot=v_merchant.name,
            accepted_at=clock_timestamp(),
            dispatch_due_at=clock_timestamp()+make_interval(mins=>v_dispatch_minutes),
            promised_by=clock_timestamp()+make_interval(mins=>v_merchant.base_eta_minutes+7),
            offer_expires_at=null,
            risk_reason=null,
            version=version+1,
            updated_at=clock_timestamp()
        where id=v_order.id
        returning * into v_order;

        insert into public.order_events(
          order_id,actor_user_id,actor_type,event_type,title,detail
        )
        values
          (
            v_order.id,p_user_id,'merchant','MERCHANT_ACCEPTED',
            'Revenda confirmou',
            'A revenda confirmou itens, preço, capacidade e compatibilidade de entrega.'
          ),
          (
            v_order.id,p_user_id,'merchant','PREPARING',
            'Em preparação',
            'Estoque reservado e entrega sendo preparada.'
          );

        v_result:=jsonb_build_object(
          'orderId',v_order.id,
          'status',v_order.status,
          'version',v_order.version,
          'supplierName',v_order.supplier_name_snapshot,
          'dispatchDueAt',v_order.dispatch_due_at,
          'promisedBy',v_order.promised_by,
          'accepted',true,
          'autoRescued',false
        );
      end if;
    end if;

  elsif p_action='reject' then
    if v_order.status<>'OFFERED_TO_MERCHANT' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    v_result:=public.rescue_offered_order_now(
      v_order.id,
      'merchant_rejected',
      p_user_id,
      'MERCHANT_REJECTED',
      'Revenda não consegue atender',
      'A revenda recusou antes do aceite e o sistema iniciou resgate automático.'
    );

  elsif p_action='dispatch' then
    if v_order.status not in ('PREPARING','AT_RISK') then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    if not public.merchant_basket_compliance_current(
        v_order.merchant_id,
        array(select oi.product_code from public.order_items oi where oi.order_id=v_order.id)
      ) then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'merchant_compliance_expired_before_dispatch',
        p_user_id,
        'Compliance venceu antes da saída',
        'A evidência regulatória deixou de estar vigente antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','merchant_compliance_expired_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    if v_merchant.status<>'active'
       or v_merchant.last_seen_at is null
       or v_merchant.last_seen_at<clock_timestamp()-interval '10 minutes' then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'merchant_unavailable_before_dispatch',
        p_user_id,
        'Revenda indisponível antes da saída',
        'A revenda deixou de estar elegível ou perdeu conexão antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','merchant_unavailable_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    select array_agg(oi.product_code order by oi.product_code)
    into v_product_codes
    from public.order_items oi
    where oi.order_id=v_order.id;

    if not public.merchant_cart_delivery_compatible(
      v_order.merchant_id,
      coalesce(v_product_codes,array[]::text[])
    ) then
      v_result:=public.system_release_and_rescue_accepted_order(
        v_order.id,
        'delivery_capability_changed_before_dispatch',
        p_user_id,
        'Capacidade logística mudou antes da saída',
        'A capacidade necessária deixou de ser válida antes da saída; o estoque foi devolvido e o pedido entrou em rescue.'
      ) || jsonb_build_object(
        'dispatched',false,
        'autoRescued',true,
        'rescueReason','delivery_capability_changed_before_dispatch'
      );

      update public.action_requests
      set result_json=v_result,completed_at=clock_timestamp()
      where idempotency_key=p_idempotency_key;
      return v_result;
    end if;

    v_pin_bytes:=extensions.gen_random_bytes(2);
    v_pin_seed:=get_byte(v_pin_bytes,0)*256+get_byte(v_pin_bytes,1);
    v_pin_code:=lpad((1000+(v_pin_seed%9000))::text,4,'0');
    v_pin_hash:=encode(extensions.digest(v_pin_code,'sha256'),'hex');

    insert into public.order_delivery_secrets(order_id,pin_code)
    values(v_order.id,v_pin_code)
    on conflict(order_id) do update
      set pin_code=excluded.pin_code,
          created_at=clock_timestamp(),
          revealed_at=null,
          consumed_at=null;

    update public.orders
    set status='OUT_FOR_DELIVERY',
        pin_hash=v_pin_hash,
        dispatched_at=clock_timestamp(),
        assigned_delivery_user_id=coalesce(assigned_delivery_user_id,p_user_id),
        delivery_assigned_at=coalesce(delivery_assigned_at,clock_timestamp()),
        delivery_assigned_by=coalesce(delivery_assigned_by,p_user_id),
        risk_reason=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'merchant','OUT_FOR_DELIVERY',
      'Saiu para entrega',
      'A revenda confirmou explicitamente a saída.'
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'dispatchedAt',v_order.dispatched_at
    );

  elsif p_action='arriving' then
    if v_order.status<>'OUT_FOR_DELIVERY' then
      raise exception 'INVALID_TRANSITION' using errcode='40001';
    end if;

    update public.orders
    set status='ARRIVING',
        arriving_at=clock_timestamp(),
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_order.id,p_user_id,'merchant','ARRIVING',
      'Entregador chegando',
      'A chegada próxima foi confirmada.'
    );

    v_result:=jsonb_build_object(
      'orderId',v_order.id,
      'status',v_order.status,
      'version',v_order.version,
      'arrivingAt',v_order.arriving_at
    );
  end if;

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.system_rescue_order(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order public.orders%rowtype;
  v_candidate_id uuid;
  v_candidate_merchant public.merchants%rowtype;
  v_candidate_gross integer:=0;
  v_candidate_fee integer:=0;
  v_candidate_valid boolean:=false;
  v_expected_items integer:=0;
  v_locked_items integer:=0;
  v_capacity_used integer:=0;
  v_item record;
  v_ci public.catalog_items%rowtype;
  v_new_reserved integer;
  v_release_diff integer;
  v_key text;
  v_result jsonb;
begin
  if p_reason is null or char_length(p_reason)<2 or char_length(p_reason)>120 then
    raise exception 'INVALID_RESCUE_REASON' using errcode='22023';
  end if;

  select *
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_order.status<>'REASSIGNING' then
    raise exception 'INVALID_RESCUE_STATE' using errcode='40001';
  end if;

  v_key:='system-rescue:'||replace(v_order.id::text,'-','')||':'||v_order.version::text;

  select count(*)
  into v_expected_items
  from public.order_items
  where order_id=v_order.id;

  for v_candidate_id in
    select m.id
    from public.merchants m
    join public.order_items oi
      on oi.order_id=v_order.id
    join public.catalog_items ci
      on ci.merchant_id=m.id
     and ci.product_code=oi.product_code
     and ci.active
     and ci.available_stock>=oi.quantity
     and ci.price_confirmed_at is not null
     and ci.price_confirmed_at>=clock_timestamp()-interval '24 hours'
    where m.status='active'
      and public.merchant_allowed_in_operation_mode(m.id)
      and public.merchant_basket_compliance_current(
        m.id,array(select oi.product_code from public.order_items oi where oi.order_id=v_order.id)
      )
      and m.online
      and m.accepts_citywide
      and public.merchant_accepts_payment_method(m.id,v_order.payment_method)
      and (v_order.delivery_window_start is null or m.accepts_scheduled_orders)
      and m.last_seen_at>=clock_timestamp()-interval '10 minutes'
      and m.delivery_fee_confirmed_at is not null
      and m.delivery_fee_confirmed_at>=clock_timestamp()-interval '24 hours'
      and not (m.id=any(v_order.attempted_merchant_ids))
      and (
        select count(*)
        from public.orders cap
        where (
          cap.merchant_id=m.id
          and cap.status in (
            'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
            'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
          )
        ) or (
          cap.proposed_merchant_id=m.id
          and cap.status='REQUOTE_REQUIRED'
        )
      ) < m.max_active_orders
      and public.merchant_cart_delivery_compatible(
        m.id,
        array(
          select oi2.product_code
          from public.order_items oi2
          where oi2.order_id=v_order.id
          order by oi2.product_code
        )
      )
    group by m.id,m.delivery_fee_cents,m.base_eta_minutes,m.trust_score
    having count(*)=v_expected_items
    order by
      (sum(ci.price_cents*oi.quantity)+m.delivery_fee_cents) asc,
      m.base_eta_minutes asc,
      m.trust_score desc
    limit 20
  loop
    v_candidate_valid:=true;
    v_candidate_gross:=0;
    v_locked_items:=0;

    perform pg_advisory_xact_lock(
      hashtextextended('merchant-capacity:'||v_candidate_id::text,0)
    );

    select *
    into v_candidate_merchant
    from public.merchants
    where id=v_candidate_id
    for update skip locked;

    if not found
       or v_candidate_merchant.status<>'active'
       or not public.merchant_allowed_in_operation_mode(v_candidate_id)
       or not public.merchant_operational_compliance_current(v_candidate_id)
       or not v_candidate_merchant.online
       or not v_candidate_merchant.accepts_citywide
       or not public.merchant_accepts_payment_method(v_candidate_id,v_order.payment_method)
       or (v_order.delivery_window_start is not null and not v_candidate_merchant.accepts_scheduled_orders)
       or v_candidate_merchant.last_seen_at is null
       or v_candidate_merchant.last_seen_at<clock_timestamp()-interval '10 minutes'
       or v_candidate_merchant.delivery_fee_confirmed_at is null
       or v_candidate_merchant.delivery_fee_confirmed_at<clock_timestamp()-interval '24 hours'
       or not public.merchant_cart_delivery_compatible(
         v_candidate_id,
         array(
           select oi2.product_code
           from public.order_items oi2
           where oi2.order_id=v_order.id
           order by oi2.product_code
         )
       ) then
      v_candidate_valid:=false;
    end if;

    if v_candidate_valid then
      select count(*)::integer
      into v_capacity_used
      from public.orders cap
      where (
        cap.merchant_id=v_candidate_id
        and cap.status in (
          'OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING',
          'AT_RISK','OUT_FOR_DELIVERY','ARRIVING'
        )
      ) or (
        cap.proposed_merchant_id=v_candidate_id
        and cap.status='REQUOTE_REQUIRED'
      );

      if v_capacity_used>=v_candidate_merchant.max_active_orders then
        v_candidate_valid:=false;
      end if;
    end if;

    if v_candidate_valid then
      v_candidate_fee:=v_candidate_merchant.delivery_fee_cents;
      v_candidate_gross:=v_candidate_fee;

      for v_item in
        select oi.product_code,oi.quantity
        from public.order_items oi
        where oi.order_id=v_order.id
        order by oi.product_code
      loop
        v_ci:=null;

        select ci.*
        into v_ci
        from public.catalog_items ci
        where ci.merchant_id=v_candidate_id
          and ci.product_code=v_item.product_code
        for update skip locked;

        if not found
           or not coalesce(v_ci.active,false)
           or coalesce(v_ci.available_stock,0)<v_item.quantity
           or v_ci.price_confirmed_at is null
           or v_ci.price_confirmed_at<clock_timestamp()-interval '24 hours' then
          v_candidate_valid:=false;
          exit;
        end if;

        v_candidate_gross:=v_candidate_gross+(v_ci.price_cents*v_item.quantity);
        v_locked_items:=v_locked_items+1;
      end loop;

      if v_locked_items<>v_expected_items then
        v_candidate_valid:=false;
      end if;
    end if;

    if v_candidate_valid then
      exit;
    end if;

    v_candidate_id:=null;
  end loop;

  if v_candidate_id is null or not v_candidate_valid then
    update public.orders
    set status='CANCELLED',
        supplier_name_snapshot=null,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        risk_reason=p_reason,
        offer_expires_at=null,
        dispatch_due_at=null,
        promised_by=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    if v_order.cashback_reserved_cents>0 then
      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_order.customer_id,v_order.id,'cashback','cashback_release',
        v_order.cashback_reserved_cents,
        v_key||':cashback-release',
        jsonb_build_object('reason',p_reason)
      )
      on conflict(idempotency_key) do nothing;
    end if;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','CANCELLED',
      'Pedido cancelado',
      'Nenhuma outra revenda elegível, estável e logisticamente compatível conseguiu assumir o pedido.',
      jsonb_build_object('reason',p_reason)
    );

    return jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status','CANCELLED','version',v_order.version
    );
  end if;

  v_new_reserved:=least(v_order.cashback_reserved_cents,v_candidate_gross);
  v_release_diff:=v_order.cashback_reserved_cents-v_new_reserved;

  if v_release_diff>0 then
    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values(
      v_order.customer_id,v_order.id,'cashback','cashback_release',
      v_release_diff,
      v_key||':cashback-rebalance',
      jsonb_build_object('reason',p_reason)
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if v_candidate_gross<=v_order.gross_total_cents then
    update public.orders
    set merchant_id=v_candidate_id,
        supplier_name_snapshot=null,
        gross_total_cents=v_candidate_gross,
        delivery_fee_cents_snapshot=v_candidate_fee,
        cashback_reserved_cents=v_new_reserved,
        total_cents=v_candidate_gross-v_new_reserved,
        proposed_merchant_id=null,
        proposed_gross_total_cents=null,
        proposed_total_cents=null,
        proposed_delivery_fee_cents=null,
        status='OFFERED_TO_MERCHANT',
        attempted_merchant_ids=array_append(attempted_merchant_ids,v_candidate_id),
        offer_expires_at=clock_timestamp()+interval '3 minutes',
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=null,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','OFFERED_TO_MERCHANT',
      'Nova revenda acionada',
      'Outra revenda compatível recebeu o pedido sem aumento de preço; preço e estoque foram revalidados atomicamente.',
      jsonb_build_object('reason',p_reason)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'totalCents',v_order.total_cents,'offerExpiresAt',v_order.offer_expires_at
    );
  else
    update public.orders
    set status='REQUOTE_REQUIRED',
        supplier_name_snapshot=null,
        proposed_merchant_id=v_candidate_id,
        proposed_gross_total_cents=v_candidate_gross,
        proposed_total_cents=v_candidate_gross-v_new_reserved,
        proposed_delivery_fee_cents=v_candidate_fee,
        offer_expires_at=clock_timestamp()+interval '5 minutes',
        accepted_at=null,
        dispatch_due_at=null,
        promised_by=null,
        risk_reason=p_reason,
        version=version+1,
        updated_at=clock_timestamp()
    where id=v_order.id
    returning * into v_order;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_order.id,null,'system','REQUOTE_REQUIRED',
      'Nova confirmação necessária',
      'A alternativa compatível possui preço diferente; preço e estoque foram revalidados e a condição fica reservada por até 5 minutos.',
      jsonb_build_object('reason',p_reason,'expiresAt',v_order.offer_expires_at)
    );

    v_result:=jsonb_build_object(
      'ok',true,'orderId',v_order.id,'status',v_order.status,'version',v_order.version,
      'proposedTotalCents',v_order.proposed_total_cents,
      'offerExpiresAt',v_order.offer_expires_at
    );
  end if;

  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.process_order_timeouts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_row record;
  v_offer_count integer:=0;
  v_requote_count integer:=0;
  v_accepted_rescue_count integer:=0;
  v_rescue jsonb;
  v_risk_count integer:=0;
  v_eta_count integer:=0;
begin
  for v_row in
    select id
    from public.orders
    where status='OFFERED_TO_MERCHANT'
      and offer_expires_at is not null
      and offer_expires_at<=clock_timestamp()
    order by offer_expires_at
    limit 100
  loop
    perform public.system_reassign_expired_order(v_row.id);
    v_offer_count:=v_offer_count+1;
  end loop;

  for v_row in
    select id
    from public.orders
    where status='REQUOTE_REQUIRED'
      and offer_expires_at is not null
      and offer_expires_at<=clock_timestamp()
    order by offer_expires_at
    limit 100
  loop
    perform public.system_expire_requote(v_row.id);
    v_requote_count:=v_requote_count+1;
  end loop;

  for v_row in
    select
      o.id,
      case
        when not public.merchant_basket_compliance_current(
        o.merchant_id,
        array(select oi.product_code from public.order_items oi where oi.order_id=o.id)
      )
          then 'merchant_compliance_expired_before_dispatch'
        when m.status<>'active' then 'merchant_inactive_before_dispatch'
        when m.last_seen_at is null
          or m.last_seen_at<clock_timestamp()-interval '10 minutes'
          then 'merchant_offline_before_dispatch'
        else 'delivery_capability_changed_before_dispatch'
      end as rescue_reason
    from public.orders o
    join public.merchants m on m.id=o.merchant_id
    where o.status in ('PREPARING','AT_RISK')
      and o.dispatched_at is null
      and (
        not public.merchant_basket_compliance_current(
        o.merchant_id,
        array(select oi.product_code from public.order_items oi where oi.order_id=o.id)
      )
        or m.status<>'active'
        or m.last_seen_at is null
        or m.last_seen_at<clock_timestamp()-interval '10 minutes'
        or not public.merchant_cart_delivery_compatible(
          o.merchant_id,
          array(
            select oi.product_code
            from public.order_items oi
            where oi.order_id=o.id
            order by oi.product_code
          )
        )
      )
    order by o.updated_at
    limit 100
  loop
    v_rescue:=public.system_release_and_rescue_accepted_order(
      v_row.id,
      v_row.rescue_reason,
      null,
      'Pedido redirecionado antes da saída',
      'A revenda ficou indisponível antes da saída; o estoque foi devolvido e o matching automático foi reexecutado.'
    );
    if coalesce((v_rescue->>'ok')::boolean,false) then
      v_accepted_rescue_count:=v_accepted_rescue_count+1;
    end if;
  end loop;

  for v_row in
    update public.orders
    set status='AT_RISK',
        risk_reason='Saída ainda não confirmada',
        version=version+1,
        updated_at=clock_timestamp()
    where status='PREPARING'
      and dispatch_due_at is not null
      and dispatch_due_at<=clock_timestamp()
    returning id
  loop
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_row.id,null,'system','AT_RISK',
      'Saída ainda não confirmada',
      'A janela de preparação terminou sem confirmação real de saída.'
    );
    v_risk_count:=v_risk_count+1;
  end loop;

  for v_row in
    update public.orders
    set risk_reason='Entrega fora da janela prevista',
        version=version+1,
        updated_at=clock_timestamp()
    where status in ('OUT_FOR_DELIVERY','ARRIVING')
      and promised_by is not null
      and promised_by<=clock_timestamp()
      and risk_reason is distinct from 'Entrega fora da janela prevista'
    returning id
  loop
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail
    )
    values(
      v_row.id,null,'system','ETA_RISK',
      'Entrega fora da janela prevista',
      'O prazo máximo estimado foi ultrapassado; o pedido continua ativo e monitorado.'
    );
    v_eta_count:=v_eta_count+1;
  end loop;

  return jsonb_build_object(
    'expiredOffersProcessed',v_offer_count,
    'expiredRequotesProcessed',v_requote_count,
    'acceptedOrdersRescued',v_accepted_rescue_count,
    'preparingRisked',v_risk_count,
    'etaRisked',v_eta_count
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.market_supply_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_configured integer:=0;
  v_available integer:=0;
  v_products jsonb:='[]'::jsonb;
begin
  select count(*)
  into v_configured
  from public.merchants m
  where m.status='active'
    and public.merchant_allowed_in_operation_mode(m.id)
    and public.merchant_has_compliant_catalog_item(m.id)
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.price_cents>0
        and public.merchant_basket_compliance_current(m.id,array[ci.product_code])
    );

  select count(*)
  into v_available
  from public.merchants m
  where m.status='active'
    and public.merchant_allowed_in_operation_mode(m.id)
    and public.merchant_has_compliant_catalog_item(m.id)
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
    and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
    and exists(
      select 1
      from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.available_stock>0
        and ci.price_cents>0
        and public.merchant_basket_compliance_current(m.id,array[ci.product_code])
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    );

  select coalesce(jsonb_agg(x.product_code order by x.product_code),'[]'::jsonb)
  into v_products
  from (
    select distinct ci.product_code
    from public.catalog_items ci
    join public.merchants m on m.id=ci.merchant_id
    where m.status='active'
    and public.merchant_allowed_in_operation_mode(m.id)
      and public.merchant_has_compliant_catalog_item(m.id)
      and ci.active
      and ci.price_cents>0
        and public.merchant_basket_compliance_current(m.id,array[ci.product_code])
  ) x;

  return jsonb_build_object(
    'realSupplyConfigured',v_configured>0,
    'configuredMerchantCount',v_configured,
    'availableNow',v_available>0,
    'availableMerchantCount',v_available,
    'productCodes',v_products
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.platform_launch_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_control public.platform_launch_control%rowtype;
  v_supply jsonb;
  v_active_admins integer:=0;
  v_owner_ready integer:=0;
  v_payment_ready integer:=0;
  v_offer_ready integer:=0;
  v_configured_merchants integer:=0;
  v_portals_fresh boolean:=false;
  v_database_ready boolean:=false;
  v_warnings text[]:=array[]::text[];
  v_security text[]:=array[]::text[];
  v_unresolved text[]:=array[]::text[];
  v_warning_details jsonb:='[]'::jsonb;
  v_requirement text;
  v_conf_status text;
  v_conf_reason text;
  v_conf_actor uuid;
  v_conf_at timestamptz;
  v_conf_expires timestamptz;
  v_confirmed boolean;
  v_state text;
begin
  select *
  into v_control
  from public.platform_launch_control
  where singleton=true;

  if not found then
    raise exception 'LAUNCH_CONTROL_MISSING' using errcode='P0002';
  end if;

  select count(*)::integer
  into v_active_admins
  from public.platform_admins
  where active;

  v_supply:=public.market_supply_status();
  v_configured_merchants:=coalesce((v_supply->>'configuredMerchantCount')::integer,0);

  select count(distinct m.id)::integer
  into v_owner_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_has_compliant_catalog_item(m.id)
    and exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=m.id and mm.active and mm.member_role='owner'
    )
    and exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=m.id and ci.active and ci.price_cents>0
    );

  select count(distinct m.id)::integer
  into v_payment_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_has_compliant_catalog_item(m.id)
    and exists(
      select 1 from public.merchant_payment_methods p
      where p.merchant_id=m.id and p.active
    )
    and exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=m.id and ci.active and ci.price_cents>0
    );

  select count(distinct m.id)::integer
  into v_offer_ready
  from public.merchants m
  where m.status='active'
    and public.merchant_has_compliant_catalog_item(m.id)
    and m.online
    and m.accepts_citywide
    and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
    and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
    and exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=m.id and mm.active and mm.member_role='owner'
    )
    and exists(
      select 1 from public.merchant_payment_methods p
      where p.merchant_id=m.id and p.active
    )
    and exists(
      select 1 from public.catalog_items ci
      where ci.merchant_id=m.id
        and ci.active
        and ci.available_stock>0
        and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    );

  v_portals_fresh:=
    v_control.portals_verified_at is not null
    and v_control.portals_verified_at>=statement_timestamp()-interval '60 minutes'
    and v_control.customer_portal_ok
    and v_control.merchant_portal_ok
    and v_control.admin_portal_ok
    and v_control.portals_source_sha is not null;

  v_database_ready:=
    v_active_admins>0
    and coalesce((v_supply->>'realSupplyConfigured')::boolean,false)
    and v_configured_merchants>0
    and v_owner_ready>0
    and v_payment_ready>0
    and v_offer_ready>0;

  -- Segurança fundamental: medir privilégio EFETIVO, incluindo herança de PUBLIC.
  -- O data plane do TAMÃO é Edge/RPC server-side; browser não deve ter DML direto
  -- em nenhuma tabela public.
  if exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and (
        pg_catalog.has_table_privilege('anon',c.oid,'SELECT')
        or pg_catalog.has_table_privilege('anon',c.oid,'INSERT')
        or pg_catalog.has_table_privilege('anon',c.oid,'UPDATE')
        or pg_catalog.has_table_privilege('anon',c.oid,'DELETE')
        or pg_catalog.has_table_privilege('anon',c.oid,'TRUNCATE')
        or pg_catalog.has_table_privilege('anon',c.oid,'REFERENCES')
        or pg_catalog.has_table_privilege('anon',c.oid,'TRIGGER')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'TRUNCATE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'REFERENCES')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'TRIGGER')
      )
  ) then
    v_security:=array_append(v_security,'browser_sensitive_table_acl');
  end if;

  -- Toda tabela public do produto precisa permanecer RLS-on, inclusive tabelas
  -- adicionadas no futuro que ainda não existiam quando a allowlist original nasceu.
  if exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and not c.relrowsecurity
  ) then
    v_security:=array_append(v_security,'sensitive_table_rls_disabled');
  end if;

  -- Detectar EXECUTE efetivo (inclusive PUBLIC) em qualquer SECURITY DEFINER.
  -- Única exceção intencional: claim_my_pilot_partner_invite(uuid,text), que
  -- deriva o usuário de auth.uid() e foi desenhado para authenticated.
  if exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and p.oid<>'public.claim_my_pilot_partner_invite(uuid,text)'::pg_catalog.regprocedure
      and (
        pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      )
  ) then
    v_security:=array_append(v_security,'admin_rpc_browser_exposure');
  end if;

  -- Negócio/operação: vira warning confirmável, não bloqueio técnico absoluto.
  if v_active_admins<1 then
    v_warnings:=array_append(v_warnings,'admin_required');
  end if;
  if not coalesce((v_supply->>'realSupplyConfigured')::boolean,false) then
    v_warnings:=array_append(v_warnings,'real_supply_required');
  end if;
  if v_owner_ready<1 then
    v_warnings:=array_append(v_warnings,'merchant_owner_required');
  end if;
  if v_payment_ready<1 then
    v_warnings:=array_append(v_warnings,'merchant_payment_required');
  end if;
  if v_offer_ready<1 then
    v_warnings:=array_append(v_warnings,'offerable_supply_required');
  end if;
  if not v_portals_fresh then
    v_security:=array_append(v_security,'live_portals_verification_required');
  end if;

  foreach v_requirement in array v_warnings loop
    v_conf_status:=null;
    v_conf_reason:=null;
    v_conf_actor:=null;
    v_conf_at:=null;
    v_conf_expires:=null;

    select c.status,c.reason,c.actor_user_id,c.confirmed_at,c.expires_at
    into v_conf_status,v_conf_reason,v_conf_actor,v_conf_at,v_conf_expires
    from public.platform_launch_confirmations c
    where c.requirement_key=v_requirement
    order by c.confirmed_at desc,c.id desc
    limit 1;

    v_confirmed:=coalesce(
      v_conf_status='confirmed'
      and (v_conf_expires is null or v_conf_expires>statement_timestamp()),
      false
    );

    if not v_confirmed then
      v_unresolved:=array_append(v_unresolved,v_requirement);
    end if;

    v_warning_details:=v_warning_details||jsonb_build_array(
      jsonb_build_object(
        'key',v_requirement,
        'status',case
          when v_confirmed then 'CONFIRMADO_PELO_ADMIN'
          when v_conf_status='confirmed' and v_conf_expires<=statement_timestamp() then 'ATENCAO'
          else 'PENDENTE'
        end,
        'confirmed',v_confirmed,
        'reason',v_conf_reason,
        'confirmedBy',v_conf_actor,
        'confirmedAt',v_conf_at,
        'expiresAt',v_conf_expires,
        'condition',case v_requirement
          when 'admin_required' then 'Nenhum administrador ativo foi detectado.'
          when 'real_supply_required' then 'Ainda não existe oferta real configurada.'
          when 'merchant_owner_required' then 'Nenhuma revenda elegível possui owner operacional ativo.'
          when 'merchant_payment_required' then 'Nenhuma revenda elegível possui forma de pagamento ativa.'
          when 'offerable_supply_required' then 'Nenhuma revenda está ofertável agora com estoque, preço, taxa e heartbeat frescos.'
          when 'live_portals_verification_required' then 'Os três portais live não possuem atestado recente e consistente.'
          else v_requirement
        end,
        'risk',case v_requirement
          when 'admin_required' then 'A operação pode ficar sem autoridade humana disponível.'
          when 'real_supply_required' then 'Clientes podem chegar sem oferta real configurada.'
          when 'merchant_owner_required' then 'A revenda pode não ter responsável operacional apto.'
          when 'merchant_payment_required' then 'O pedido pode não ter meio de pagamento operacional definido.'
          when 'offerable_supply_required' then 'A operação pode abrir sem capacidade imediata de atendimento.'
          when 'live_portals_verification_required' then 'Um portal pode estar indisponível ou com bundle divergente.'
          else 'Pendência operacional.'
        end,
        'recommendation',case v_requirement
          when 'admin_required' then 'Ative ao menos um administrador permanente.'
          when 'real_supply_required' then 'Converta e valide o primeiro parceiro real.'
          when 'merchant_owner_required' then 'Vincule um owner permanente à revenda.'
          when 'merchant_payment_required' then 'Cadastre Pix, dinheiro, cartão na entrega ou outro método aceito.'
          when 'offerable_supply_required' then 'Reconfirme disponibilidade, estoque, preço e capacidade de entrega.'
          when 'live_portals_verification_required' then 'Execute a verificação dos portais e Turnstile.'
          else 'Revise a condição antes de continuar.'
        end
      )
    );
  end loop;

  v_state:=case
    when cardinality(v_security)>0 then 'BLOCKED_SECURITY'
    when cardinality(v_warnings)>0 then 'READY_WITH_WARNINGS'
    else 'READY'
  end;

  return jsonb_build_object(
    'readinessState',v_state,
    'operationMode',v_control.operation_mode,
    'commerceEnabled',v_control.commerce_enabled,
    'databaseReady',v_database_ready,
    'readyToEnable',cardinality(v_security)=0 and cardinality(v_unresolved)=0,
    'canActivateOperation',cardinality(v_security)=0 and cardinality(v_unresolved)=0,
    'allWarningsConfirmed',cardinality(v_unresolved)=0,
    'activeAdminCount',v_active_admins,
    'configuredMerchantCount',v_configured_merchants,
    'ownerReadyMerchantCount',v_owner_ready,
    'paymentReadyMerchantCount',v_payment_ready,
    'offerReadyMerchantCount',v_offer_ready,
    'availableNow',coalesce((v_supply->>'availableNow')::boolean,false),
    'availableMerchantCount',coalesce((v_supply->>'availableMerchantCount')::integer,0),
    'portalsFresh',v_portals_fresh,
    'portalsVerifiedAt',v_control.portals_verified_at,
    'portalsSourceSha',v_control.portals_source_sha,
    'customerPortalOk',v_control.customer_portal_ok,
    'merchantPortalOk',v_control.merchant_portal_ok,
    'adminPortalOk',v_control.admin_portal_ok,
    'securityBlockers',to_jsonb(v_security),
    'warnings',to_jsonb(v_warnings),
    'warningDetails',v_warning_details,
    'unresolvedWarnings',to_jsonb(v_unresolved),
    -- Compatibilidade com UI anterior: blockers agora significa warnings ainda não confirmados.
    'blockers',to_jsonb(v_unresolved),
    'supply',v_supply
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_merchant_readiness_snapshot(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  with readiness as (
    select
      m.id as merchant_id,
      m.name,
      m.status,
      coalesce(m.online,false) as online_ready,
      exists(
        select 1
        from public.merchant_members mm
        where mm.merchant_id=m.id
          and mm.active
          and mm.member_role='owner'
      ) as owner_ready,
      public.merchant_has_compliant_catalog_item(m.id) as compliance_ready,
      exists(
        select 1
        from public.merchant_payment_methods pm
        where pm.merchant_id=m.id
          and pm.active
      ) as payment_ready,
      exists(
        select 1
        from public.catalog_items ci
        where ci.merchant_id=m.id
          and ci.active
          and ci.price_cents>0
      ) as catalog_configured,
      exists(
        select 1
        from public.catalog_items ci
        where ci.merchant_id=m.id
          and ci.active
          and ci.available_stock>0
          and ci.price_cents>0
          and ci.price_confirmed_at is not null
          and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
      ) as inventory_price_ready,
      (
        coalesce(m.accepts_citywide,false)
        and m.delivery_fee_confirmed_at is not null
        and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
      ) as delivery_ready,
      (m.status='active') as merchant_active,
      (
        m.last_seen_at is not null
        and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
      ) as heartbeat_fresh
    from public.merchants m
  ),
  normalized as (
    select
      r.*,
      (
        r.catalog_configured
        and r.inventory_price_ready
        and r.delivery_ready
      ) as commercial_ready,
      (
        r.owner_ready
        and r.compliance_ready
        and r.payment_ready
        and r.catalog_configured
        and r.inventory_price_ready
        and r.delivery_ready
        and r.merchant_active
        and r.online_ready
        and r.heartbeat_fresh
      ) as offer_ready
    from readiness r
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'merchantId',n.merchant_id,
        'name',n.name,
        'merchantStatus',n.status,
        'ownerReady',n.owner_ready,
        'complianceReady',n.compliance_ready,
        'paymentReady',n.payment_ready,
        'catalogConfigured',n.catalog_configured,
        'inventoryPriceReady',n.inventory_price_ready,
        'deliveryReady',n.delivery_ready,
        'commercialReady',n.commercial_ready,
        'merchantActive',n.merchant_active,
        'online',n.online_ready,
        'heartbeatFresh',n.heartbeat_fresh,
        'offerReady',n.offer_ready,
        'nextAction',case
          when not n.owner_ready then 'assign_owner'
          when not n.compliance_ready then 'verify_compliance'
          when not n.payment_ready then 'confirm_payment'
          when not n.catalog_configured or not n.inventory_price_ready then 'confirm_offer'
          when not n.delivery_ready then 'confirm_logistics'
          when not n.merchant_active then 'activate_merchant'
          when not n.online_ready then 'go_online'
          when not n.heartbeat_fresh then 'refresh_heartbeat'
          else 'ready'
        end
      )
      order by n.name,n.merchant_id
    ),
    '[]'::jsonb
  )
  into v_result
  from normalized n;

  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.filter_delivery_compatible_merchants(p_merchant_ids uuid[], p_product_codes text[])
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(array_agg(m order by m),array[]::uuid[])
  from unnest(p_merchant_ids) m
  where public.merchant_cart_delivery_compatible(m,p_product_codes)
  and public.merchant_basket_compliance_current(m,p_product_codes);
$function$;


-- A city is eligible if at least one SKU with current legal authority is sellable.
create or replace function public.market_city_offer_scope(p_city text,p_state text)
returns uuid[]
language sql stable security definer
set search_path to pg_catalog
as $func$
with requested as (
  select public.market_city_key(p_city) as city_key,
         upper(trim(coalesce(p_state,''))) as state
)
select coalesce(array_agg(m.id order by m.id),array[]::uuid[])
from requested r
join public.merchant_business_details d
  on upper(trim(d.state))=r.state
 and public.market_city_key(d.city)=r.city_key
join public.merchants m on m.id=d.merchant_id
where char_length(r.city_key)>=2
  and r.state ~ '^[A-Z]{2}$'
  and m.status='active'
  and m.online
  and m.accepts_citywide
  and m.last_seen_at>=statement_timestamp()-interval '10 minutes'
  and m.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'
  and public.merchant_cnpj_compliance_current(m.id)
  and public.merchant_allowed_in_operation_mode(m.id)
  and public.merchant_financial_sales_allowed(m.id)
  and exists (
    select 1 from public.platform_launch_control lc
    where lc.singleton and lc.commerce_enabled
      and lc.operation_mode in ('LIVE','PILOT')
  )
  and not exists (
    select 1 from public.market_cities mc
    where mc.state=r.state and mc.city_key=r.city_key and mc.admin_paused
  )
  and exists (
    select 1 from public.catalog_items ci
    where ci.merchant_id=m.id and ci.active
      and ci.available_stock>0 and ci.price_cents>0
      and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
      and public.merchant_basket_compliance_current(m.id,array[ci.product_code])
  )
  and exists (
    select 1 from public.merchant_payment_methods pm
    where pm.merchant_id=m.id and pm.active
      and public.merchant_delivery_payment_allowed(m.id,pm.payment_method)
  );
$func$;
revoke all on function public.market_city_offer_scope(text,text)
  from public,anon,authenticated;
grant execute on function public.market_city_offer_scope(text,text)
  to service_role;



-- V1.158 diagnostic must not describe GLP pending as a total merchant blocker.
create or replace function public.merchant_enablement_diagnostic_v1_158(p_actor_user_id uuid,p_merchant_id uuid)
returns table(
  merchant_id uuid, merchant_name text, cnpj text, city text, state text,
  merchant_status text, ready boolean, blocker_count integer,
  checks jsonb, checked_at timestamptz
)
language sql stable security definer
set search_path to pg_catalog
as $func$
with target as materialized (
  select m.id,m.name,m.cnpj,m.status,m.online,m.accepts_citywide,
    m.last_seen_at,m.delivery_fee_confirmed_at,
    d.city,d.state
  from public.merchants m
  left join public.merchant_business_details d on d.merchant_id=m.id
  where m.id=p_merchant_id
    and exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=m.id and mm.user_id=p_actor_user_id
        and mm.active and mm.member_role in ('owner','manager')
    )
  limit 1
), checked as (
  select t.*,
    (coalesce(t.city,'')<>'' and t.state ~ '^[A-Z]{2}$') as has_region,
    exists (
      select 1 from public.platform_launch_control lc
      where lc.singleton and lc.commerce_enabled and lc.operation_mode in ('LIVE','PILOT')
    ) as global_commerce_enabled,
    public.merchant_allowed_in_operation_mode(t.id) as mode_allowed,
    public.merchant_cnpj_compliance_current(t.id) as cnpj_ok,
    public.merchant_has_compliant_catalog_item(t.id) as category_ok,
    public.merchant_financial_sales_allowed(t.id) as finance_ok,
    exists (
      select 1 from public.catalog_items ci
      where ci.merchant_id=t.id and ci.active
        and ci.available_stock>0 and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
        and public.merchant_basket_compliance_current(t.id,array[ci.product_code])
    ) as stock_price_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
    ) as payment_method_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
        and public.merchant_delivery_payment_allowed(t.id,pm.payment_method)
    ) as payment_route_ok,
    not exists (
      select 1 from public.market_cities mc
      where mc.state=upper(trim(t.state))
        and mc.city_key=public.market_city_key(t.city)
        and mc.admin_paused
    ) as city_not_paused,
    case
      when t.state ~ '^[A-Z]{2}$' and length(coalesce(t.city,''))>=2 then
        t.id=any(public.market_city_offer_scope(t.city,t.state))
      else false
    end as authoritative_offer_ready
  from target t
)
select c.id,c.name,c.cnpj,c.city,c.state,c.status,
  c.authoritative_offer_ready as ready,
  (select count(*)::integer from (
      values
      (c.status='active'),
      (c.online),
      (c.accepts_citywide),
      (c.last_seen_at>=statement_timestamp()-interval '10 minutes'),
      (c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'),
      (c.has_region),
      (c.cnpj_ok),
      (c.category_ok),
      (c.mode_allowed),
      (c.global_commerce_enabled),
      (c.city_not_paused),
      (c.finance_ok),
      (c.stock_price_ok),
      (c.payment_method_ok),
      (c.payment_route_ok),
      (c.authoritative_offer_ready)
    ) as req(ok) where req.ok is not true) as blocker_count,
  (select coalesce(jsonb_agg(
      jsonb_build_object('key',req.key,'label',req.label,'ok',coalesce(req.ok,false),
        'action',req.action,'owner',req.owner,'scope',req.scope)
       order by req.sort
    ),'[]'::jsonb)
    from (values
      (10,'merchant_status','Cadastro e ativação',c.status='active',
        'Validar e ativar o cadastro no Admin após aprovação documental','admin','merchant'),
      (20,'cnpj','Regularidade do CNPJ',c.cnpj_ok,
        'Conferir documento, validade e confirmação do CNPJ','admin','merchant'),
      (30,'product_authority','Existe produto com autorização válida',c.category_ok,
        'GLP requer ANP válida; outros produtos podem ser comercializados conforme suas próprias regras','admin','merchant'),
      (40,'operation_mode','Modo operacional da revenda',c.mode_allowed,
        'Verificar regras do modo operacional vigente, inclusive exigências específicas','admin','global'),
      (50,'global_commerce','Comércio habilitado na plataforma',c.global_commerce_enabled,
        'Verificar controles globais do TAMÃO; não habilitar vendas somente para eliminar bloqueio','admin','global'),
      (60,'location','Município e UF informados',c.has_region,
        'Conferir o endereço da revenda e seu município de atuação','admin','merchant'),
      (70,'city_pause','Cidade sem pausa administrativa',c.city_not_paused,
        'Conferir o motivo de pausa da cidade no painel de expansão','admin','city'),
      (80,'financial','Situação financeira liberada',c.finance_ok,
        'Conferir suspensão de vendas e pendências financeiras','admin','merchant'),
      (90,'inventory','Produto ativo com estoque e preço recente',c.stock_price_ok,
        'Ativar um produto permitido, informar estoque positivo e confirmar preço atualizado','merchant','merchant'),
      (100,'payment_method','Forma de pagamento ativa',c.payment_method_ok,
        'Habilitar uma forma de pagamento aceita pelo estabelecimento','merchant','merchant'),
      (110,'payment_route','Pagamento na entrega disponível',c.payment_route_ok,
        'Ative Pix, dinheiro ou cartão na entrega; não é necessário conectar um PSP para começar','merchant','merchant'),
      (120,'delivery_area','Cobertura de entrega da cidade',c.accepts_citywide,
        'Confirmar capacidade de atender a cidade conforme as regras do produto','merchant','merchant'),
      (130,'delivery_fee','Preço de entrega atualizado',c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours',
        'Confirmar taxa de entrega da revenda para os próximos pedidos','merchant','merchant'),
      (140,'online','Revenda disponível',c.online,
        'Entrar no painel da revenda e confirmar disponibilidade','merchant','realtime'),
      (150,'heartbeat','Presença atualizada',c.last_seen_at>=statement_timestamp()-interval '10 minutes',
        'Conferir conexão e presença recente da revenda','merchant','realtime'),
      (160,'quote_authority','Autorização final para novas cotações',c.authoritative_offer_ready,
        'Revisar os bloqueios acima; o motor de cotações é a autoridade final','system','realtime')
    ) as req(sort,key,label,ok,action,owner,scope)
  ) as checks,
  statement_timestamp() as checked_at
from checked c
order by c.authoritative_offer_ready asc, c.name,c.id;
$func$;
revoke all on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.merchant_enablement_diagnostic_v1_158(uuid,uuid)
  to service_role;

-- Real SQL lifecycle through merchant acceptance, dispatch, PIN and postpaid fee.
-- Requires V1.158.1 -> V1.158.2 -> V1.158.3; test data rollback only.
begin;
do $full_order$
declare
  customer_user uuid;
  merchant_user uuid;
  merchant_uuid uuid;
  order_uuid uuid;
  current_version integer;
  pin text;
  result jsonb;
  initial_fee integer;
  rejected boolean:=false;
begin
  insert into auth.users(id,aud,role,email)
  values(gen_random_uuid(),'authenticated','authenticated',
    'tamao-customer-'||substr(gen_random_uuid()::text,1,8)||'@example.invalid')
  returning id into customer_user;

  insert into auth.users(id,aud,role,email)
  values(gen_random_uuid(),'authenticated','authenticated',
    'tamao-merchant-'||substr(gen_random_uuid()::text,1,8)||'@example.invalid')
  returning id into merchant_user;

  update public.platform_launch_control
  set commerce_enabled=true,operation_mode='LIVE',
    enabled_at=statement_timestamp(),enabled_by=merchant_user,
    portals_source_sha=repeat('a',40),mode_source_sha=repeat('a',40)
  where singleton=true;

  insert into public.merchants(
    name,cnpj,status,online,accepts_citywide,last_seen_at,
    delivery_fee_confirmed_at,delivery_fee_cents
  ) values(
    'TAMÃO FULL ORDER TEST','00000000000001','pending',false,true,
    statement_timestamp(),statement_timestamp(),0
  ) returning id into merchant_uuid;
  insert into public.merchant_compliance(
    merchant_id,cnpj_status,cnpj_verified_at,anp_status
  ) values(merchant_uuid,'verified',statement_timestamp(),'pending');
  update public.merchants set status='active',online=true where id=merchant_uuid;

  insert into public.merchant_members(merchant_id,user_id,member_role,active)
  values(merchant_uuid,merchant_user,'owner',true);

  insert into public.catalog_items(
    merchant_id,product_code,product_name,price_cents,
    min_price_cents,max_price_cents,available_stock,active,price_confirmed_at
  ) values(merchant_uuid,'CHARCOAL4','Carvão 4kg',12000,12000,12000,
    4,true,statement_timestamp());

  insert into public.merchant_payment_methods(
    merchant_id,payment_method,active,confirmed_at
  ) values(merchant_uuid,'cash',true,statement_timestamp());

  insert into public.merchant_payment_routes(
    merchant_id,payment_method,provider,channel,verification_mode,
    active,customer_label,metadata
  ) values(merchant_uuid,'cash','manual','delivery',
      'merchant_confirmed',true,'Dinheiro na entrega',
      '{"fundsOwner":"merchant"}'::jsonb);

  insert into public.orders(
    public_code,customer_id,status,address_text,address_number,postal_code,
    customer_phone_digits,payment_method,gross_total_cents,total_cents,
    delivery_fee_cents_snapshot,
    merchant_id,attempted_merchant_ids,offer_expires_at,version
  ) values(
    'PIN-TEST-'||substr(merchant_uuid::text,1,12),customer_user,
    'OFFERED_TO_MERCHANT','Rua Teste, 20 - São Gabriel/RS','20','97300000',
    '51999998888','cash',12000,12000,0,merchant_uuid,array[merchant_uuid],
    statement_timestamp()+interval '10 minutes',1
  ) returning id into order_uuid;

  insert into public.order_items(order_id,product_code,product_name,quantity,
    unit_price_cents,line_total_cents)
  values(order_uuid,'CHARCOAL4','Carvão 4kg',1,12000,12000);

  result:=public.merchant_order_action(
    merchant_user,order_uuid,'accept',1,
    'v1583-accept-'||substr(order_uuid::text,1,14),repeat('a',64)
  );
  if result->>'status'<>'PREPARING' then
    raise exception 'TEST_FAIL: accept must reach PREPARING: %',result;
  end if;

  select version into current_version from public.orders where id=order_uuid;
  result:=public.merchant_order_action(
    merchant_user,order_uuid,'dispatch',current_version,
    'v1583-dispatch-'||substr(order_uuid::text,1,14),repeat('b',64)
  );
  if result->>'status'<>'OUT_FOR_DELIVERY' then
    raise exception 'TEST_FAIL: dispatch did not create delivery';
  end if;
  select pin_code into pin from public.order_delivery_secrets
  where order_id=order_uuid;
  if pin is null or pin!~'^[0-9]{4}$' then
    raise exception 'TEST_FAIL: secure delivery PIN missing';
  end if;

  select version into current_version from public.orders where id=order_uuid;
  result:=public.merchant_order_action(
    merchant_user,order_uuid,'arriving',current_version,
    'v1583-arriving-'||substr(order_uuid::text,1,14),repeat('c',64)
  );
  if result->>'status'<>'ARRIVING' then
    raise exception 'TEST_FAIL: arriving status missing';
  end if;

  select version into current_version from public.orders where id=order_uuid;
  result:=public.complete_order_delivery(
    merchant_user,order_uuid,
    case when pin='0000' then '1111' else '0000' end,
    current_version,
    'v1583-wrongpin-'||substr(order_uuid::text,1,14),repeat('e',64),true
  );
  if result->>'error'<>'INVALID_PIN' or result->>'status'<>'ARRIVING' then
    raise exception 'TEST_FAIL: incorrect PIN was not rejected';
  end if;
  if exists(select 1 from public.platform_receivables where order_id=order_uuid) then
    raise exception 'TEST_FAIL: invalid PIN generated fee';
  end if;

  select version into current_version from public.orders where id=order_uuid;
  begin
    perform public.complete_order_delivery(
      merchant_user,order_uuid,pin,current_version,
      'v1583-unpaid-'||substr(order_uuid::text,1,14),repeat('f',64),false
    );
  exception when sqlstate '40001' then
    rejected:=true;
  end;
  if not rejected or
    (select status from public.orders where id=order_uuid)<>'ARRIVING' then
    raise exception 'TEST_FAIL: no attestation settled unpaid delivery';
  end if;

  select version into current_version from public.orders where id=order_uuid;
  result:=public.complete_order_delivery(
    merchant_user,order_uuid,pin,current_version,
    'v1583-complete-'||substr(order_uuid::text,1,14),
    repeat('d',64),true
  );
  if result->>'status'<>'SETTLED' then
    raise exception 'TEST_FAIL: PIN did not settle order: %',result;
  end if;

  result:=public.complete_order_delivery(
    merchant_user,order_uuid,pin,current_version,
    'v1583-complete-'||substr(order_uuid::text,1,14),
    repeat('d',64),true
  );
  if result->>'status'<>'SETTLED' then
    raise exception 'TEST_FAIL: idempotent PIN replay failed';
  end if;

  perform public.process_deferred_settlement_accounting();
  select platform_fee_cents into initial_fee
  from public.platform_receivables where order_id=order_uuid;
  if initial_fee is null or initial_fee<=0 then
    raise exception 'TEST_FAIL: confirmed PIN delivery did not produce fee';
  end if;
  perform public.process_deferred_settlement_accounting();
  if (select count(*) from public.platform_receivables
      where order_id=order_uuid)<>1 then
    raise exception 'TEST_FAIL: duplicate fee after retry';
  end if;

  if not exists(select 1 from public.merchant_sale_payment_verifications
    where order_id=order_uuid and verification_level='merchant'
      and status='verified') then
    raise exception 'TEST_FAIL: merchant payment attestation missing';
  end if;
  raise notice 'PASS: offer/accept/wrong PIN/unpaid reject/correct PIN/settled/postpaid/replay'; 
end;
$full_order$;
rollback;

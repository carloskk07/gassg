-- V1.158.1 — transient PostgreSQL integration probes.
-- Precondition: V1.158.1 migration already applied in a staging database.
-- BEGIN/ROLLBACK ensure no merchant, financial account or payment route persists.
-- Safe to run in SQL editor; inspect PASS notice and absence of SQL errors.
begin;

do $probe$
declare
  v_merchant uuid;
  v_route uuid;
  v_rejected boolean:=false;
  v_plan text;
  v_balance bigint;
  v_hold boolean;
begin
  insert into public.merchants(name,cnpj,status,online)
  values('TAMÃO TESTE TRANSACIONAL','00000000000001','pending',false)
  returning id into v_merchant;

  select plan_key, credit_balance_cents, sales_hold
  into v_plan,v_balance,v_hold
  from public.merchant_billing_accounts
  where merchant_id=v_merchant;

  if v_plan<>'flex_daily' or v_balance<>0 or v_hold is distinct from false then
    raise exception 'TEST_FAIL: New merchant cannot enter Flex Daily without prepaid credits';
  end if;

  insert into public.merchant_payment_methods(
    merchant_id,payment_method,active,confirmed_at
  ) values(v_merchant,'pix',true,clock_timestamp());

  insert into public.merchant_payment_routes(
    merchant_id,payment_method,provider,channel,verification_mode,
    active,customer_label,metadata
  )
  values(v_merchant,'pix','stone','delivery','merchant_confirmed',true,
         'Pix na entrega',
         '{"merchantDeclaredProvider":true,"manualProviderFallback":true,"automaticVerification":false,"fundsOwner":"merchant"}'::jsonb)
  returning id into v_route;

  if not public.merchant_delivery_payment_allowed(v_merchant,'pix') then
    raise exception 'TEST_FAIL: Declared Stone Pix on delivery denied';
  end if;
  if not (v_merchant=any(public.market_filter_delivery_payment_merchants(
    array[v_merchant]::uuid[],'pix'
  ))) then
    raise exception 'TEST_FAIL: Merchant filter differs from COD authorization';
  end if;
  if cardinality(public.market_filter_delivery_payment_merchants(
    array[v_merchant]::uuid[],'card'
  ))<>0 then
    raise exception 'TEST_FAIL: Merchant filter allowed nonexistent card';
  end if;
  if public.merchant_delivery_payment_allowed(v_merchant,'card') then
    raise exception 'TEST_FAIL: Unconfigured card route accepted';
  end if;

  update public.merchant_payment_routes set channel='external' where id=v_route;
  if public.merchant_delivery_payment_allowed(v_merchant,'pix') then
    raise exception 'TEST_FAIL: External manual Pix authorized as delivery';
  end if;

  begin
    update public.merchant_payment_routes set channel='online' where id=v_route;
  exception when check_violation then
    v_rejected:=true;
  end;

  if not v_rejected then
    raise exception 'TEST_FAIL: Declared manual provider escaped to online';
  end if;

  update public.merchant_payment_routes
  set channel='delivery',active=false where id=v_route;
  if public.merchant_delivery_payment_allowed(v_merchant,'pix') then
    raise exception 'TEST_FAIL: Disabled payment route still active';
  end if;

  update public.merchant_payment_routes
  set active=true where id=v_route;
  update public.merchant_payment_methods
  set active=false where merchant_id=v_merchant and payment_method='pix';
  if public.merchant_delivery_payment_allowed(v_merchant,'pix') then
    raise exception 'TEST_FAIL: Disabled payment method still active';
  end if;

  raise notice 'PASS: Pix delivery, manual PSP, no prepaid credit, negative route tests';
end;
$probe$;

rollback;

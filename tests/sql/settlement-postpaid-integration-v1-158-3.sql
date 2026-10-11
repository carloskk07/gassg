-- PostgreSQL executable fixture for V1.158.3 financial settlement invariants.
-- Requires migrations V1.158.1 -> V1.158.2 -> V1.158.3.
-- BEGIN/ROLLBACK ensure zero persistent accounts, merchant, order, ledger or statement.
begin;
do $settlement_test$
declare
  v_merchant uuid;
  v_user uuid;
  v_order uuid;
  v_cancelled uuid;
  v_result jsonb;
  v_due timestamptz;
  v_fee integer;
  v_rejected boolean:=false;
begin
  insert into auth.users(id,aud,role,email)
  values(gen_random_uuid(),'authenticated','authenticated',
    'tamao-settlement-test-'||substr(gen_random_uuid()::text,1,8)||'@example.invalid')
  returning id into v_user;

  -- Transaction-local enablement, never visible after ROLLBACK.
  update public.platform_launch_control
  set commerce_enabled=true,operation_mode='LIVE',
      enabled_at=statement_timestamp(),enabled_by=v_user,
      portals_source_sha=repeat('a',40),mode_source_sha=repeat('a',40)
  where singleton=true;

  insert into public.merchants(name,cnpj,status,online)
  values('TAMÃO V1.158.3 TESTE FINANCEIRO','00000000000001','pending',false)
  returning id into v_merchant;
  insert into public.merchant_compliance(
    merchant_id,cnpj_status,cnpj_verified_at,anp_status
  ) values(v_merchant,'verified',statement_timestamp(),'pending');
  update public.merchants set status='active' where id=v_merchant;

  insert into public.merchant_payment_methods(
    merchant_id,payment_method,active,confirmed_at
  ) values(v_merchant,'cash',true,statement_timestamp());
  insert into public.merchant_payment_routes(
    merchant_id,payment_method,provider,channel,verification_mode,
    active,customer_label,metadata
  ) values(v_merchant,'cash','manual','delivery',
    'merchant_confirmed',true,'Dinheiro na entrega',
    '{"fundsOwner":"merchant"}'::jsonb);

  insert into public.orders(
    public_code,customer_id,status,address_text,address_number,postal_code,
    customer_phone_digits,payment_method,gross_total_cents,total_cents,
    delivery_fee_cents_snapshot,
    merchant_id,attempted_merchant_ids,version,
    supplier_name_snapshot,accepted_at,delivery_assigned_at,
    dispatched_at,arriving_at,delivered_at,settled_at,
    payment_confirmed_at,payment_confirmation_method,pin_hash,
    financial_state
  ) values(
    'TEST-FIN-'||substr(v_merchant::text,1,10),v_user,'SETTLED',
    'Rua Teste, 20 - São Gabriel/RS','20','97300000',
    '51999998888','cash',12000,12000,0,
    v_merchant,array[v_merchant],3,
    'Revenda Sintética',statement_timestamp()-interval '2 hours',
    statement_timestamp()-interval '1 hour',
    statement_timestamp()-interval '1 hour',
    statement_timestamp()-interval '40 minutes',
    statement_timestamp()-interval '10 minutes',
    statement_timestamp()-interval '10 minutes',
    statement_timestamp()-interval '10 minutes',
    'merchant_attestation',repeat('0',64),'settled'
  ) returning id into v_order;

  insert into public.order_items(
    order_id,product_code,product_name,quantity,unit_price_cents,line_total_cents
  ) values(v_order,'CHARCOAL4','Carvão teste',1,12000,12000);

  v_result:=public.ensure_order_settlement_accounting(v_order);
  select platform_fee_cents,due_at into v_fee,v_due
  from public.platform_receivables where order_id=v_order;

  if v_fee<=0 or v_due is distinct from
    public.merchant_settlement_daily_due_at(statement_timestamp()-interval '10 minutes')
  then
    raise exception 'TEST_FAIL: first actual receivable fee / due';
  end if;
  if (v_result->>'postpaidDueCents')::integer<>v_fee then
    raise exception 'TEST_FAIL: postpaid fee return mismatch';
  end if;
  perform public.ensure_order_settlement_accounting(v_order);
  if (select count(*) from public.platform_receivables where order_id=v_order)<>1 then
    raise exception 'TEST_FAIL: duplicate charge on retry';
  end if;

  begin
    update public.platform_receivables
    set prepaid_credit_applied_cents=10 where order_id=v_order;
  exception when check_violation then
    v_rejected:=true;
  end;
  if not v_rejected then
    raise exception 'TEST_FAIL: immutable applied credit changed';
  end if;

  perform public.close_merchant_daily_finance(
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  );
  if not exists(
    select 1
    from public.merchant_daily_statements s
    join public.platform_receivables p on p.daily_statement_id=s.id
    where p.order_id=v_order and s.merchant_id=v_merchant
      and s.gross_fee_cents=v_fee and s.amount_due_cents=v_fee
      and s.due_at=v_due and p.due_at=v_due
  ) then
    raise exception 'TEST_FAIL: daily statement failed to reconcile receivable';
  end if;
  perform public.close_merchant_daily_finance(
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  );
  if (select count(*) from public.merchant_daily_statements
      where merchant_id=v_merchant)<>1 then
    raise exception 'TEST_FAIL: repeated daily close made duplicate statement';
  end if;
  raise notice 'PASS: settlement, immutable credit, charge replay, daily close replay';
end;
$settlement_test$;
rollback;

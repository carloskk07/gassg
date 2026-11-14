\set ON_ERROR_STOP on
-- ONLY the disposable CI database: synthetic PSP evidence, full ROLLBACK.
begin;
set local statement_timeout='60s';
do $test$
declare
 owner_id uuid:=gen_random_uuid(); v_merchant uuid; plan public.merchant_billing_plans%rowtype;
 prep jsonb; ingested jsonb; applied jsonb; cid uuid; rid uuid; eid uuid;
 v_admin uuid:=gen_random_uuid(); v_owner uuid; v_customer uuid:=gen_random_uuid(); v_order uuid;
 v_version integer; v_pin text; v_order_result jsonb; sid uuid;
 correlation text; order_id text; expected bigint:=0; before_actions bigint; denied boolean;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(owner_id,'authenticated','authenticated',false,'automatic-owner@example.invalid',clock_timestamp());
 insert into public.merchants(name,cnpj,status,online,accepts_citywide,last_seen_at,delivery_fee_confirmed_at,delivery_fee_cents)
 values('ISOLATED AUTOMATIC CREDIT','00000000000002','pending',false,true,clock_timestamp(),clock_timestamp(),0) returning id into v_merchant;
 insert into public.merchant_members(merchant_id,user_id,member_role,active) values(v_merchant,owner_id,'owner',true);
 for plan in select * from public.merchant_billing_plans where active and billing_mode='prepaid_credit' order by sort_order loop
  prep:=public.merchant_billing_pix_charge_prepare_provider(owner_id,v_merchant,plan.plan_key,null,null,'mercadopago',
   'isolated-auto-'||plan.plan_key,repeat('a',64));
  cid:=(prep->>'chargeId')::uuid;rid:=(prep->>'paymentRequestId')::uuid;
  select correlation_id into correlation from public.merchant_billing_provider_charges where id=cid;
  order_id:='ORDISOLATED'||replace(cid::text,'-','');
  update public.merchant_billing_provider_charges set provider_charge_id=order_id where id=cid;
  ingested:=public.ingest_merchant_billing_payment_event('mercadopago','order:'||order_id||':accredited',
   'mp-order:'||order_id,'pix',plan.purchase_amount_cents,'BRL',clock_timestamp(),repeat('b',64),null,correlation);
  eid:=(ingested->>'eventId')::uuid;
  if (select credit_balance_cents from public.merchant_billing_accounts where merchant_id=v_merchant)<>expected then
   raise exception 'receipt alone granted credit';end if;
  denied:=false;
  begin
   update public.merchant_billing_provider_charges set provider_charge_id='ORDTSTISOLATED' where id=cid;
   perform public.apply_verified_merchant_billing_payment(eid,cid);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'sandbox/foreign binding accepted';end if;
  denied:=false;
  begin
   update public.merchant_billing_provider_charges set paid_amount_cents=plan.purchase_amount_cents-1 where id=cid;
   perform public.apply_verified_merchant_billing_payment(eid,cid);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'short payment accepted';end if;
  denied:=false;
  begin
   perform public.ingest_merchant_billing_payment_refund('mercadopago','refund:isolated:'||cid,
    'mp-order:'||order_id,'mp-refund:isolated:'||cid,plan.purchase_amount_cents,'BRL',clock_timestamp(),repeat('c',64));
   perform public.apply_verified_merchant_billing_payment(eid,cid);
  exception when sqlstate '40001' or insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'refunded payment credited';end if;
  applied:=public.apply_verified_merchant_billing_payment(eid,cid);
  if applied->>'applied'<>'true' or applied->>'status'<>'approved' then raise exception 'automatic grant missing:%',applied;end if;
  expected:=expected+plan.credit_grant_cents;
  if (select credit_balance_cents from public.merchant_billing_accounts where merchant_id=v_merchant)<>expected
   or (select count(*) from public.merchant_fee_credit_ledger where payment_request_id=rid and entry_type='package_credit')<>1
   or not exists(select 1 from public.merchant_billing_payment_requests where id=rid and status='approved' and auto_applied and resolved_by is null)
   or not exists(select 1 from public.merchant_billing_payment_events where id=eid and status='applied' and auto_applied and applied_by is null) then
   raise exception 'automatic grant/provenance mismatch';end if;
  applied:=public.apply_verified_merchant_billing_payment(eid,cid);
  if applied->>'replayed'<>'true' or (select count(*) from public.merchant_billing_auto_applications where payment_request_id=rid)<>1 then
   raise exception 'replayed payment was not idempotent';end if;
  perform public.assert_merchant_fee_credit_account_equation(v_merchant);
  set constraints all immediate;
  set constraints all deferred;
 end loop;

 -- Verify the same resolver's postpaid tariff branch with a complete isolated order.
 v_owner:=owner_id;
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_admin,'authenticated','authenticated',false,'automatic-admin@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,active,admin_role) values(v_admin,true,'superadmin');
 update public.merchant_billing_accounts set credit_balance_cents=0 where merchant_id=v_merchant;
 insert into public.merchant_fee_credit_ledger(merchant_id,entry_type,amount_cents,plan_key,reference,created_by)
 values(v_merchant,'admin_adjustment',-expected,'credit_19990','ISOLATED POSTPAID BOUNDARY',v_admin);
 perform public.admin_merchant_billing_action(v_admin,v_merchant,'set-flex',null,null,
  'ISOLATED POSTPAID BOUNDARY','isolated-auto-statement-flex',repeat('d',64));
  -- Exercise the REAL merchant order/PIN/settlement engine against the
  -- synthetically funded account; this is still ONLY disposable CI data.
  INSERT INTO auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
  VALUES(v_customer,'authenticated','authenticated',false,
    'v953-buyer@example.invalid',clock_timestamp());
  UPDATE public.platform_launch_control
  SET commerce_enabled=true,operation_mode='LIVE',
      enabled_at=clock_timestamp(),enabled_by=v_owner,
      portals_source_sha=repeat('a',40),mode_source_sha=repeat('a',40)
  WHERE singleton=true;
  INSERT INTO public.merchant_compliance(
    merchant_id,cnpj_status,cnpj_verified_at,anp_status
  ) VALUES(v_merchant,'verified',clock_timestamp(),'pending');
  -- V1.158.4: even synthetic CI merchants must have an authorized,
  -- verified representative before accepting real order transitions.
  PERFORM public.admin_merchant_representation_action(
    v_admin,v_merchant,v_owner,'verify','legal_representative',
    'SIMULADO: representação conferida apenas no PostgreSQL descartável',
    'AUTO-STATEMENT-representative-'||substr(v_merchant::text,1,10),repeat('9',64)
  );
  UPDATE public.merchants SET status='active',online=true WHERE id=v_merchant;
  INSERT INTO public.catalog_items(
    merchant_id,product_code,product_name,price_cents,
    min_price_cents,max_price_cents,available_stock,active,price_confirmed_at
  ) VALUES(v_merchant,'CHARCOAL4','Carvão 4 kg',12000,12000,12000,4,true,clock_timestamp());
  INSERT INTO public.merchant_payment_methods(
    merchant_id,payment_method,active,confirmed_at
  ) VALUES(v_merchant,'cash',true,clock_timestamp());
  INSERT INTO public.merchant_payment_routes(
    merchant_id,payment_method,provider,channel,verification_mode,
    active,customer_label,metadata
  ) VALUES(v_merchant,'cash','manual','delivery','merchant_confirmed',
    true,'Dinheiro na entrega','{"fundsOwner":"merchant"}'::jsonb);
  INSERT INTO public.orders(
    public_code,customer_id,status,address_text,address_number,postal_code,
    customer_phone_digits,payment_method,gross_total_cents,total_cents,
    delivery_fee_cents_snapshot,merchant_id,attempted_merchant_ids,
    offer_expires_at,version
  ) VALUES(
    'AUTO-STATEMENT-ORDER',v_customer,'OFFERED_TO_MERCHANT',
    'Rua Teste 20 - São Gabriel/RS','20','97300000','51999998888',
    'cash',12000,12000,0,v_merchant,array[v_merchant],
    clock_timestamp()+interval '10 minutes',1
  ) RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id,product_code,product_name,quantity,
    unit_price_cents,line_total_cents)
  VALUES(v_order,'CHARCOAL4','Carvão 4 kg',1,12000,12000);
  v_order_result:=public.merchant_order_action(
    v_owner,v_order,'accept',1,'AUTO-STATEMENT-order-accept',repeat('1',64));
  IF v_order_result->>'status'<>'PREPARING'
  THEN RAISE EXCEPTION 'AUTO-STATEMENT_ORDER_ACCEPT_FAIL:%',v_order_result; END IF;
  SELECT version INTO v_version FROM public.orders WHERE id=v_order;
  v_order_result:=public.merchant_order_action(
    v_owner,v_order,'dispatch',v_version,'AUTO-STATEMENT-order-dispatch',repeat('2',64));
  IF v_order_result->>'status'<>'OUT_FOR_DELIVERY'
  THEN RAISE EXCEPTION 'AUTO-STATEMENT_ORDER_DISPATCH_FAIL:%',v_order_result; END IF;
  SELECT pin_code INTO v_pin FROM public.order_delivery_secrets WHERE order_id=v_order;
  IF v_pin IS NULL OR v_pin!~'^[0-9]{4}$'
  THEN RAISE EXCEPTION 'AUTO-STATEMENT_ORDER_PIN_NOT_CREATED'; END IF;
  SELECT version INTO v_version FROM public.orders WHERE id=v_order;
  v_order_result:=public.merchant_order_action(
    v_owner,v_order,'arriving',v_version,'AUTO-STATEMENT-order-arriving',repeat('3',64));
  IF v_order_result->>'status'<>'ARRIVING'
  THEN RAISE EXCEPTION 'AUTO-STATEMENT_ORDER_ARRIVING_FAIL'; END IF;
  SELECT version INTO v_version FROM public.orders WHERE id=v_order;
  v_order_result:=public.complete_order_delivery(
    v_owner,v_order,v_pin,v_version,'AUTO-STATEMENT-order-complete',repeat('4',64),true);
  IF v_order_result->>'status'<>'SETTLED'
  THEN RAISE EXCEPTION 'AUTO-STATEMENT_ORDER_SETTLEMENT_FAIL:%',v_order_result; END IF;
  PERFORM public.process_deferred_settlement_accounting();
 perform public.close_merchant_daily_finance((statement_timestamp() at time zone 'America/Sao_Paulo')::date);
 select id into sid from public.merchant_daily_statements where merchant_id=v_merchant and status='open';
 if sid is null then raise exception 'statement fixture missing';end if;
 prep:=public.merchant_billing_pix_charge_prepare_provider(owner_id,v_merchant,null,sid,null,'mercadopago',
  'isolated-auto-statement-charge',repeat('e',64));
 cid:=(prep->>'chargeId')::uuid;rid:=(prep->>'paymentRequestId')::uuid;
 select correlation_id into correlation from public.merchant_billing_provider_charges where id=cid;
 order_id:='ORDISOLATED'||replace(cid::text,'-','');
 update public.merchant_billing_provider_charges set provider_charge_id=order_id where id=cid;
 select amount_due_cents into expected from public.merchant_daily_statements where id=sid;
 ingested:=public.ingest_merchant_billing_payment_event('mercadopago','order:'||order_id||':accredited',
  'mp-order:'||order_id,'pix',expected,'BRL',clock_timestamp(),repeat('b',64),null,correlation);
 eid:=(ingested->>'eventId')::uuid;
 applied:=public.apply_verified_merchant_billing_payment(eid,cid);
 if applied->>'applied'<>'true' or not exists(select 1 from public.merchant_daily_statements
    where id=sid and status='paid' and resolved_by is null)
   or not exists(select 1 from public.platform_receivables where order_id=v_order and status='paid' and resolved_by is null)
   or exists(select 1 from public.platform_receivables where daily_statement_id=sid and status='open') then
  raise exception 'automatic statement did not settle original receivable';end if;
 set constraints all immediate;
 set constraints all deferred;
 applied:=public.apply_verified_merchant_billing_payment(eid,cid);
 if applied->>'replayed'<>'true' then raise exception 'statement replay not idempotent';end if;

 select count(*) into before_actions from public.action_requests;
 denied:=false;
 begin perform public.admin_merchant_billing_payment_request_action(null,rid,'approve','invalid actor','isolated-auto-null-actor',repeat('d',64));
 exception when insufficient_privilege then denied:=true;end;
 if not denied or before_actions<>(select count(*) from public.action_requests) then raise exception 'missing admin actor accepted';end if;
 if has_function_privilege('anon','public.apply_verified_merchant_billing_payment(uuid,uuid)','execute')
  or has_function_privilege('authenticated','public.apply_verified_merchant_billing_payment(uuid,uuid)','execute')
  or has_function_privilege('service_role','tamao_billing_private.resolve_merchant_billing_payment_request(uuid,uuid,text,text,text,text,uuid)','execute') then
  raise exception 'automatic resolver exposed';end if;
end $test$;
set constraints all immediate;
rollback;
\echo 'PASS: all four resolver paths, single credit, replay, short/sandbox/refund denial and machine provenance (isolated synthetic evidence only).'

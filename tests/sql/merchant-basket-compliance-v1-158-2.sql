-- PostgreSQL real transaction regression: run only after V1.158.1 and V1.158.2.
-- All synthetic merchants, compliance events, and catalog rows are ROLLED BACK.
begin;
do $probe$
declare
  v_id uuid;
  v_owner uuid;
  v_admin uuid;
  v_glp_denied boolean:=false;
begin
  insert into public.merchants(name,cnpj,status,online)
    values('TAMÃO V1.158.2 ENSAIO TRANSACIONAL','00000000000001','pending',false)
    returning id into v_id;

  insert into public.merchant_compliance(
    merchant_id,cnpj_status,cnpj_verified_at,anp_status
  ) values(v_id,'verified',statement_timestamp(),'pending');

  -- The original 2026-10-12 test predated independent owner verification.
  -- Current production requires a legitimate, verified owner even for
  -- unregulated products. Keep that invariant in the disposable fixture.
  insert into auth.users(id,aud,role,email,email_confirmed_at)
    values(gen_random_uuid(),'authenticated','authenticated',
      'v1582-basket-owner-'||substr(gen_random_uuid()::text,1,10)||'@example.invalid',
      clock_timestamp()) returning id into v_owner;
  insert into auth.users(id,aud,role,email,email_confirmed_at)
    values(gen_random_uuid(),'authenticated','authenticated',
      'v1582-basket-admin-'||substr(gen_random_uuid()::text,1,10)||'@example.invalid',
      clock_timestamp()) returning id into v_admin;
  insert into public.platform_admins(user_id,active,admin_role)
    values(v_admin,true,'superadmin');
  insert into public.merchant_members(merchant_id,user_id,member_role,active)
    values(v_id,v_owner,'owner',true);
  if public.merchant_basket_compliance_current(v_id,array['CHARCOAL4']) then
    raise exception 'FAIL: ordinary product without verified owner was authorized';
  end if;
  perform public.admin_merchant_representation_action(
    v_admin,v_id,v_owner,'verify','legal_representative',
    'SIMULADO: representante autenticado, teste descartável V1.947',
    'test-v1582-owner-'||substr(v_id::text,1,16),repeat('e',64)
  );
  if not public.merchant_representative_verification_current(v_id) then
    raise exception 'FAIL: authorized owner could not prove representation';
  end if;

  if not public.merchant_basket_compliance_current(v_id,array['CHARCOAL4']) then
    raise exception 'FAIL: non-GLP product blocked by pending ANP';
  end if;
  if public.merchant_basket_compliance_current(v_id,array['P13']) then
    raise exception 'FAIL: GLP authorized without ANP';
  end if;
  if public.merchant_basket_compliance_current(v_id,array['P13_CONTAINER']) then
    raise exception 'FAIL: GLP container authorized without ANP';
  end if;
  if public.merchant_basket_compliance_current(v_id,array['CHARCOAL4','P13']) then
    raise exception 'FAIL: mixed GLP cart authorized without ANP';
  end if;
  if public.merchant_basket_compliance_current(v_id,array['UNKNOWN_SKU_999'])
    or public.merchant_basket_compliance_current(v_id,array[]::text[])
  then
    raise exception 'FAIL: unknown/empty cart authorized';
  end if;

  update public.merchants set status='active' where id=v_id;
  if not exists(select 1 from public.merchants where id=v_id and status='active') then
    raise exception 'FAIL: regular non-GLP merchant cannot activate';
  end if;

  insert into public.catalog_items(
    merchant_id,product_code,product_name,price_cents,
    min_price_cents,max_price_cents,available_stock,active,price_confirmed_at
  ) values(v_id,'CHARCOAL4','Carvão para teste',3500,3500,3500,2,true,statement_timestamp());
  if not public.merchant_has_compliant_catalog_item(v_id) then
    raise exception 'FAIL: non-GLP active catalog not commercializable';
  end if;

  begin
    insert into public.catalog_items(
      merchant_id,product_code,product_name,price_cents,
      min_price_cents,max_price_cents,available_stock,active,price_confirmed_at
    ) values(v_id,'P13','GLP teste',12000,12000,12000,1,true,statement_timestamp());
  exception when check_violation then
    v_glp_denied:=true;
  end;
  if not v_glp_denied then
    raise exception 'FAIL: GLP was activated with ANP pending';
  end if;

  update public.merchant_compliance
  set anp_status='verified',anp_reference='SIMULACAO-TRANSACIONAL',anp_verified_at=statement_timestamp()
  where merchant_id=v_id;

  if not public.merchant_basket_compliance_current(v_id,array['P13'])
    or not public.merchant_basket_compliance_current(v_id,array['CHARCOAL4','P13']) then
    raise exception 'FAIL: valid ANP still blocks GLP';
  end if;

  update public.merchant_compliance
  set anp_status='pending',anp_verified_at=null
  where merchant_id=v_id;

  if not exists(select 1 from public.merchants where id=v_id and status='active') then
    raise exception 'FAIL: losing ANP suspended unrelated non-GLP trade';
  end if;
  if not public.merchant_basket_compliance_current(v_id,array['CHARCOAL4'])
    or public.merchant_basket_compliance_current(v_id,array['P13']) then
    raise exception 'FAIL: revoked ANP created cross-category leak';
  end if;
  raise notice 'PASS: merchant activation, non-GLP, GLP, mixed, container, unknown, ANP revocation';
end;
$probe$;
rollback;

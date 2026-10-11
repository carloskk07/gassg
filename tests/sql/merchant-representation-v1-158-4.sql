-- PostgreSQL V1.158.4: full legal-representation authority, transaction reverted.
-- Requires migrations V1.158.1 -> V1.158.4 already applied in staging.
begin;
do $suite$
declare
  v_admin uuid;
  v_owner uuid;
  v_merchant uuid;
  v_result jsonb;
  v_denied boolean:=false;
  v_wrong_owner boolean:=false;
  v_cnpj text;
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at)
  values(gen_random_uuid(),'authenticated','authenticated',
    'test-admin-representation-'||substr(gen_random_uuid()::text,1,8)||'@example.invalid',
    clock_timestamp()) returning id into v_admin;
  insert into auth.users(id,aud,role,email,email_confirmed_at)
  values(gen_random_uuid(),'authenticated','authenticated',
    'test-owner-representation-'||substr(gen_random_uuid()::text,1,8)||'@example.invalid',
    clock_timestamp()) returning id into v_owner;
  insert into public.platform_admins(user_id,active,admin_role)
  values(v_admin,true,'superadmin');
  insert into public.merchants(name,cnpj,status,online)
  values('TAMÃO PROVA DE REPRESENTAÇÃO','00000000000001','pending',false)
  returning id,cnpj into v_merchant,v_cnpj;
  insert into public.merchant_compliance(merchant_id,cnpj_status,cnpj_verified_at,anp_status)
  values(v_merchant,'verified',clock_timestamp(),'pending');
  insert into public.merchant_members(merchant_id,user_id,member_role,active)
  values(v_merchant,v_owner,'owner',true);

  if public.merchant_representative_verification_current(v_merchant)
     or public.merchant_basket_compliance_current(v_merchant,array['CHARCOAL4']) then
    raise exception 'TEST_FAIL: owner without independent verification was authorized';
  end if;

  begin
    update public.merchants set status='active' where id=v_merchant;
  exception when check_violation then
    v_denied:=true;
  end;
  if not v_denied then
    raise exception 'TEST_FAIL: owner proof was not required for merchant activation';
  end if;

  begin
    perform public.admin_merchant_representation_action(
      v_admin,v_merchant,v_admin,'verify','legal_representative',
      'SIMULADO: declaração do administrador', 'test-wrong-owner-'||substr(v_merchant::text,1,12),
      repeat('b',64)
    );
  exception when insufficient_privilege then
    v_wrong_owner:=true;
  end;
  if not v_wrong_owner then
    raise exception 'TEST_FAIL: admin without owner membership was accepted';
  end if;

  v_result:=public.admin_merchant_representation_action(
    v_admin,v_merchant,v_owner,'verify','authorized_delegate',
    'SIMULADO: mandato empresarial conferido',
    'test-legal-verify-'||substr(v_merchant::text,1,12),repeat('a',64)
  );
  if v_result->>'representationCurrent'<>'true' then
    raise exception 'TEST_FAIL: verified representative not enabled: %',v_result;
  end if;
  if not public.merchant_basket_compliance_current(v_merchant,array['CHARCOAL4'])
     or public.merchant_basket_compliance_current(v_merchant,array['P13']) then
    raise exception 'TEST_FAIL: representation bypassed GLP ANP or blocked ordinary products';
  end if;
  perform public.admin_merchant_representation_action(
    v_admin,v_merchant,v_owner,'verify','authorized_delegate',
    'SIMULADO: mandato empresarial conferido',
    'test-legal-verify-'||substr(v_merchant::text,1,12),repeat('a',64)
  );
  if (select count(*) from public.platform_admin_audit
      where target_id=v_merchant::text and action='merchant_representation_verified')<>1 then
    raise exception 'TEST_FAIL: repeated command recorded duplicate audit';
  end if;

  update public.merchants set status='active' where id=v_merchant;
  update public.merchant_members set active=false
    where merchant_id=v_merchant and user_id=v_owner;
  if public.merchant_representative_verification_current(v_merchant) then
    raise exception 'TEST_FAIL: removed owner retained representation authority';
  end if;
  update public.merchant_members set active=true
    where merchant_id=v_merchant and user_id=v_owner;
  update public.merchants set cnpj='00000000000002' where id=v_merchant;
  if public.merchant_representative_verification_current(v_merchant) then
    raise exception 'TEST_FAIL: CNPJ drift retained representation authority';
  end if;
  update public.merchants set cnpj=v_cnpj where id=v_merchant;

  v_result:=public.admin_merchant_representation_action(
    v_admin,v_merchant,null,'revoke',null,
    'SIMULADO: revogação de mandato',
    'test-legal-revoke-'||substr(v_merchant::text,1,12),repeat('c',64)
  );
  if v_result->>'representationCurrent'<>'false'
     or public.merchant_basket_compliance_current(v_merchant,array['CHARCOAL4']) then
    raise exception 'TEST_FAIL: revoked representation still authorizes sales';
  end if;

  if exists(select 1 from information_schema.role_table_grants
      where table_schema='public'
        and table_name='merchant_representation_reviews'
        and grantee in ('anon','authenticated')) then
    raise exception 'TEST_FAIL: representation reviews leaked to public role';
  end if;
  raise notice 'PASS: missing proof, owner mismatch, verified, GLP, replay, owner removal, CNPJ drift, revocation';
end;
$suite$;
rollback;

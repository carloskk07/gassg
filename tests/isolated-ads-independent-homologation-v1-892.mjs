import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
for(const name of ['SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD',
 'SUPABASE_SERVICE_ROLE_KEY','ADS_MP_ACCESS_TOKEN','MERCADOPAGO_ACCESS_TOKEN'])
 assert.equal(process.env[name]||'','');
const sql=q=>execFileSync('psql',['--host=127.0.0.1','--port=54322',
 '--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+q],{
 encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:120000}).trim();
const initial=sql("select count(*) from public.ads_independent_homologation_events_v1_892");
sql(`BEGIN;
DO $test$
DECLARE
 v_owner uuid;v_campaign uuid;v_other uuid;v_version integer;
 v_first jsonb;v_again jsonb;v_auth jsonb;v_test_request uuid;
BEGIN
 SELECT user_id INTO v_owner FROM public.platform_admins
 WHERE active AND admin_role='superadmin' LIMIT 1;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'V892_OWNER_REQUIRED';END IF;
 UPDATE auth.users SET is_anonymous=false,email_confirmed_at=clock_timestamp() WHERE id=v_owner;
 v_campaign:=(public.ads_independent_submit_v1_884(
  v_owner,gen_random_uuid(),'Anunciante independente',
  'Campanha real de homologação','Uma campanha local com pagamento real e revisão.',
  'São Gabriel','RS','https://example.com/ad',1990,7)->>'campaignId')::uuid;
 v_other:=(public.ads_independent_submit_v1_884(
  v_owner,gen_random_uuid(),'Segunda marca',
  'Segunda campanha local','Outro anúncio local, sem autorização de cobrança.',
  'São Gabriel','RS','https://example.com/other',4990,15)->>'campaignId')::uuid;
 PERFORM public.admin_ads_independent_action_v1_884(v_owner,'approve',v_campaign,1,
  'Campanha legítima para teste PostgreSQL isolado');
 PERFORM public.admin_ads_independent_action_v1_884(v_owner,'approve',v_other,1,
  'Segunda marca para comprovar isolamento do checkout');
 SELECT version INTO v_version FROM public.ads_independent_sales_controls_v1_886 WHERE singleton;
 IF (SELECT sales_enabled FROM public.ads_independent_sales_controls_v1_886 WHERE singleton)
 THEN RAISE EXCEPTION 'V892_PUBLIC_SALES_MUST_STAY_CLOSED';END IF;
 BEGIN
  PERFORM public.ads_independent_checkout_reserve_v1_886(v_owner,v_campaign,gen_random_uuid());
  RAISE EXCEPTION 'V892_UNAUTHORIZED_CHECKOUT_OPENED';
 EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
 BEGIN
  PERFORM public.admin_ads_independent_homologation_v1_892(
   v_owner,v_campaign,true,v_version,'Exigir confirmação de teste','WRONG');
  RAISE EXCEPTION 'V892_BAD_CONFIRMATION_ACCEPTED';
 EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
 BEGIN
  PERFORM public.admin_ads_independent_homologation_v1_892(
   v_owner,v_other,true,v_version,'Negar plano diferente do básico','HOMOLOGAR');
  RAISE EXCEPTION 'V892_BAD_PLAN_ACCEPTED';
 EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
 v_auth:=public.admin_ads_independent_homologation_v1_892(
  v_owner,v_campaign,true,v_version,'Homologar cobrança real isolada para uma campanha','HOMOLOGAR');
 IF v_auth->>'homologationAuthorized'<>'true' OR v_auth->>'salesEnabled'<>'false'
  OR v_auth->>'newChargesCreated'<>'false' OR
  (v_auth->>'homologationExpiresAt')::timestamptz<clock_timestamp()+interval '71 hours'
 THEN RAISE EXCEPTION 'V892_AUTHORITY_READBACK_FAILED';END IF;
 SELECT version INTO v_version FROM public.ads_independent_sales_controls_v1_886 WHERE singleton;
 BEGIN
  PERFORM public.ads_independent_checkout_reserve_v1_886(v_owner,v_other,gen_random_uuid());
  RAISE EXCEPTION 'V892_OTHER_CAMPAIGN_CHARGED';
 EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
 BEGIN
  PERFORM public.admin_ads_independent_homologation_v1_892(
   v_owner,v_other,true,v_version,'Reatribuir teste enquanto está ativo','HOMOLOGAR');
  RAISE EXCEPTION 'V892_DOUBLE_HOMOLOGATION';
 EXCEPTION WHEN sqlstate '42501' OR sqlstate '40001' THEN NULL; END;
 v_test_request:=gen_random_uuid();
 v_first:=public.ads_independent_checkout_reserve_v1_886(v_owner,v_campaign,v_test_request);
 v_again:=public.ads_independent_checkout_reserve_v1_886(v_owner,v_campaign,gen_random_uuid());
 IF v_first->>'created'<>'true' OR v_again->>'created'<>'false' OR
  v_first->>'externalReference' IS DISTINCT FROM v_again->>'externalReference' OR
  (SELECT count(*) FROM public.ads_independent_checkouts_v1_886 WHERE campaign_id=v_campaign)<>1
 THEN RAISE EXCEPTION 'V892_DUPLICATE_RESERVATION';END IF;
 IF (SELECT count(*) FROM public.ads_independent_payment_events_v1_886)<>0
 THEN RAISE EXCEPTION 'V892_FAKE_PAYMENT_CREATED';END IF;
 v_auth:=public.admin_ads_independent_homologation_v1_892(
  v_owner,NULL,false,v_version,'Revogar permissão sem cancelar cobrança emitida','CANCELAR');
 IF v_auth->>'homologationAuthorized'<>'false' OR v_auth->>'salesEnabled'<>'false'
 THEN RAISE EXCEPTION 'V892_REVOKE_UNVERIFIED';END IF;
 BEGIN
  PERFORM public.ads_independent_checkout_reserve_v1_886(v_owner,v_campaign,gen_random_uuid());
  RAISE EXCEPTION 'V892_REVOKED_CHECKOUT_ALLOWED';
 EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
 IF (SELECT count(*) FROM public.ads_independent_homologation_events_v1_892)<>2
 THEN RAISE EXCEPTION 'V892_AUDIT_TRAIL_MISSING';END IF;
 IF has_function_privilege('authenticated',
    'public.admin_ads_independent_homologation_v1_892(uuid,uuid,boolean,integer,text,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.ads_independent_homologation_events_v1_892','SELECT')
 THEN RAISE EXCEPTION 'V892_PRIVILEGE_LEAK';END IF;
END;
$test$;
ROLLBACK;`);
assert.equal(sql("select count(*) from public.ads_independent_homologation_events_v1_892"),initial);
console.log('V1.892 PASS: authorized one-campaign real checkout only; replay and revoke fail closed; rollback.');

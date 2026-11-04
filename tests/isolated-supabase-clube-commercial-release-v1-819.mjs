import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
const env={...process.env,PGPASSWORD:'postgres'};
const query=sql=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres',
 '--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+sql
],{encoding:'utf8',env,timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const tx=`BEGIN;
DO $fixture$
DECLARE a uuid; r jsonb;
BEGIN
 SELECT user_id INTO a FROM public.platform_admins
  WHERE admin_role='superadmin' AND active ORDER BY created_at LIMIT 1;
 IF a IS NULL THEN RAISE EXCEPTION 'TEST_SUPERADMIN_NOT_AVAILABLE'; END IF;
 IF (SELECT owner_guaranteed_cents FROM public.platform_clube_sponsor_pool_v1_807
     WHERE benefit_key='clube_coupons')<>10000
 THEN RAISE EXCEPTION 'TEST_OWNER_GUARANTEE_NOT_READY'; END IF;
 IF (SELECT sale_enabled FROM public.clube_coupon_paid_packages
     WHERE package_key='all_products_3x5_sponsor')<>FALSE
 THEN RAISE EXCEPTION 'TEST_PACKAGE_ALREADY_ENABLED'; END IF;
 SELECT public.admin_clube_coupon_commercial_release_v1_819(
  a,'Fornecedor Teste de Cupons','12345678909',
  'Rua Exemplo, 123, Centro, São Gabriel, RS, 97300-000',
  'teste@example.com',TRUE,TRUE,TRUE,gen_random_uuid()) INTO r;
 IF r->>'salesEnabled'<>'true' THEN RAISE EXCEPTION 'TEST_NOT_RELEASED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clube_coupon_commercial_release_v1_819
   WHERE package_key='all_products_3x5_sponsor' AND enabled)
 THEN RAISE EXCEPTION 'TEST_MISSING_SIGNED_IDENTITY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clube_coupon_paid_packages
   WHERE package_key='all_products_3x5_sponsor'
   AND funding_verified AND legal_terms_verified
   AND redeem_settlement_verified AND sale_enabled)
 THEN RAISE EXCEPTION 'TEST_NOT_COMMERCIALLY_AVAILABLE'; END IF;
 IF (SELECT owner_guaranteed_cents FROM public.platform_clube_sponsor_pool_v1_807
   WHERE benefit_key='clube_coupons')<>10000
 THEN RAISE EXCEPTION 'TEST_OWNER_FUNDS_INVENTED'; END IF;
 SELECT public.admin_clube_coupon_commercial_suspend_v1_819(a,gen_random_uuid()) INTO r;
 IF r->>'salesEnabled'<>'false' OR EXISTS(SELECT 1 FROM public.clube_coupon_paid_packages
  WHERE package_key='all_products_3x5_sponsor' AND sale_enabled)
 THEN RAISE EXCEPTION 'TEST_SUSPENSION_NOT_EFFECTIVE'; END IF;
END $fixture$;
ROLLBACK;`;
query(tx);
const state=query("SELECT funding_verified::text||':'||legal_terms_verified::text||':'||sale_enabled::text FROM public.clube_coupon_paid_packages WHERE package_key='all_products_3x5_sponsor'");
assert.equal(state,'true:false:false','Test transaction must not activate production or subsequent fixtures');
console.log('V1.819 PostgreSQL PASS — signed release and hard-stop suspension in rollback-only synthetic transaction.');

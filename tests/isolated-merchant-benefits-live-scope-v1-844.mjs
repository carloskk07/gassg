import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Runs only after #843's product checkout integration in the disposable runner.
// Uses the existing authenticated owner + merchant fixture. No production API.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const query=q=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+q
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:45000}).trim();
const merchant='00000000-0000-4000-8000-000000000026';
const owner=query("select user_id from public.merchant_members where merchant_id='"+merchant+"'::uuid and member_role='owner' and active limit 1");
assert.match(owner,/^[a-f0-9-]{36}$/i);
const before=query("select count(*) from public.merchant_benefit_events_v1_842 where merchant_id='"+merchant+"'::uuid");
const json=query("select public.merchant_benefits_contract_v1_842('"+owner+"'::uuid,'"+merchant+"'::uuid,'view')::text");
const scope=JSON.parse(json);
assert.equal(scope.source,'merchant_benefits_contract_v1_842');
assert.equal(scope.merchantId,merchant);
assert.equal(scope.readOnly,true);
assert.equal(scope.normalFlexFeeBps,900);
assert.equal(scope.memberFlexFeeBps,800);
assert.equal(scope.maxWelcomeDiscountCents,100);
assert.equal(scope.productWelcomeCheckoutEnabled,true);
assert.equal(scope.productWelcomeFeeReductionEnabled,true);
assert.equal(scope.productWelcomeOnlyWhenApplied,true);
assert.equal(scope.partnerFundedPaidCouponsEnabled,false);
assert.equal(scope.partnerFundedOtherCashbackEnabled,false);
assert.equal(scope.checkoutBenefitsEnabled,false,'No broad benefit activation');
assert.equal(scope.feeReductionEnabled,false,'No global fee reduction');
assert.equal(scope.legacyCouponRightsPreserved,true);
assert.equal(scope.noCurrentFinancialMutation,true,'View never writes money');
assert.equal(query("select count(*) from public.merchant_benefit_events_v1_842 where merchant_id='"+merchant+"'::uuid"),before);
assert.equal(query("select has_function_privilege('authenticated','public.merchant_benefits_contract_v1_842(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')"),'f');
assert.equal(query("select has_function_privilege('service_role','public.merchant_benefits_contract_v1_842(uuid,uuid,text,integer,integer,uuid,boolean)','EXECUTE')"),'t');
console.log('PASS #844: PostgreSQL contract reports only installed product benefit, retains all paid-coupon obligations.');

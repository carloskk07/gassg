import assert from 'node:assert/strict';
import {ownedBillingSnapshot} from '../supabase/functions/admin-ops/finance-owned-billing.js';
const actor='11000000-0000-4000-8000-000000000001',merchant='22000000-0000-4000-8000-000000000002';
let owned=true,incomplete=false,reads=[];
const db={from(table){
 const filters={};reads.push(table);
 const data=()=>{
  if(table==='merchant_members'){
   assert.equal(filters.user_id,actor);assert.equal(filters.active,true);
   return {data:owned?[{merchant_id:merchant,member_role:'owner'}]:[],count:incomplete?51:owned?1:0,error:null};
  }
  if(table==='merchants'){assert.deepEqual(filters.id,[merchant]);return {data:[{id:merchant,name:'Conta legítima',status:'pending'}],error:null};}
  if(table==='merchant_billing_plans')return {data:[{plan_key:'credit_01990',display_name:'Essencial',purchase_amount_cents:1990,credit_grant_cents:1990,platform_fee_bps:800}],error:null};
  assert.equal(filters.merchant_id,merchant);
  if(table==='merchant_billing_accounts')return {data:{plan_key:'flex_daily',credit_balance_cents:0,credit_reserved_cents:0},error:null};
  if(table==='merchant_billing_provider_charges')return {data:null,error:null};
  throw Error('unexpected table');
 };
 return {select(){return this},eq(k,v){filters[k]=v;return this},in(k,v){filters[k]=v;return this},
  order(){return this},limit(){return this},maybeSingle:async()=>data(),
  then(resolve,reject){return Promise.resolve(data()).then(resolve,reject)}};
}};
const result=await ownedBillingSnapshot(db,actor);
assert.equal(result.readOnly,true);assert.equal(result.paymentsCreated,0);
assert.equal(result.selectedMerchantId,merchant);assert.equal(result.accounts[0].status,'pending');
assert.equal(result.plans[0].priceCents,1990);assert.equal(result.plans[0].creditCents,1990);
reads=[];
await assert.rejects(ownedBillingSnapshot(db,actor,'33000000-0000-4000-8000-000000000003'),/PERMISSION_DENIED/);
assert.deepEqual(reads,['merchant_members'],'foreign account must be denied before balance/catalog reads');
owned=false;const empty=await ownedBillingSnapshot(db,actor);
assert.equal(empty.selectedMerchantId,null);assert.equal(empty.accounts.length,0);
owned=true;incomplete=true;await assert.rejects(ownedBillingSnapshot(db,actor),/MEMBERSHIP_UNAVAILABLE/);
console.log('PASS: existing pending merchant, live plan prices, caller-owned balances, no writes and no foreign/incomplete account selection.');

import assert from 'node:assert/strict';
import {readBillingEntitlement} from '../supabase/functions/_shared/merchant-billing-entitlement.js';
const charge={merchant_id:'merchant',payment_request_id:'request',amount_cents:1990};
let request={id:'request',merchant_id:'merchant',request_kind:'package_purchase',plan_key:'credit_01990',
 status:'pending',expected_amount_cents:1990,credit_grant_cents_snapshot:1990,received_amount_cents:1990,
 approval_source:'provider_event',provider_payment_event_id:'event',reconciliation_key:'mp-order:original'};
let event={id:'event',status:'applied',payment_request_id:'request',merchant_id:'merchant',amount_cents:1990,reconciliation_key:'mp-order:original'};
let rows=[{merchant_id:'merchant',plan_key:'credit_01990',amount_cents:1990}],count=1,failed=false;
const db={from(table){return {select(){return this},eq(){return this},limit(){return this},
 maybeSingle:async()=>({data:table==='merchant_billing_payment_requests'?{...request}:
  table==='merchant_billing_payment_events'?{...event}:{status:'paid',merchant_id:'merchant',amount_due_cents:1990},error:null}),
 then(resolve){assert.equal(table,'merchant_fee_credit_ledger');return Promise.resolve({data:rows,count,error:failed?Error('offline'):null}).then(resolve)}
}}};
assert.equal((await readBillingEntitlement(db,charge)).entitlementApplied,false,'paid charge alone cannot imply granted credit');
request.status='approved';assert.equal((await readBillingEntitlement(db,charge)).entitlementApplied,true);
rows=[];count=0;assert.equal((await readBillingEntitlement(db,charge)).reviewRequired,true,'approved request without ledger needs review');
rows=[{merchant_id:'merchant',plan_key:'credit_01990',amount_cents:1989}];count=1;
assert.equal((await readBillingEntitlement(db,charge)).entitlementApplied,false);
rows[0].amount_cents=1990;count=2;
assert.equal((await readBillingEntitlement(db,charge)).entitlementApplied,false,'duplicate ledger cannot be declared complete');
count=1;event.status='refunded';assert.equal((await readBillingEntitlement(db,charge)).entitlementApplied,false);
event.status='applied';event.merchant_id='foreign';assert.equal((await readBillingEntitlement(db,charge)).entitlementApplied,false);
event.merchant_id='merchant';failed=true;await assert.rejects(readBillingEntitlement(db,charge),/LEDGER_UNAVAILABLE/);
failed=false;request.request_kind='statement_payment';request.statement_id='statement';
assert.equal((await readBillingEntitlement(db,charge)).entitlementApplied,true);
await assert.rejects(readBillingEntitlement(db,{...charge,merchant_id:'foreign'}),/BINDING_MISMATCH/);
console.log('PASS: a completed PSP charge is insufficient; original approved request, exact event and one actual credit/paid statement are required.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readFinanceReceiptProgress,validateFinanceReceiptSummary,applyFinanceReceiptProgress}
 from '../supabase/functions/admin-ops/finance-receipt-progress.js';
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const time='2026-11-15T12:00:00Z',actor=id(99),coupon=id(1),billing=id(2),ads=id(3),customer=id(4),merchant=id(5),request=id(6),event=id(7);
const clone=x=>structuredClone(x);
const db={
 clube_coupon_paid_invoices:[{id:coupon,status:'refunded',paid_at:time,provider_order_id:'ORD-coupon',provider_payment_id:'PAY-coupon',
  customer_user_id:customer,coupons_per_pack:3,coupon_face_cents:500,sale_price_cents:890,
  net_proceeds_cents:881,net_proceeds_reference:'mp-release:coupon-original.csv:123456789',net_proceeds_verified_at:time}],
 clube_coupon_paid_issuances:[1,2,3].map(n=>({id:id(10+n),invoice_id:coupon,customer_user_id:customer,ordinal:n,face_cents:500,status:'void'})),
 clube_coupon_refund_requests_v1_814:[{invoice_id:coupon,customer_user_id:customer,status:'refunded'}],
 merchant_billing_provider_charges:[{id:billing,status:'completed',completed_at:time,amount_cents:1990,
  payment_request_id:request,merchant_id:merchant,correlation_id:'original-billing',provider_charge_id:'ORD-billing'}],
 merchant_billing_payment_requests:[{id:request,merchant_id:merchant,status:'approved',request_kind:'package_purchase',plan_key:'credit_01990',
  expected_amount_cents:1990,credit_grant_cents_snapshot:1990,received_amount_cents:1990,approval_source:'provider_event',
  provider_payment_event_id:event,reconciliation_key:'provider-original'}],
 merchant_billing_payment_events:[{id:event,status:'applied',payment_request_id:request,merchant_id:merchant,amount_cents:1990,reconciliation_key:'provider-original'}],
 merchant_fee_credit_ledger:[{merchant_id:merchant,payment_request_id:request,entry_type:'package_credit',amount_cents:1990,plan_key:'credit_01990'}],
 ads_independent_checkouts_v1_886:[{campaign_id:ads,owner_user_id:actor,status:'payment_approved',amount_cents:1990,
  duration_days:7,approved_at:time,payment_id:'987654321',external_reference:'original-advertising'}],
 ads_independent_campaigns_v1_884:[{id:ads,owner_user_id:actor,budget_cents:1990,duration_days:7}],
 ads_independent_payment_events_v1_886:[{campaign_id:ads,payment_id:'987654321',provider_status:'approved'}],
 platform_receipt_net_audit:[{kind:'billing',resource_id:billing,gross_cents:1990,net_cents:1970,provider_order_id:'ORD-billing',
  provider_payment_id:'222222222',external_reference:'original-billing',evidence_reference:'mp-release:original-report.csv:222222222'},
 {kind:'advertising',resource_id:ads,gross_cents:1990,net_cents:1970,provider_order_id:null,
  provider_payment_id:'987654321',external_reference:'original-advertising',evidence_reference:'mp-release:original-report.csv:987654321'}]
};
const summary={source:'platform_receipt_net_summary',readOnly:true,moneyMoved:false,merchantFundsIncluded:false,accountBalanceVerified:false,
 generatedAt:time,totalCount:3,returnedCount:3,truncated:false,kindTotals:{},rows:[
 {kind:'coupon',resourceId:coupon,businessStatus:'refunded',grossCents:890,paidAt:time,netStatus:'reversed',netCents:881,verifiedAt:time,
  evidenceReference:db.clube_coupon_paid_invoices[0].net_proceeds_reference},
 {kind:'billing',resourceId:billing,businessStatus:'completed',grossCents:1990,paidAt:time,netStatus:'net_verified',netCents:1970,verifiedAt:time,
  evidenceReference:db.platform_receipt_net_audit[0].evidence_reference},
 {kind:'advertising',resourceId:ads,businessStatus:'payment_approved',grossCents:1990,paidAt:time,netStatus:'net_verified',netCents:1970,verifiedAt:time,
  evidenceReference:db.platform_receipt_net_audit[1].evidence_reference}]
};
for(const kind of ['coupon','billing','advertising','mobility'])summary.kindTotals[kind]={count:kind==='mobility'?0:1,
 grossCents:kind==='mobility'?0:kind==='coupon'?890:1990,verifiedCount:['billing','advertising'].includes(kind)?1:0,
 verifiedNetCents:['billing','advertising'].includes(kind)?1970:0,pendingCount:0,reversedCount:kind==='coupon'?1:0};
let reads=0;
const client=(tables=db,data=summary,failTable=null)=>({async rpc(name,args){
 assert.equal(name,'admin_platform_receipt_net_summary');assert.equal(args.p_actor_user_id,actor);return {data};
},from(table){
 const filters=[];let limit=1001;
 const run=single=>{
  reads++;const rows=(tables[table]??[]).filter(r=>filters.every(([k,v])=>r[k]===v)).slice(0,limit);
  return Promise.resolve(table===failTable?{error:Error('read failed'),data:null}:
   {error:null,data:single?rows[0]??null:rows,count:rows.length});
 };
 return {select(){return this},eq(k,v){filters.push([k,v]);return this},limit(n){limit=n;return this},
  maybeSingle(){return run(true)},then(resolve,reject){return run(false).then(resolve,reject)}};
}});
assert(validateFinanceReceiptSummary(summary));
const proof=await readFinanceReceiptProgress(client(),actor);
assert.equal(proof.modules.merchants.receivingCompleted,true);assert.equal(proof.modules.merchants.netCents,1970);
assert.equal(proof.modules.advertising.receivingCompleted,true);
assert.equal(proof.modules.coupons.refundCompleted,true);assert.equal(proof.modules.coupons.historicalNet,true);
assert.equal(proof.modules.coupons.receivingCompleted,false);assert.equal(proof.modules.coupons.netCents,881);
assert.equal(proof.modules.mobility.state,'no_receipt');
assert(!JSON.stringify(proof).includes(actor));assert(!JSON.stringify(proof).includes(billing));
const window=clone(summary);
for(let n=0;n<27;n++)window.rows.push({...clone(summary.rows[2]),resourceId:id(100+n)});
window.kindTotals.advertising.count=28;window.kindTotals.advertising.verifiedCount=28;
window.kindTotals.advertising.grossCents=28*1990;window.kindTotals.advertising.verifiedNetCents=28*1970;
window.kindTotals.mobility.count=1;window.kindTotals.mobility.pendingCount=1;window.kindTotals.mobility.grossCents=1000;
window.totalCount=31;window.returnedCount=30;window.truncated=true;
assert(validateFinanceReceiptSummary(window));
assert.equal((await readFinanceReceiptProgress(client(db,window),actor)).modules.mobility.state,'outside_recent_window',
 'an old receipt outside the sample is never mistaken for no payment or a reason to pay again');
for(const mutate of [
 d=>d.merchant_fee_credit_ledger[0].payment_request_id=id(90),
 d=>d.merchant_fee_credit_ledger.push(clone(d.merchant_fee_credit_ledger[0])),
 d=>d.platform_receipt_net_audit[0].external_reference='different-charge',
 d=>d.platform_receipt_net_audit[0].provider_order_id='ORD-other',
 d=>d.platform_receipt_net_audit[0].net_cents=1969,
 d=>d.merchant_billing_payment_events[0].reconciliation_key='unrelated'
]){
 const changed=clone(db);mutate(changed);
 const r=await readFinanceReceiptProgress(client(changed),actor);
 assert.equal(r.modules.merchants.receivingCompleted,false,mutate.toString());
 assert.equal(r.modules.merchants.state,'requires_review');
}
const wrongCoupon=clone(db);wrongCoupon.clube_coupon_paid_issuances[0].status='issued';
let result=await readFinanceReceiptProgress(client(wrongCoupon),actor);
assert.equal(result.modules.coupons.refundCompleted,false);assert.equal(result.modules.coupons.netRecorded,false);
const wrongOwner=clone(db);wrongOwner.clube_coupon_refund_requests_v1_814[0].customer_user_id=id(88);
result=await readFinanceReceiptProgress(client(wrongOwner),actor);assert.equal(result.modules.coupons.refundCompleted,false);
const stale=clone(db);stale.merchant_billing_provider_charges[0].status='cancelled';
result=await readFinanceReceiptProgress(client(stale),actor);assert.equal(result.modules.merchants.state,'unavailable');
result=await readFinanceReceiptProgress(client(db,summary,'ads_independent_payment_events_v1_886'),actor);
assert.equal(result.modules.advertising.state,'unavailable');assert.equal(result.modules.merchants.receivingCompleted,true,'one read failure must not discard another module proof');
for(const mutate of [s=>s.merchantFundsIncluded=true,s=>s.accountBalanceVerified=true,
 s=>s.rows[0].resourceId='invalid',s=>s.rows.push(s.rows[0]),s=>s.totalCount++]){
 const bad=clone(summary);mutate(bad);assert.equal(validateFinanceReceiptSummary(bad),false);
 await assert.rejects(()=>readFinanceReceiptProgress(client(db,bad),actor),/SUMMARY_UNAVAILABLE/);
}
const moduleProof=Object.keys(proof.modules).map(key=>({key,diagnosis:{financiallyHomologated:false,bankSettlementChecked:false,nextAction:'previous action'}}));
const assessed=applyFinanceReceiptProgress(moduleProof,proof);
assert.match(assessed.find(m=>m.key==='merchants').diagnosis.nextAction,/sem repetir/);
assert.match(assessed.find(m=>m.key==='coupons').diagnosis.progressLabel,/Devolução e cancelamento/);
assert(assessed.every(m=>m.diagnosis.financiallyHomologated===false));
const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const cut=name=>{const a=admin.indexOf('function '+name+'(');return admin.slice(a,admin.indexOf('\n}',a)+2)};
const ctx=vm.createContext({adminMoney:n=>'R$ '+(n/100).toFixed(2),esc:v=>String(v??'').replaceAll('<','&lt;')});
vm.runInContext(cut('adminFinanceReceiptProgressValid')+'\n'+cut('adminFinanceReceiptProgressView')+'\nthis.valid=adminFinanceReceiptProgressValid;this.view=adminFinanceReceiptProgressView;',ctx);
for(const p of Object.values(proof.modules))assert(ctx.valid(p));
for(const m of Object.values(result.modules))assert(ctx.valid(m));
assert(ctx.view(proof.modules.merchants,'merchants','<unsafe>').includes('R$ 19.70'));
assert(!ctx.view(proof.modules.merchants,'merchants','<unsafe>').includes('<unsafe>'));
assert(ctx.view(proof.modules.coupons,'coupons','Continuar').includes('Líquido histórico'));
assert(ctx.view(proof.modules.coupons,'coupons','Continuar').includes('fora dos valores vigentes'));
const invalid=clone(proof.modules.merchants);invalid.entitlementVerified=false;assert.equal(ctx.valid(invalid),false);
console.log('PASS: original receipt + actual entitlement + immutable NET audit; unrelated global credits cannot complete receiving; refunded coupons stay cancelled; partial failures, roles/read scope and truthful UI.');

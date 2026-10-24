import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const helper=read('supabase/functions/admin-ops/coupon-release-evidence.js');
const mod=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'));
const {releasedMoneyCents,parseReleasedMoneyCsv,couponReleasedNetEvidence}=mod;
const admin=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin.js');
const audit=read('.github/workflows/audit.yml');

const invoice={
 id:'11111111-1111-4111-8111-111111111111',
 status:'paid',paid_at:'2026-10-24T04:00:00Z',
 provider_order_id:'order-1',provider_payment_id:'payment-1',
 sale_price_cents:1200,coupon_face_cents:500,coupons_per_pack:2
};
const order={
 id:'order-1',external_reference:invoice.id,total_amount:'12.00',
 currency_id:'BRL',status:'processed',
 transactions:{payments:[{id:'payment-1',status:'processed',
  payment_method:{id:'pix',type:'bank_transfer'}}],refunds:[]}
};
const header=['DATE','SOURCE_ID','EXTERNAL_REFERENCE','RECORD_TYPE','DESCRIPTION',
 'NET_CREDIT_AMOUNT','NET_DEBIT_AMOUNT','GROSS_AMOUNT','CURRENCY'].join(',');
const release=(override={})=>{
 const fields={DATE:'2026-10-24T05:00:00Z',SOURCE_ID:'payment-1',
  EXTERNAL_REFERENCE:invoice.id,RECORD_TYPE:'release',DESCRIPTION:'payment',
  NET_CREDIT_AMOUNT:'11.00',NET_DEBIT_AMOUNT:'0.00',
  GROSS_AMOUNT:'12.00',CURRENCY:'BRL',...override};
 return header.split(',').map(k=>fields[k]).join(',');
};
const csv=header+'\n'+release()+'\n';
const inspect=(file=csv,inv=invoice,pay=order)=>
 couponReleasedNetEvidence(file,{invoice:inv,order:pay,
 reportFileName:'release-report-prod-20261024.csv'});

assert.equal(releasedMoneyCents('12.01'),1201);
assert.equal(releasedMoneyCents('-0.25'),-25);
for(const value of ['12','12,00','12.345','NaN','1e3'])
 assert.equal(releasedMoneyCents(value),null,value);
const valid=inspect();
assert.equal(valid.eligible,true);
assert.equal(valid.netCents,1100);
assert.equal(valid.evidenceReference,'mp-release:release-report-prod-20261024.csv:payment-1');
assert.equal(valid.merchantPayoutVerified,false);
assert.equal(valid.couponFundingApplied,false);
assert.equal(valid.moneyMoved,false);

for(const invalid of [
 [header+'\n'+release({SOURCE_ID:'wrong'})+'\n','COUPON_RELEASE_NOT_FOUND'],
 [header+'\n'+release({EXTERNAL_REFERENCE:'other'})+'\n','COUPON_RELEASE_NOT_FOUND'],
 [header+'\n'+release({RECORD_TYPE:'available_balance'})+'\n','COUPON_RELEASE_NOT_FOUND'],
 [header+'\n'+release({DESCRIPTION:'refund'})+'\n','COUPON_RELEASE_NOT_FOUND'],
 [header+'\n'+release()+'\n'+release()+'\n','COUPON_RELEASE_AMBIGUOUS'],
 [header+'\n'+release({NET_CREDIT_AMOUNT:'9.99'})+'\n','COUPON_RELEASE_NET_INSUFFICIENT'],
 [header+'\n'+release({NET_CREDIT_AMOUNT:'12.01'})+'\n','COUPON_RELEASE_VALUES_UNVERIFIED'],
 [header+'\n'+release({NET_DEBIT_AMOUNT:'1.00'})+'\n','COUPON_RELEASE_VALUES_UNVERIFIED'],
 [header+'\n'+release({GROSS_AMOUNT:'13.00'})+'\n','COUPON_RELEASE_VALUES_UNVERIFIED'],
 [header+'\n'+release({CURRENCY:'USD'})+'\n','COUPON_RELEASE_VALUES_UNVERIFIED'],
 [header+'\n'+release({DATE:'not-a-date'})+'\n','COUPON_RELEASE_VALUES_UNVERIFIED']
]){
 assert.equal(inspect(invalid[0]).reason,invalid[1],invalid[1]);
 assert.equal(inspect(invalid[0]).eligible,false);
}
for(const bad of [
 {invoice:{status:'refunded'}},
 {invoice:{paid_at:null}},
 {invoice:{provider_payment_id:null}},
 {order:{status:'processing'}},
 {order:{external_reference:'other'}},
 {order:{total_amount:'12.01'}},
 {order:{transactions:{payments:[],refunds:[]}}},
 {order:{transactions:{...order.transactions,refunds:[{status:'processed',amount:'1.00'}]}}}
]){
 const result=inspect(csv,{...invoice,...bad.invoice},{...order,...bad.order});
 assert.equal(result.eligible,false,JSON.stringify(bad));
}
assert.equal(parseReleasedMoneyCsv(csv).rowsExamined,1);
assert.equal(parseReleasedMoneyCsv('\ufeff'+csv).rowsExamined,1);
const semi=csv.replaceAll(',', ';');
assert.equal(parseReleasedMoneyCsv(semi).rowsExamined,1);
for(const invalid of [
 'SOURCE_ID,EXTERNAL_REFERENCE\na,b\n',
 header+'\n'+release()+',extra\n',
 header.replace('SOURCE_ID','DATE')+'\n'+release()+'\n',
 header+'\n"a,b',
 header+'\n'+release().replace('payment-1','bad"quote')+'\n',
 'X'.repeat(1_000_001)
])assert.throws(()=>parseReleasedMoneyCsv(invalid));

assert.match(admin,/import \{couponReleasedNetEvidence\} from "\.\/coupon-release-evidence\.js"/);
assert.match(admin,/if\(action==="clube-coupon-mp-release-inspect"\|\|/);
assert.match(admin,/admin-mp-coupon-release-inspect/);
assert.match(admin,/from\("clube_coupon_paid_invoices"\)/);
assert.match(admin,/encodeURIComponent\(fileName\)/);
assert.match(admin,/mercadoPagoFetch\("\/v1\/account\/release_report\/list"/);
assert.match(admin,/mercadoPagoFetch\("\/v1\/account\/release_report\/"\+encodeURIComponent\(fileName\)/);
assert.match(admin,/providerReportChecked:true/);
assert.match(admin,/fileName:typeof item\?\.file_name/);
const route=admin.slice(admin.indexOf('if(action==="clube-coupon-mp-release-inspect"||'),
 admin.indexOf('if(action==="clube-coupon-mp-release-reports")'));
assert.doesNotMatch(route,/method:"POST"|\.update\(|\.insert\(|\.delete\(/,
 'provider reconciliation must not write directly to finance tables');
assert.match(route,/const finalize=action==="clube-coupon-mp-funding-finalize"/);
assert.match(route,/if\(finalize\&\&String\(adminAccess\.admin_role\)!=="superadmin"\)/);
assert.match(route,/if\(finalize\)\{[\s\S]*?\.rpc\("clube_coupon_paid_net_proceeds_verify_audited"/,
 'the existing finance RPC must only run within the explicit finalization branch');
assert.match(route,/expectedNetCents/);
assert.match(route,/expectedEvidenceReference/);
assert.match(route,/confirmation!=="CONFIRMAR_LIQUIDO"/);
assert.match(route,/netEvidenceRegistered:true/);
assert.match(route,/p_actor_user_id:user\.id/);
assert.match(route,/auditRecorded:true/);
assert.match(route,/couponsAvailableForCheckout:false/);
assert.match(route,/couponFundingApplied:false/);
assert.match(route,/merchantPayoutVerified:false/);
assert.match(ui,/adminClubeReleaseInspect\(index\)/);
assert.match(ui,/coupon_mp_released_net_evidence_v1/);
assert.match(ui,/Nenhum crédito aplicado; repasse à revenda ainda não comprovado/);
assert.match(audit,/node tests\/coupon-mp-release-evidence\.mjs/);
new vm.Script(ui,{filename:'js/admin.js'});
console.log('PASS: MP release CSV amounts, PSP and invoice binding, ambiguity, refunds, ACL and read-only Admin surface.');

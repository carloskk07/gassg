import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {platformReleasedNetEvidence,readPlatformNetEvidence} from '../supabase/functions/_shared/platform-net-evidence.js';
import {reconcilePlatformReceipts} from '../supabase/functions/coupon-net-auto/platform-receipts.js';
const copy=x=>structuredClone(x),nowMs=Date.parse('2026-11-15T14:00:00Z');
const receipt={kind:'billing',resource_id:'11111111-1111-4111-8111-111111111111',
 business_status:'completed',gross_cents:1990,external_reference:'billing-original-reference',
 provider_order_id:'ORD-original',provider_payment_id:'PAY-original',
 paid_at:'2026-11-14T22:25:00Z',reversed:false};
const payment={id:123456789,collector_id:98765432,live_mode:true,
 external_reference:receipt.external_reference,currency_id:'BRL',payment_method_id:'pix',
 payment_type_id:'bank_transfer',status:'approved',status_detail:'accredited',
 date_approved:'2026-11-13T10:00:00Z',money_release_status:'released',money_release_date:'2026-11-13T10:00:05Z',
 transaction_amount:19.90,transaction_amount_refunded:0,refunds:[],chargebacks:[],
 transaction_details:{net_received_amount:19.70,total_paid_amount:19.90},
 point_of_interaction:{references:[{id:receipt.provider_order_id}],transaction_data:{e2e_id:'original-e2e'}}};
const order={id:receipt.provider_order_id,user_id:98765432,live_mode:true,status:'processed',
 external_reference:receipt.external_reference,total_amount:'19.90',currency_id:'BRL',transactions:{
 payments:[{id:receipt.provider_payment_id,amount:'19.90',status:'approved',
  payment_method:{id:'pix',type:'bank_transfer',e2e_id:'original-e2e'}}],refunds:[],chargebacks:[]}};
const cols='DATE,SOURCE_ID,EXTERNAL_REFERENCE,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT,CURRENCY';
const line=(ref=receipt.external_reference)=>`2026-11-13T10:00:05Z,123456789,${ref},release,payment,19.70,0.00,19.90,BRL`;
const base={receipt,sellerId:'98765432',order,payments:[payment],reports:[{fileName:'tamao-release-test.csv',csv:cols+'\n'+line()}],nowMs};
assert.equal(platformReleasedNetEvidence(base).netCents,1970);
assert.equal(platformReleasedNetEvidence({...base,receipt:{...receipt,kind:'mobility'}}).eligible,true);
const ads=copy(base);ads.receipt.kind='advertising';ads.receipt.provider_order_id=null;ads.receipt.provider_payment_id=String(payment.id);ads.order=null;
assert.equal(platformReleasedNetEvidence(ads).eligible,true);
// A local acknowledgement may lag the real release by days. The authenticated
// approval is the chronology anchor; it is never derived from local ACK time.
for(const change of [
 x=>x.receipt.kind='merchant_sale',x=>x.receipt.reversed=true,x=>x.receipt.gross_cents++,
 x=>x.sellerId='77777777',x=>x.payments=[],x=>x.payments=null,
 x=>x.order.user_id=77777777,x=>x.order.id='different',x=>x.order.external_reference='different',
 x=>x.order.transactions.payments[0].amount='19.89',x=>x.order.transactions.payments[0].status_detail='partially_refunded',
 x=>x.order.transactions.refunds.push({id:'refund'}),x=>x.order.live_mode=false,
 x=>x.payments[0].live_mode=false,x=>x.payments[0].collector_id=77777777,
 x=>x.payments[0].external_reference='different',x=>x.payments[0].currency_id='USD',
 x=>x.payments[0].status='pending',x=>x.payments[0].money_release_status='pending',
 x=>x.payments[0].transaction_amount_refunded=0.01,x=>x.payments[0].refunds.push({id:1}),
 x=>x.payments[0].chargebacks.push({id:1}),x=>x.payments[0].transaction_details.net_received_amount=19.69,
 x=>x.payments[0].point_of_interaction.references=[],
 x=>x.payments[0].point_of_interaction.transaction_data.e2e_id='different',
 x=>x.payments[0].date_approved='2026-11-14T12:00:00Z',
 x=>x.reports[0].csv=x.reports[0].csv.replace('19.70','19.69'),
 x=>x.reports[0].csv=x.reports[0].csv.replace('0.00','0.01'),
 x=>x.reports[0].fileName='../unsafe.csv',x=>x.reports[0].csv+='\n'+line(),
 x=>x.reports.push({fileName:'other-release-test.csv',csv:cols+'\n'+line().replace('10:00:05','10:00:06')})
]){
 const changed=copy(base);change(changed);
 assert.equal(platformReleasedNetEvidence(changed).eligible,false,change.toString());
}
for(const type of ['refund','chargeback','mediation','new_provider_type']){
 const changed=copy(base);changed.reports[0].csv+=`\n2026-11-14T10:00:00Z,123456789,${receipt.external_reference},${type},debit,0.00,1.00,1.00,BRL`;
 assert.equal(platformReleasedNetEvidence(changed).eligible,false,type);
 const other=copy(base);other.reports.push({fileName:'second-release-test.csv',csv:cols+changed.reports[0].csv.slice(changed.reports[0].csv.lastIndexOf('\n'))});
 assert.equal(platformReleasedNetEvidence(other).eligible,false,'separate report '+type);
}
const wrongAd=copy(ads);wrongAd.receipt.provider_payment_id='555555555';
assert.equal(platformReleasedNetEvidence(wrongAd).eligible,false);
const calls=[];
const deps={sellerId:'98765432',providerGet:async path=>{calls.push(path);return path.includes('/orders/')?order:payment},
 getReports:async()=>({complete:true,files:['tamao-release-test.csv']}),getCsv:async()=>base.reports[0].csv};
assert.equal((await readPlatformNetEvidence(receipt,deps)).status,'net_verified');
assert(calls.every(p=>p.startsWith('/v1/orders/')||p.startsWith('/v1/payments/')));
assert.equal((await readPlatformNetEvidence({...receipt,reversed:true},{providerGet(){throw Error('no provider request')}})).status,'reversed');
assert.equal((await readPlatformNetEvidence(receipt,{...deps,getReports:async()=>({complete:false,reason:'INCOMPLETE'})})).status,'coverage_incomplete');
assert.equal((await readPlatformNetEvidence(receipt,{...deps,getReports:async()=>({complete:true,files:[]})})).status,'awaiting_report');

let writes=0;
const client={rpc:async(name,args)=>{
 if(name==='platform_receipt_net_pending')return {data:[receipt]};
 assert.equal(name,'platform_receipt_net_record');writes++;
 assert.equal(args.p_evidence.netCents,1970);assert.equal(args.p_evidence.externalReference,receipt.external_reference);
 return {data:{ok:true,source:'platform_receipt_net_evidence',status:'net_verified',moneyMoved:false,entitlementsChanged:false}};
}};
const machine={...deps,client,providerGet:async path=>path==='/users/me'?{id:98765432}:deps.providerGet(path),sha256:async()=> 'a'.repeat(64)};
let result=await reconcilePlatformReceipts({...machine,inspect:true});
assert.equal(writes,0);assert.equal(result.registered,1);assert.equal(result.readOnly,true);
result=await reconcilePlatformReceipts(machine);assert.equal(writes,1);assert.equal(result.moneyMoved,false);
assert(!JSON.stringify(result).includes(receipt.external_reference));assert(!JSON.stringify(result).includes('123456789'));
const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const cut=name=>{const start=admin.indexOf('function '+name+'(');return admin.slice(start,admin.indexOf('\n}',start)+2)};
const ctx=vm.createContext({adminMoney:v=>'R$ '+(v/100).toFixed(2),esc:v=>String(v??'').replaceAll('<','&lt;'),formatDateTime:v=>v});
vm.runInContext(cut('adminPlatformReceiptsValid')+'\n'+cut('adminPlatformReceiptsView')+'\nthis.valid=adminPlatformReceiptsValid;this.view=adminPlatformReceiptsView;',ctx);
const summary={source:'platform_receipt_net_summary',readOnly:true,moneyMoved:false,merchantFundsIncluded:false,
 accountBalanceVerified:false,generatedAt:new Date().toISOString(),totalCount:1,returnedCount:1,truncated:false,
 kindTotals:Object.fromEntries(['billing','coupon','mobility','advertising'].map(k=>[k,{count:k==='billing'?1:0,grossCents:k==='billing'?1990:0,
  verifiedCount:k==='billing'?1:0,verifiedNetCents:k==='billing'?1970:0,reversedCount:0,pendingCount:0}])),
 rows:[{kind:'billing',resourceId:receipt.resource_id,grossCents:1990,paidAt:receipt.paid_at,
  netStatus:'net_verified',netCents:1970,verifiedAt:receipt.paid_at,evidenceReference:'mp-release:<unsafe>.csv:123456789'}]};
assert.equal(ctx.valid(summary),true);assert(ctx.view(summary).includes('R$ 19.70'));
assert(!ctx.view(summary).includes('<unsafe>'));assert(ctx.view(summary).includes('Vendas recebidas diretamente pelas revendas'));
for(const mutate of [x=>x.merchantFundsIncluded=true,x=>x.accountBalanceVerified=true,x=>x.totalCount++,
 x=>x.rows[0].netCents=3000,x=>x.kindTotals.billing.verifiedNetCents=3000,x=>x.rows[0].evidenceReference=null]){
 const bad=copy(summary);mutate(bad);assert.equal(ctx.valid(bad),false);
}
const reversed=copy(summary);reversed.rows[0].netStatus='reversed';reversed.kindTotals.billing.verifiedCount=0;
reversed.kindTotals.billing.reversedCount=1;reversed.kindTotals.billing.verifiedNetCents=0;
assert(ctx.view(reversed).includes('Líquido anterior à revisão/estorno'));assert(ctx.valid(reversed));
console.log('PASS: platform NET binds receiver, Orders, Pix, numeric Payments, report and real gross/net; reversals/conflicts fail closed; inspection writes nothing; scoped Admin readback.');

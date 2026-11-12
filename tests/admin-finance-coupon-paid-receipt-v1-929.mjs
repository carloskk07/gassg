import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const admin=read('js/admin.js');
new vm.Script(admin);
const start=admin.indexOf('function adminFinanceRealState(){');
const end=admin.indexOf('function adminFinanceHomologationView(d){',start);
assert(start>0&&end>start);
const source=admin.slice(start,end);
const invoice='9af683aa-1064-4999-8809-0c92e565a1b5';
const actor='11111111-1111-4111-8111-111111111111';
const brCode='000201'+('01234567890123456789'.repeat(6))+'6304ABCD';
let settled=false,funded=false,role='superadmin',selected='coupons',calls=[],timers=[],nextTimer=0,autoChecks=[];
const runtime={session:{user:{id:actor}},section:'finance',
 financeWorkspace:'homologation',status:'ready'};
const paidPurchase={invoiceId:invoice,packageKey:'all_products_3x5_sponsor',
 status:'paid',amountCents:890,paidAt:'2026-11-10T15:46:34.033Z',
 fundingPending:true,sponsorFundedSpendable:false,netReconciliationRecorded:false};
const pendingPurchase={...paidPurchase,status:'awaiting_payment',paidAt:null,fundingPending:false};
const dataFor=(action)=>{
 if(action==='my-vouchers')return {source:'clube_coupon_paid_my_vouchers_v1',
  purchases:[settled?(funded?{...paidPurchase,fundingPending:false,
    sponsorFundedSpendable:true,netReconciliationRecorded:false}:paidPurchase):pendingPurchase],
  vouchers:funded?[1,2,3].map(ordinal=>({invoiceId:invoice,status:'issued',
    faceCents:500,ordinal})):[]};
 if(action==='catalog')return {source:'clube_paid_catalog_v1_807',couponSalesEnabled:true,
  packages:[{packageKey:'all_products_3x5_sponsor',priceCents:890,
   termsVersion:'clube_coupon_terms_v1_813'}]};
 if(action==='invoice-status')return {ok:true,invoiceId:invoice,
  status:settled?'paid':'awaiting_payment',fundingPending:settled,amountCents:890,
  pixPayable:!settled,pixCode:settled?null:brCode,
  paymentUrl:settled?null:'https://www.mercadopago.com.br/payments/ticket',
  expiresAt:new Date(Date.now()+12*3600_000).toISOString()};
 throw Error('Unexpected financial write: '+action);
};
const context=vm.createContext({
 adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
 adminCurrentRole:()=>role,
 adminFinanceWorkspaceCurrent:()=>runtime.financeWorkspace,
 adminFinanceHomologationEvidenceState:()=>({selected}),
 adminAccessToken:async()=> 'owner-jwt',
 adminInvoke:async input=>{
  assert.equal(input.action,'clube-coupon-auto-status');
  autoChecks.push(input.invoiceId);
  return {source:'coupon_auto_net_status_v1_931',readOnly:true,
   invoiceId:input.invoiceId,enabled:true,status:'awaiting_report',
   reason:'MP_RELEASE_NOT_FOUND'};
 },
 CHAMA_BACKEND:{url:'https://api.example.test',publishableKey:'public-key'},
 chamaFetch:async(url,opt)=>{
  const body=JSON.parse(opt.body);calls.push(body.action);
  assert.equal(url,'https://api.example.test/functions/v1/coupon-credit-pix');
  assert.equal(opt.headers.Authorization,'Bearer owner-jwt');
  return {ok:true,json:async()=>dataFor(body.action)};
 },
 document:{visibilityState:'visible',getElementById:()=>({checked:true})},
 render:()=>{},adminFinanceLabLoadQrEncoder:async()=>true,
 adminFinanceLabLiveQrBlock:()=>'<div id="qr"></div>',
 formatDateTime:()=> '10/11/2026 12:46',
 adminCopyText:()=>{},toast:()=>{},
 esc:x=>String(x),Date,URL,String,Number,Array,Object,Promise,Math,
 confirm:()=>true,crypto:{randomUUID:()=>actor},
 setTimeout:(fn,ms)=>{const id=++nextTimer;timers.push({id,fn,ms});return id;},
 clearTimeout:id=>{timers=timers.filter(t=>t.id!==id)}
});
vm.runInContext(source+
 ';this.real={refresh:adminFinanceRealRefresh,view:adminFinanceRealPanel,'+
 'state:adminFinanceRealState,action:adminFinanceRealAction,'+
 'watch:adminFinanceRealCouponWatch,stop:adminFinanceRealCouponStopWatch};',context);
await context.real.refresh();
assert.deepEqual(calls,['my-vouchers','catalog','invoice-status']);
assert.equal(context.real.state().couponWatch.invoiceId,invoice);
assert.match(context.real.view('coupons'),/Verificar pagamento agora/);
assert(!context.real.view('coupons').includes('Pix PAGO'));
assert(!calls.includes('purchase'),'reading or polling MUST NOT emit real charges');
const loop=timers.find(t=>t.ms===50000);
assert(loop,'polling must schedule provider-read at 50 seconds, within quota');
settled=true;
await loop.fn();
assert.deepEqual(calls.slice(-2),['invoice-status','my-vouchers'],
 'read only status plus owner history must prove paid, not provider hint alone');
assert.equal(context.real.state().couponWatch,null,'paid invoice halts polling');
assert.equal(context.real.state().payment,null,'paid invoice hides stale Pix QR');
const receipt=context.real.view('coupons');
assert.match(receipt,/Pix PAGO e registrado no TAMÃO/);
assert.match(receipt,/R\$ 8,90/);
assert.match(receipt,/Conciliação do líquido pendente/);
assert.match(receipt,/não estão liberados para uso/);
assert.match(receipt,/adminSetFinanceWorkspace/);
assert(!receipt.includes('Gerar checkout real deste pacote'),
 'paid invoice must not invite another homologation charge');
assert(!receipt.includes('Pix copia e cola'),'a paid Pix must not show a payable code');
assert(!calls.includes('purchase'));
// V1.943: owner-sponsored coupons may be usable before MP net reconciliation.
// The Admin must not falsely state the NET has been verified.
funded=true;
await context.real.refresh();
const sponsoredReceipt=context.real.view('coupons');
assert.match(sponsoredReceipt,/Patrocínio conferido: benefício financeiramente elegível/);
assert.match(sponsoredReceipt,/Cupons emitidos visíveis: 3/);
assert.match(sponsoredReceipt,/Conciliação do líquido do Mercado Pago ainda pendente/);
assert.match(sponsoredReceipt,/O relatório contábil do Mercado Pago continua independente/);
assert.match(sponsoredReceipt,/Conferência automática ativa/);
assert.equal(autoChecks.at(-1),invoice,
 'sponsored voucher with NET pending must still query original invoice audit');
// V1.966: machine observations are scoped to their own invoice, never reused
// when two paid purchases appear in the same user's history.
const otherInvoice='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const financeState=context.real.state();
financeState.data.history.purchases.push({
 ...financeState.data.history.purchases[0],invoiceId:otherInvoice
});
const twoReceipts=context.real.view('coupons');
assert.equal((twoReceipts.match(/Conferência automática ativa/g)||[]).length,1,
 'only the matched invoice can display this machine status');
financeState.data.history.purchases.pop();
financeState.autoStatus={source:'coupon_auto_net_status_v1_931',readOnly:true,
 enabled:true,invoiceId:otherInvoice,status:'requires_review',reason:'UNRELATED'};
const wrongStatus=context.real.view('coupons');
assert.doesNotMatch(wrongStatus,/Conferência automática ativa/,
 'another invoice must never supply the displayed NET observation');
assert.doesNotMatch(wrongStatus,/Há divergência a revisar/);

assert.doesNotMatch(sponsoredReceipt,/Valor líquido já verificado no sistema/);
const before=calls.length;
await context.real.action('purchase','all_products_3x5_sponsor');
assert.equal(calls.length,before,'same paid package cannot be recharged from Admin');
selected='advertising';
context.real.stop(context.real.state());
assert.equal(context.real.state().couponWatch,null);
runtime.session={user:{id:'22222222-2222-4222-8222-222222222222'}};
assert.equal(context.real.state().data,null,
 'payment history must not leak to another Admin login');
// Existing CI must preserve buyer/driver/ads and add this real paid receipt regression.
const audit=read('.github/workflows/audit.yml');
assert.match(audit,/admin-finance-real-operations-v1-927\.mjs/);
assert.match(audit,/admin-finance-coupon-pix-display-v1-928\.mjs/);
assert.match(audit,/admin-finance-coupon-paid-receipt-v1-929\.mjs/);
console.log('V1.929 PASS: original R$8.90 Pix confirmed by invoice and owner ledger, watch stops, net receipt remains pending, no duplicate payments.');

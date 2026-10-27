import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/admin-ops/index.ts');
const admin=read('js/admin.js'),bootstrap=read('js/bootstrap.js');
const first=edge.indexOf('async function adminFinanceLabChargeDiagnostics(');
const last=edge.indexOf('async function adminFinanceLabVerifyProviderCharge(',first);
assert.ok(first>0&&last>first,'the server must provide charge diagnostics');
let code=edge.slice(first,last)
  .replaceAll(':any[]','').replaceAll(':any','').replace('const issues:string[]=[];','const issues=[];');
assert.doesNotMatch(code,/\.insert\(|\.update\(|\.delete\(|mercadoPagoFetch\(/,
  'financial diagnosis is read-only, with no provider calls');
const tables=[];
const db={
  from(name){
    tables.push(name);
    if(name==='merchant_billing_provider_charges')return {
      select:()=>({order:()=>({limit:async()=>({
        data:[
          {id:'charge-old',payment_request_id:'request-a',provider:'mercadopago',
            status:'expired',amount_cents:30000,currency:'BRL',
            br_code:'PRIVATE_BR_CODE_OLD',expires_at:'2026-10-16T17:44:54Z',
            created_at:'2026-10-15T17:44:52Z',completed_at:null,last_error_code:null},
          {id:'charge-new',payment_request_id:'request-b',provider:'mercadopago',
            status:'active',amount_cents:2000,currency:'BRL',
            br_code:'PRIVATE_BR_CODE_BROKEN',expires_at:'2099-01-01T00:00:00Z',
            created_at:'2026-10-18T17:44:52Z',completed_at:null,last_error_code:null}
        ],error:null
      })})})
    };
    if(name==='merchant_billing_payment_requests')return {
      select:()=>({in:()=>({limit:async()=>({data:[
        {id:'request-a',status:'pending',expected_amount_cents:30000,request_kind:'package_purchase'},
        {id:'request-b',status:'pending',expected_amount_cents:5000,request_kind:'package_purchase'}
      ],error:null})})})
    };
    if(name==='merchant_billing_payment_events')return {
      select:()=>({in:()=>({order:()=>({limit:async()=>({data:[
        {payment_request_id:'request-a',provider:'mercadopago',status:'ignored',
          amount_cents:30000,received_at:'2026-10-16T12:00:00Z',
          applied_at:null,ignored_at:'2026-10-16T12:01:00Z',
          payer_reference:'PRIVATE_PAYER_DO_NOT_LEAK'},
        {payment_request_id:'request-b',provider:'mercadopago',status:'matched',
          amount_cents:3000,received_at:'2026-10-18T18:00:00Z',
          applied_at:'2026-10-18T18:05:00Z',ignored_at:null},
        {payment_request_id:'request-b',provider:'another_provider',status:'matched',
          amount_cents:5000,received_at:'2026-10-18T19:00:00Z',
          applied_at:'2026-10-18T19:05:00Z',ignored_at:null}
      ],error:null})})})})
    };
    throw new Error('Unexpected table: '+name);
  }
};
const context=vm.createContext({
  Date,Number,Set,String,Map,
  validatePixBrCode:(raw,{expectedAmountCents})=>
    raw==='PRIVATE_BR_CODE_OLD'&&expectedAmountCents===30000
      ?{valid:true,reason:null}:{valid:false,reason:'PIX_BR_CODE_CRC_INVALID'},
  DomainError:class DomainError extends Error{}
});
vm.runInContext(code+';this.diagnose=adminFinanceLabChargeDiagnostics',context);
const data=await context.diagnose(db);
assert.equal(data.ok,true);
assert.equal(data.readOnly,true);
assert.equal(data.count,2);
assert.deepEqual(tables,['merchant_billing_provider_charges',
  'merchant_billing_payment_requests','merchant_billing_payment_events']);
const old=data.charges.find(c=>c.chargeId==='charge-old');
const broken=data.charges.find(c=>c.chargeId==='charge-new');
assert.equal(old.codeValid,true);
assert.equal(old.expired,true);
assert.equal(old.displayableInPortal,false);
assert.ok(old.issues.includes('PIX_EXPIRED'));
assert.equal(old.webhook.receivedCount,1);
assert.equal(old.webhook.ignoredCount,1);
assert.equal(old.webhook.appliedCount,0);
assert.equal(old.webhook.status,'ignored');
assert.ok(!old.issues.includes('SETTLEMENT_EVENT_NOT_FOUND'),
  'an expired uncollected Pix is not automatically a reconciliation failure');
assert.equal(broken.codeValid,false);
assert.equal(broken.amountMatches,false);
assert.ok(broken.issues.includes('REQUEST_AMOUNT_MISMATCH'));
assert.equal(broken.displayableInPortal,false);
assert.ok(broken.issues.includes('PIX_BR_CODE_CRC_INVALID'));
assert.equal(broken.webhook.receivedCount,1,'do not mix PSP providers for same request');
assert.equal(broken.webhook.appliedCount,1);
assert.equal(broken.webhook.status,'applied');
assert.equal(broken.webhook.amountMismatch,true);
assert.ok(broken.issues.includes('WEBHOOK_AMOUNT_MISMATCH'));
assert.ok(!JSON.stringify(data).includes('PRIVATE_BR_CODE'),
 'sensitive codes must not be sent to the browser');
assert.ok(!JSON.stringify(data).includes('merchant_id'),
 'the diagnosis does not expose merchant identity');
assert.ok(!JSON.stringify(data).includes('PRIVATE_PAYER'),
 'private payer references must not appear in diagnostics');
assert.equal(data.evidenceLimit,100);
assert.match(data.note,/Webhook recebido não comprova pagamento/);
const dispatch=edge.indexOf('if(action==="finance-lab-charge-diagnostics")');
assert.ok(dispatch>=0);
assert.match(edge.slice(dispatch,dispatch+420),/adminAccess.admin_role\)!=="superadmin"/);
assert.match(bootstrap,/adminFinanceLabDiagnoseChargesFromUi/);
assert.match(admin,/Diagnosticar cobranças PIX e webhooks/);
assert.match(admin,/Evento aplicado/);
assert.match(admin,/Evento ignorado/);
assert.match(admin,/Sem evento registrado/);
assert.match(admin,/Mesmo uma ordem processada requer conciliação e prova independente de recebimento/);
assert.match(edge,/displayableInPortal/);
const start=admin.indexOf('async function adminFinanceLabDiagnoseChargesFromUi(');
const end=admin.indexOf('async function adminFinanceLabReadinessFromUi(',start);
assert.ok(start>0&&end>start);
let calls=0;
const rt={financeLab:{charges:null,chargesLoading:false,chargesError:null}};
const uiCtx=vm.createContext({
  adminRuntime:rt,adminReady:()=>true,adminCurrentRole:()=> 'superadmin',
  adminInvoke:async payload=>{calls++;assert.equal(payload.action,'finance-lab-charge-diagnostics');return data;},
  render:()=>{},String
});
vm.runInContext(admin.slice(start,end)+';this.refresh=adminFinanceLabDiagnoseChargesFromUi',uiCtx);
await uiCtx.refresh();
assert.equal(calls,1);
assert.equal(rt.financeLab.charges.count,2);
assert.equal(rt.financeLab.chargesLoading,false);

// Read-only provider GET of the actual recorded charge: no fake settlement.
// Test the extracted production implementation with synthetic financial data.
const providerStart=edge.indexOf('async function adminFinanceLabVerifyProviderCharge(');
const providerEnd=edge.indexOf('async function adminFinanceLabReadiness(',providerStart);
assert.ok(providerStart===last&&providerEnd>providerStart);
const providerSource=edge.slice(providerStart,providerEnd)
  .replace('admin:any,actorId:string,body:any','admin,actorId,body')
  .replace('(p:any)=>','(p)=>');
assert.doesNotMatch(providerSource,/\.insert\(|\.update\(|\.delete\(|method:"POST"/);
assert.match(providerSource,/actionName:"admin-finance-provider-verify"/);
assert.match(providerSource,/method:"GET"/);
const id='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const correlation='33333333-3333-4333-8333-333333333333';
let chargeRow={id,payment_request_id:requestId,provider:'mercadopago',
  provider_charge_id:'ORD1234567890',provider_transaction_id:'PAY1234567890',
  correlation_id:correlation,amount_cents:30000,status:'expired'};
let requestRow={id:requestId,status:'pending',expected_amount_cents:30000};
let providerOrder={id:'ORD1234567890',external_reference:correlation,total_amount:'300.00',
  status:'action_required',transactions:{payments:[{
    id:'PAY1234567890',status:'pending',amount:'300.00',
    payment_method:{id:'pix',type:'bank_transfer',qr_code:'PRIVATE_NO_BROWSER'}}]}};
let readCalls=0,pspCalls=0,quotaCalls=0,providerOk=true;
const providerDb={from(name){
  readCalls++;
  assert.ok(['merchant_billing_provider_charges','merchant_billing_payment_requests'].includes(name));
  return {select:()=>({eq:(field,value)=>{
    assert.equal(field,'id');
    assert.equal(value,name==='merchant_billing_provider_charges'?id:requestId);
    return {maybeSingle:async()=>({data:name==='merchant_billing_provider_charges'
      ?chargeRow:requestRow,error:null})};
  }})};
}};
class ProviderDomainError extends Error{
  constructor(code,message,status){super(message);this.code=code;this.status=status}
}
const pctx=vm.createContext({
  Date,Number,String,Array,
  UUID_RE:/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  DomainError:ProviderDomainError,
  Deno:{env:{get:k=>k==='MERCADOPAGO_ACCESS_TOKEN'?'TEST_TOKEN_PROTECTED':'other'}},
  enforceApiQuota:async(_db,opts)=>{quotaCalls++;assert.equal(opts.limit,6);},
  mercadoPagoConfigured:token=>token==='TEST_TOKEN_PROTECTED',
  mercadoPagoFetch:async(path,args)=>{
    pspCalls++;assert.equal(path,'/v1/orders/ORD1234567890');
    assert.equal(args.method,'GET');assert.equal(args.accessToken,'TEST_TOKEN_PROTECTED');
    return {ok:providerOk};
  },
  readMercadoPagoJson:async()=>providerOrder,
  moneyToCents:value=>Math.round(Number(value)*100)
});
vm.runInContext(providerSource+';this.verify=adminFinanceLabVerifyProviderCharge;',pctx);
const evidence=await pctx.verify(providerDb,'test-admin-actor',{chargeId:id});
assert.equal(evidence.ok,true);
assert.equal(evidence.readOnly,true);
assert.equal(evidence.source,'mercadopago_order_lookup_v1');
assert.equal(evidence.chargeId,id);
assert.equal(evidence.identifiersAndAmountMatched,true);
assert.equal(evidence.providerOrderStatus,'action_required');
assert.equal(evidence.providerProcessed,false);
assert.equal(evidence.settlementVerified,false);
assert.equal(evidence.creditIssued,false);
assert.equal(evidence.financialActionTaken,false);
assert.equal(pspCalls,1);
assert.equal(quotaCalls,1);
assert.deepEqual([readCalls,pspCalls],[2,1]);
assert.ok(!JSON.stringify(evidence).includes('TEST_TOKEN_PROTECTED'));
assert.ok(!JSON.stringify(evidence).includes('PRIVATE_NO_BROWSER'));
const was=pspCalls;
await assert.rejects(()=>pctx.verify(providerDb,'test-admin-actor',{chargeId:'not-uuid'}),
  e=>e.code==='FINANCE_LAB_CHARGE_ID_INVALID');
assert.equal(pspCalls,was,'invalid id must not contact PSP');
providerOrder={...providerOrder,status:'processed',transactions:{
  payments:[{...providerOrder.transactions.payments[0],status:'processed'}]}};
const processed=await pctx.verify(providerDb,'test-admin-actor',{chargeId:id});
assert.equal(processed.providerProcessed,true);
assert.equal(processed.paymentAmountMatched,true);
assert.equal(processed.providerSandbox,false);
assert.equal(processed.providerAdverseState,false);
assert.equal(processed.settlementVerified,false);
assert.match(processed.nextStep,/conciliação/);
// Financially contradictory PSP responses are NOT proof of completed payment.
// A partially refunded order may retain a previously processed transaction.
const consistent=structuredClone(providerOrder);
const consistentPayment=consistent.transactions.payments[0];
for(const [name,inconsistent,adverse] of [
  ['explicit sandbox processing',{...consistent,live_mode:false},false],
  ['refunded transaction present',{...consistent,transactions:{...consistent.transactions,refunds:[{id:'REFUND-1',status:'processed',amount:'50.00'}]}},true],
  ['refund awaiting processing',{...consistent,transactions:{...consistent.transactions,refunds:[{id:'REFUND-PENDING',status:'pending'}]}},true],
  ['Pix amount not returned',{...consistent,transactions:{payments:[{...consistentPayment,amount:undefined}]}},false],
  ['order detail inconsistent',{...consistent,status_detail:'waiting_transfer'},false],
  ['Pix detail inconsistent',{...consistent,transactions:{payments:[{...consistentPayment,status_detail:'waiting_transfer'}]}},false],
  ['order disputed',{...consistent,status:'disputed'},true],
  ['payment in mediation',{...consistent,transactions:{payments:[{...consistentPayment,status_detail:'in_mediation'}]}},true],
  ['order still pending',{...consistent,status:'action_required'},false],
  ['Pix still pending',{...consistent,transactions:{payments:[
    {...consistentPayment,status:'action_required'}]}},false],
  ['order refunded',{...consistent,status:'refunded'},true],
  ['Pix refunded',{...consistent,transactions:{payments:[
    {...consistentPayment,status:'refunded'}]}},true],
  ['order partially refunded',{...consistent,status_detail:'partially_refunded'},true],
  ['Pix chargeback',{...consistent,transactions:{payments:[
    {...consistentPayment,status_detail:'charged_back'}]}},true]
]){
  providerOrder=inconsistent;
  const checked=await pctx.verify(providerDb,'test-admin-actor',{chargeId:id});
  assert.equal(checked.providerProcessed,false,name+' must not be called processed');
  assert.equal(checked.providerAdverseState,adverse,name+' adverse state');
  assert.equal(checked.settlementVerified,false);
  assert.equal(checked.creditIssued,false);
  assert.equal(checked.financialActionTaken,false);
  if(adverse)assert.match(checked.nextStep,/Investigar/,name);
  if(name==='explicit sandbox processing'){
    assert.equal(checked.providerSandbox,true);
    assert.match(checked.nextStep,/TESTE/);
  }
  if(name==='Pix amount not returned')assert.equal(checked.paymentAmountMatched,false);
  if(['refunded transaction present','refund awaiting processing'].includes(name))assert.equal(checked.refundPresent,true);
}
providerOrder=consistent;
for(const tampered of [
 {...providerOrder,live_mode:true,currency_id:'USD'},
 {...providerOrder,transactions:{payments:[{...consistentPayment,amount:'299.99'}]}},
 {...providerOrder,transactions:{payments:[{...consistentPayment,id:''}]}},
 {...providerOrder,external_reference:'other-request'},
 {...providerOrder,total_amount:'1000.00'},
 {...providerOrder,id:'ORDER-OTHER'},
 {...providerOrder,transactions:{payments:[{id:'PAY-OTHER',status:'processed',payment_method:{id:'pix',type:'bank_transfer'}}]}},
 {...providerOrder,transactions:{payments:[{id:'PAY1234567890',payment_method:{id:'visa',type:'credit_card'}}]}}
]){
  providerOrder=tampered;
  await assert.rejects(()=>pctx.verify(providerDb,'test-admin-actor',{chargeId:id}),
    e=>e.code==='FINANCE_LAB_PROVIDER_IDENTITY_MISMATCH');
}
chargeRow={...chargeRow,provider:'woovi'};
const previous=pspCalls;
await assert.rejects(()=>pctx.verify(providerDb,'test-admin-actor',{chargeId:id}),
  e=>e.code==='FINANCE_LAB_PROVIDER_NOT_SUPPORTED');
assert.equal(pspCalls,previous);
chargeRow={...chargeRow,provider:'mercadopago'};
requestRow={...requestRow,expected_amount_cents:20000};
await assert.rejects(()=>pctx.verify(providerDb,'test-admin-actor',{chargeId:id}),
  e=>e.code==='FINANCE_LAB_LOCAL_AMOUNT_MISMATCH');
assert.equal(pspCalls,previous);
requestRow={...requestRow,expected_amount_cents:30000};
providerOk=false;
await assert.rejects(()=>pctx.verify(providerDb,'test-admin-actor',{chargeId:id}),
  e=>e.code==='FINANCE_LAB_PROVIDER_LOOKUP_FAILED');
providerOk=true;

// The handler must authorize superadmin explicitly even though this is read-only.
const handler=edge.indexOf('if(action==="finance-lab-provider-verify")');
assert.ok(handler>0);
assert.match(edge.slice(handler,handler+440),/adminAccess.admin_role\)!=="superadmin"/);
assert.match(bootstrap,/adminFinanceLabVerifyProviderFromUi/);
assert.match(admin,/Conferir esta cobrança no Mercado Pago/);
assert.match(admin,/Sem crédito, repasse ou comprovação de liquidação/);
const uiStart=admin.indexOf('async function adminFinanceLabVerifyProviderFromUi(');
const uiEnd=admin.indexOf('async function adminFinanceLabReadinessFromUi(',uiStart);
assert.ok(uiStart>0&&uiEnd>uiStart);
const uiState={financeLab:{providerCheckingId:null,providerCheck:null,providerCheckError:null}};
let uiCalls=0;
const verifyUiCtx=vm.createContext({
  adminRuntime:uiState,adminReady:()=>true,adminCurrentRole:()=> 'superadmin',
  render:()=>{},String,
  adminInvoke:async payload=>{
    uiCalls++;assert.equal(payload.action,'finance-lab-provider-verify');assert.equal(payload.chargeId,id);
    return {...evidence};
  }
});
vm.runInContext(admin.slice(uiStart,uiEnd)+';this.providerCheck=adminFinanceLabVerifyProviderFromUi;',verifyUiCtx);
await verifyUiCtx.providerCheck(id);
assert.equal(uiCalls,1);
assert.equal(uiState.financeLab.providerCheck?.chargeId,id);
assert.equal(uiState.financeLab.providerCheckingId,null);
await verifyUiCtx.providerCheck('arbitrary-path');
assert.equal(uiCalls,1,'client rejects bad identifiers');
console.log('PASS: superadmin live PSP GET is read-only, matched, rate limited and fail-closed; no real charge.');

console.log('PASS: Admin PIX diagnosis + provider read-only verification, no sensitive data or writes');

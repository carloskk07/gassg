import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const boot=read('js/bootstrap.js');
const server=read('supabase/functions/admin-ops/index.ts');
const start=admin.indexOf('function adminFinanceLabCents(');
const end=admin.indexOf('function adminFinanceWorkspaceCurrent()',start);
assert.ok(start>=0&&end>start,'lab functions exist');
const section=admin.slice(start,end);
const state={preview:null,sandbox:null,amountCents:null,idempotencyKey:null,pending:false,error:null,
 readiness:null,readinessLoading:false,status:null};
const nodes={'admin-finance-lab-value':{value:'12,35'},'admin-finance-lab-kind':{value:'invoice'}};
let requests=[],refreshes=0,confirmation=true,autoApprovedTest=false,sandboxFailure=null;
const ctx=vm.createContext({
  adminRuntime:{financeLab:state,providerHealth:null},adminReady:()=>true,
  adminCurrentRole:()=> 'superadmin',
  adminRoleCanSection:()=>true,
  adminMoney:v=>'R$ '+Number(v/100).toFixed(2),
  formatDateTime:v=>v,
  esc:v=>String(v??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])),
  document:{getElementById:id=>nodes[id]||null},
  render:()=>{refreshes++},confirm:()=>confirmation,
  adminIdempotency:()=> 'lab:test-id-1234567890',
  adminInvoke:async(data,opt)=>{
    requests.push({data,opt});
    if(data.action==='finance-lab-sandbox-pix'&&sandboxFailure){
      const error=new Error('Mercado Pago: HTTP '+sandboxFailure.apiStatus);
      error.code='FINANCE_LAB_SANDBOX_PROVIDER_REJECTED';
      error.data=sandboxFailure;
      throw error;
    }
    if(data.action==='finance-lab-readiness')return {
      ok:true,mode:'sandbox',configured:true,officialTestAmountCents:5000,
      recentTests:[],prerequisites:{enabled:true,tokenConfigured:true,distinctToken:true,payerConfigured:true}
    };
    if(data.action==='finance-lab-sandbox-check')return {ok:true,mode:'sandbox',
      orderId:data.orderId,amountCents:5000,orderStatus:'processed',
      paymentStatus:'approved',checkedAt:new Date().toISOString(),credited:false};
    return {ok:true,mode:'sandbox',amountCents:data.amountCents,
      orderId:'ORD01ABC23456789012345',
      pixCodeAvailable:!autoApprovedTest,providerTestApproved:autoApprovedTest,
      credited:false,
      brCode:autoApprovedTest?'':'012345678901234567890123456789012345',
      reference:'lab-test'};
  },
  toast:()=>{},
  navigator:{clipboard:{writeText:async()=>{}}}
});
vm.runInContext(section+';this.lab={cents:adminFinanceLabCents,preview:adminFinanceLabPreviewFromUi,'+
  'sandbox:adminFinanceLabSandboxPixFromUi,view:adminFinanceLabView,'+
  'readiness:adminFinanceLabReadinessFromUi,check:adminFinanceLabCheckOrderFromUi,prerequisites:adminFinanceLabPrerequisiteChecks}',ctx);
assert.equal(ctx.lab.cents('0,01'),1);
assert.equal(ctx.lab.cents('1.234,56'),null,'grouped thousands are deliberately unaccepted to prevent ambiguity');
assert.equal(ctx.lab.cents('999999,99'),99999999);
assert.equal(ctx.lab.cents('1000000,00'),100000000);
assert.equal(ctx.lab.cents('1000000,01'),null);
assert.equal(ctx.lab.cents('-1,00'),null);
ctx.lab.preview();
assert.equal(state.preview.amountCents,1235);
assert.equal(state.preview.kind,'invoice');
assert.equal(requests.length,0,'invoice preview must be zero-impact');
let html=ctx.lab.view({merchantBilling:{providerCharges:[{status:'expired'}],paymentIngress:{activeBillingProvider:'mercadopago'}}});
assert.match(html,/Fatura de exemplo/);
assert.match(html,/NÃO PAGÁVEL/);
assert.match(html,/PIX vencidos/);
assert.match(html,/Gerar Pix oficial de teste \(R\$ 50,00\)/);
await ctx.lab.sandbox();
assert.equal(requests.length,0,'sandbox unavailable before readiness');
assert.match(state.error,/ainda não está configurado/);
// A superadmin can identify missing secret NAMES, never the values.
const noCredentials={
  configured:false,prerequisites:{
    enabled:false,tokenConfigured:false,payerConfigured:false,distinctToken:false
  }
};
state.readiness=noCredentials;
const missing=ctx.lab.prerequisites(noCredentials);
assert.equal(missing.length,4);
assert.ok(missing.every(x=>x.ready===false));
const detail=ctx.lab.view({merchantBilling:{}});
for(const key of ['FINANCE_LAB_SANDBOX_ENABLED','MERCADOPAGO_TEST_ACCESS_TOKEN',
  'FINANCE_LAB_TEST_PAYER_EMAIL','isolamento do token']){
  assert.match(detail,new RegExp(key));
}
assert.match(detail,/Supabase Edge Functions/);
assert.doesNotMatch(detail,/SUPER_SECRET_TEST_VALUE|test_token_value/);
await ctx.lab.sandbox();
assert.equal(requests.length,0,'missing test credentials must block provider call');
assert.match(state.error,/MERCADOPAGO_TEST_ACCESS_TOKEN/);
assert.match(state.error,/FINANCE_LAB_TEST_PAYER_EMAIL/);
state.readiness=null;
await ctx.lab.readiness();
assert.equal(requests.length,1);
assert.equal(state.readiness.configured,true);
await ctx.lab.sandbox();
assert.equal(requests.length,3,'sandbox call plus background readiness refresh');
assert.equal(requests[1].data.action,'finance-lab-sandbox-pix');
assert.equal(requests[1].data.amountCents,5000,'official test amount is fixed');
assert.equal(requests[1].opt.idempotencyKey,'lab:test-id-1234567890');
assert.equal(state.sandbox.mode,'sandbox');
assert.equal(state.sandbox.orderId,'ORD01ABC23456789012345');
assert.match(ctx.lab.view({merchantBilling:{}}),/PIX sandbox/);
await ctx.lab.check('ORD01ABC23456789012345');
assert.equal(state.status.orderStatus,'processed');
assert.equal(state.status.credited,false);
// Mercado Pago can auto-approve its APRO test BEFORE returning a QR code.
autoApprovedTest=true;
await ctx.lab.sandbox();
assert.equal(state.sandbox.providerTestApproved,true);
assert.equal(state.sandbox.brCode,'');
assert.match(ctx.lab.view({merchantBilling:{}}),/Cenário APRO aprovado em teste/);
assert.doesNotMatch(ctx.lab.view({merchantBilling:{}}),/Copiar código de teste/,
 'an already-approved simulated Pix must not display a copyable QR');
const afterCheck=requests.length;
confirmation=false;
await ctx.lab.sandbox();
assert.equal(requests.length,afterCheck,'declined confirmation cannot call provider');
// Explicit provider rejection may rotate a key only if refusal is definitive.
confirmation=true;
sandboxFailure={apiStatus:401};
await ctx.lab.sandbox();
assert.equal(state.idempotencyKey,null,'Definite 401 refusal permits a fresh manual test');
assert.match(state.error,/HTTP 401/);
sandboxFailure={apiStatus:500};
await ctx.lab.sandbox();
assert.equal(state.idempotencyKey,'lab:test-id-1234567890',
  'Ambiguous 5xx must retain idempotency key to prevent duplicate orders');
sandboxFailure=null;

assert.match(boot,/adminFinanceLabSandboxPixFromUi/);
assert.match(boot,/adminFinanceLabPreviewFromUi/);
assert.match(boot,/adminFinanceLabReadinessFromUi/);
assert.match(boot,/adminFinanceLabCheckOrderFromUi/);
assert.match(admin,/id":"lab","label":"Laboratório"/);
assert.match(server,/action==="finance-lab-sandbox-pix"/);
assert.match(server,/action==="finance-lab-readiness"/);
assert.match(server,/action==="finance-lab-sandbox-check"/);
assert.match(server,/FINANCE_LAB_PIX_TEST_AMOUNT_CENTS=5000/);
assert.match(server,/first_name:"APRO"/);
assert.doesNotMatch(server.slice(server.indexOf("async function adminFinanceLabSandboxPix("),
  server.indexOf("async function billingProviderHealth(")),/expiration_time:"P1D"/,
  'automatic Pix orders must not set manual expiration_time');
assert.match(server,/adminAccess.admin_role\)!=="superadmin"/);
assert.match(server,/MERCADOPAGO_TEST_ACCESS_TOKEN/);
assert.match(server,/FINANCE_LAB_SANDBOX_ENABLED/);
assert.match(server,/new URL\(sandboxUrl\).*sandbox/);
assert.match(server,/validatePixBrCode\(brCode,\{expectedAmountCents:amount\}\)/);
assert.match(server,/action:"finance_lab_sandbox_pix_created"/);
assert.match(server,/platform_admin_audit/);
const sandboxCheck=server.slice(server.indexOf('async function adminFinanceLabCheckSandboxOrder('),
  server.indexOf('async function adminFinanceLabSandboxPix('));
assert.match(sandboxCheck,/\.eq\("actor_user_id",actorId\)/,
  'status lookup must be scoped to the authenticated admin');
assert.match(sandboxCheck,/\.order\("created_at",\{ascending:false\}\)\.limit\(1\)\.maybeSingle\(\)/,
  'repeated idempotent audit rows must not break a status lookup');

assert.doesNotMatch(section,/merchant_billing_payment_requests|merchant_fee_credit_ledger|wallet_entries/);

// Exercise the production provider-response verification with synthetic
// provider output (never an actual charge). Test both official valid paths:
// pending with Pix QR; auto-approved APRO response WITHOUT any QR.
const functionStart=server.indexOf('async function adminFinanceLabSandboxPix(');
const functionEnd=server.indexOf('\nasync function ',functionStart+10);
assert.ok(functionStart>0&&functionEnd>functionStart);
const actualSource=server.slice(functionStart,functionEnd)
  .replace('admin:any,actorId:string,body:any,req:Request','admin,actorId,body,req')
  .replace('(x:any)=>','(x)=>');
const ref='tamao-finlab-'+'a'.repeat(40);
assert.match(ref,/^[A-Za-z0-9_-]{1,64}$/,'Mercado Pago must accept reference characters and length');
assert.equal(ref.length,53);
const legacyReference='tamao-finlab-finance-lab-pix:12345678-1234-4123-8123-123456789012';
assert.equal(legacyReference.length,65,'regression: old browser UUID produced overlong reference');
assert.doesNotMatch(legacyReference,/^[A-Za-z0-9_-]{1,64}$/,'old reference had a forbidden colon');
let apiResult={},providerCalls=[],auditInserted=[],brChecks=0;
const brCode='012345678901234567890123456789012345';
const sandboxBase={
 id:'ORD01ABC23456789012345',live_mode:false,total_amount:'50.00',
 external_reference:ref,status:'action_required',
 transactions:{payments:[{id:'PAY01ABC23456789012345',
   status:'action_required',payment_method:{id:'pix',type:'bank_transfer',
     qr_code:brCode,ticket_url:'https://www.mercadopago.com.br/sandbox/payments/123'}}]}
};
const sandboxContext=vm.createContext({
 URL,Number,Date,String,Array,
 FINANCE_LAB_PIX_TEST_AMOUNT_CENTS:5000,
 sha256Hex:async value=>{assert.equal(value,'finlab-qa-id-12345');return 'a'.repeat(64);},
 adminFinanceLabConfig:()=>({ready:true,token:'test-only',payerEmail:'payer@example.com'}),
 mercadoPagoFetch:async(path,opts)=>{
   providerCalls.push({path,opts});
   return {ok:true,status:200};
 },
 readMercadoPagoJson:async()=>apiResult,
 safeMercadoPagoUrl:raw=>typeof raw==='string'&&raw.startsWith('https://www.mercadopago.com.br/sandbox/')?raw:null,
 validatePixBrCode:(raw,opts)=>{
   brChecks++;return {valid:raw===brCode&&opts.expectedAmountCents===5000};
 },
 moneyToCents:v=>Math.round(Number(v)*100),
 DomainError:class DomainError extends Error{constructor(code,msg,status){super(msg);this.code=code;this.status=status;}}
});
vm.runInContext(actualSource+';this.createTestPix=adminFinanceLabSandboxPix;',sandboxContext);
const auditDb={from(name){
 assert.equal(name,'platform_admin_audit');
 return {insert:async data=>{auditInserted.push(data);return {error:null}}};
}};
const request={headers:{get:()=> 'finlab-qa-id-12345'}};
apiResult=structuredClone(sandboxBase);
let created=await sandboxContext.createTestPix(auditDb,'11111111-1111-4111-8111-111111111111',
 {amountCents:5000},request);
assert.equal(created.ok,true);
assert.equal(created.pixCodeAvailable,true);
assert.equal(created.providerTestApproved,false);
assert.equal(created.credited,false);
assert.equal(created.brCode,brCode);
assert.equal(providerCalls[0].path,'/v1/orders');
assert.equal(providerCalls[0].opts.body.external_reference,ref);
assert.match(providerCalls[0].opts.body.external_reference,/^[A-Za-z0-9_-]{1,64}$/);
assert.equal(providerCalls[0].opts.idempotencyKey,'finlab-qa-id-12345');
assert.equal(providerCalls[0].opts.body.payer.first_name,'APRO');
apiResult=structuredClone(sandboxBase);
apiResult.status='processed';
apiResult.transactions.payments[0].status='approved';
delete apiResult.transactions.payments[0].payment_method.qr_code;
delete apiResult.transactions.payments[0].payment_method.ticket_url;
created=await sandboxContext.createTestPix(auditDb,'11111111-1111-4111-8111-111111111111',
 {amountCents:5000},request);
assert.equal(created.ok,true);
assert.equal(created.providerTestApproved,true);
assert.equal(created.pixCodeAvailable,false);
assert.equal(created.brCode,'');
assert.equal(created.credited,false);
assert.match(created.message,/TESTE/);
const approvedSnapshot=structuredClone(apiResult);
const beforeRejected=auditInserted.length;
for(const bad of [
 {...approvedSnapshot,external_reference:'tamao-finlab-another-order'},
 {...approvedSnapshot,total_amount:'49.00'},
 {...approvedSnapshot,live_mode:true},
 {...approvedSnapshot,transactions:{payments:[{
    ...approvedSnapshot.transactions.payments[0],status:'action_required'}]}},
 {...approvedSnapshot,transactions:{payments:[{
    ...approvedSnapshot.transactions.payments[0],payment_method:{id:'pix',type:'credit_card'}}]}}
]){
 apiResult=bad;
 await assert.rejects(sandboxContext.createTestPix(auditDb,
   '11111111-1111-4111-8111-111111111111',
   {amountCents:5000},request),{code:'FINANCE_LAB_NOT_VERIFIED_SANDBOX'});
}
assert.equal(auditInserted.length,beforeRejected,
 'invalid provider identities/status must not create a sandbox audit');
assert.ok(brChecks>=1);
assert.match(server,/String\(order\?\.external_reference\?\?""\)!==externalReference/);
assert.match(server,/providerTestApproved/);
assert.match(server,/credited:false/);


// Status GET regression: Mercado Pago's Orders GET can omit the sandbox
// URL and live_mode after the POST already proved sandbox and wrote audit.
// A prior verified creation record plus exact ID, reference, amount and Pix
// method is sufficient to READ the status, never to settle/issue a credit.
const checkStart=server.indexOf('async function adminFinanceLabCheckSandboxOrder(');
const checkEnd=server.indexOf('async function adminFinanceLabSandboxPix(',checkStart);
assert.ok(checkStart>0&&checkEnd>checkStart);
const checkSource=server.slice(checkStart,checkEnd)
  .replace('admin:any,actorId:string,body:any','admin,actorId,body')
  .replaceAll('(x:any)=>','(x)=>');
const actorId='11111111-1111-4111-8111-111111111111';
const originalAudit=structuredClone(auditInserted[0].metadata);
let getBody=structuredClone(sandboxBase),auditProof=originalAudit;
const getCalls=[];
const lookupContext=vm.createContext({
 URL,Number,String,Array,Date,
 FINANCE_LAB_PIX_TEST_AMOUNT_CENTS:5000,
 adminFinanceLabConfig:()=>({ready:true,token:'TEST_ONLY'}),
 mercadoPagoFetch:async(path,opts)=>{
   assert.equal(path,'/v1/orders/'+sandboxBase.id);
   assert.equal(opts.method,'GET');
   assert.equal(opts.accessToken,'TEST_ONLY');
   getCalls.push(path);
   return {ok:true,status:200};
 },
 readMercadoPagoJson:async()=>getBody,
 moneyToCents:v=>Math.round(Number(v)*100),
 safeMercadoPagoUrl:raw=>typeof raw==='string'
   &&raw.startsWith('https://www.mercadopago.com.br/')?raw:null,
 DomainError:class DomainError extends Error {
   constructor(code,message,status){super(message);this.code=code;this.status=status;}
 }
});
vm.runInContext(checkSource+'\nthis.checkStatus=adminFinanceLabCheckSandboxOrder;',lookupContext);
const lookupDb={from(table){
 assert.equal(table,'platform_admin_audit');
 return {
   select(fields){assert.equal(fields,'target_id,metadata');return this;},
   eq(field,value){if(field==='actor_user_id')assert.equal(value,actorId);return this;},
   order(field,opts){assert.equal(field,'created_at');assert.equal(opts.ascending,false);return this;},
   limit(n){assert.equal(n,1);return this;},
   maybeSingle:async()=>({data:{target_id:sandboxBase.id,metadata:auditProof},error:null})
 };
}};
const lookup=()=>lookupContext.checkStatus(lookupDb,actorId,{orderId:sandboxBase.id});
delete getBody.live_mode;
delete getBody.transactions.payments[0].payment_method.ticket_url;
let proofStatus=await lookup();
assert.equal(proofStatus.ok,true,'read GET with missing sandbox markers using verified creation audit');
assert.equal(proofStatus.orderStatus,'action_required');
assert.equal(proofStatus.paymentStatus,'action_required');
assert.equal(proofStatus.environmentProof,'audited_sandbox_creation');
assert.equal(proofStatus.paymentSimulated,true);
assert.equal(proofStatus.settlementVerified,false);
assert.equal(proofStatus.credited,false);
assert.equal(getCalls.length,1,'read provider exactly once; no new order');

getBody.status='processed';
getBody.transactions.payments[0].status='approved';
proofStatus=await lookup();
assert.equal(proofStatus.orderStatus,'processed');
assert.equal(proofStatus.paymentStatus,'approved');
assert.equal(proofStatus.settlementVerified,false,'test-approved is never real payout');
assert.equal(proofStatus.credited,false);

getBody.live_mode=false;
proofStatus=await lookup();
assert.equal(proofStatus.environmentProof,'provider_non_live');
delete getBody.live_mode;
getBody.transactions.payments[0].payment_method.ticket_url=
  'https://www.mercadopago.com.br/sandbox/payments/123';
proofStatus=await lookup();
assert.equal(proofStatus.environmentProof,'provider_sandbox_ticket');
delete getBody.transactions.payments[0].payment_method.ticket_url;

const legitimateRead=structuredClone(getBody);
for(const bad of [
 {...legitimateRead,live_mode:true},
 {...legitimateRead,id:'OTHERORDER123456'},
 {...legitimateRead,external_reference:'tamao-finlab-'+'f'.repeat(40)},
 {...legitimateRead,total_amount:'49.00'},
 {...legitimateRead,transactions:{payments:[]}},
 {...legitimateRead,transactions:{payments:[{
   ...legitimateRead.transactions.payments[0],
   payment_method:{id:'pix',type:'credit_card'}
 }]}},
 {...legitimateRead,transactions:{payments:[{
   ...legitimateRead.transactions.payments[0],
   payment_method:{id:'pix',type:'bank_transfer',
     ticket_url:'https://www.mercadopago.com.br/checkout/live/123'}
 }]}}
]){
 getBody=bad;
 await assert.rejects(lookup(),e=>e?.code==='FINANCE_LAB_ORDER_MISMATCH'
   ||e?.code==='FINANCE_LAB_NOT_VERIFIED_SANDBOX');
}
getBody=legitimateRead;
for(const invalidAudit of [
 {...originalAudit,provider:'not-mercadopago'},
 {...originalAudit,mode:'production'},
 {...originalAudit,pixCodeAvailable:false,testApproved:false},
 {...originalAudit,externalReference:'wrong'},
 {...originalAudit,amountCents:4999}
]){
 auditProof=invalidAudit;
 await assert.rejects(lookup(),e=>e.code==='FINANCE_LAB_ORDER_NOT_OWNED'
   ||e.code==='FINANCE_LAB_NOT_VERIFIED_SANDBOX');
}
auditProof={...originalAudit,pixCodeAvailable:false,testApproved:true};
assert.equal((await lookup()).ok,true,'QR-less APRO approved audit is also valid');
auditProof=originalAudit;
assert.ok(getCalls.length>2);

const classificationStart=server.indexOf('function adminFinanceLabProviderRejection(');
const classificationEnd=server.indexOf('// Historical Pix diagnosis:',classificationStart);
assert.ok(classificationStart>0&&classificationEnd>classificationStart);
const classifySource=server.slice(classificationStart,classificationEnd)
  .replace('order:any,status:number','order,status')
  .replaceAll('(item:any)=>','(item)=>');
const classifyContext=vm.createContext({});
vm.runInContext(classifySource+'\nthis.classify=adminFinanceLabProviderRejection;',classifyContext);
const classify=classifyContext.classify;
const denied=classify({error:'invalid_credentials',message:'PRIVATE_PAYER@example.invalid',token:'APP_USR_SECRET'},401);
assert.equal(denied.apiStatus,401);
assert.equal(denied.providerCode,'invalid_credentials');
assert.match(denied.message,/Access Token de TESTE/);
assert.match(denied.message,/HTTP 401/);
assert.ok(!JSON.stringify(denied).includes('PRIVATE_PAYER'));
assert.ok(!JSON.stringify(denied).includes('APP_USR_SECRET'));
const invalidPayer=classify({errors:[{code:'property_value',message:'PRIVATE_EMAIL'}]},400);
assert.equal(invalidPayer.providerCode,'property_value');
assert.match(invalidPayer.message,/e-mail pagador/);
// Classify provider field names without returning sensitive error descriptions.
const rejectedEmail=classify({errors:[{
 code:'property_value',
 message:"Invalid value for payer.email: private.user@example.invalid"
}]},400);
assert.equal(rejectedEmail.providerCode,'property_value');
assert.equal(rejectedEmail.providerField,'payer.email');
assert.match(rejectedEmail.message,/payer\.email/);
assert.ok(!JSON.stringify(rejectedEmail).includes('private.user@example.invalid'));
const invalidTestEmail=classify({code:'invalid_email_for_sandbox',
 message:'Email must contain @testuser.com'},400);
assert.equal(invalidTestEmail.providerCode,'invalid_email_for_sandbox');
assert.match(invalidTestEmail.message,/payer\.email/);
assert.equal(invalidTestEmail.providerField,null,
 'do not claim provider disclosed a specific field path when it did not');
const rejectedExpiration=classify({errors:[{code:'property_value',
 message:'expiration_time is invalid; secret=user-private'}]},400);
assert.equal(rejectedExpiration.providerField,'expiration_time');
assert.match(rejectedExpiration.message,/expiration_time/);
assert.ok(!JSON.stringify(rejectedExpiration).includes('user-private'));
const unrecognized=classify({errors:[{code:'property_value',
 message:'invalid secret privatepayer@not-disclosable.invalid'}]},400);
assert.equal(unrecognized.providerField,null);
assert.ok(!JSON.stringify(unrecognized).includes('privatepayer'));
const invalidExternal=classify({errors:[{code:'property_value',
 message:'external_reference must contain only letters, numbers and underscores'}]},400);
assert.equal(invalidExternal.providerField,'external_reference');
assert.match(invalidExternal.message,/external_reference/);
const forbidden=classify({code:'forbidden'},403);
assert.match(forbidden.message,/permissões/);
const maxed=classify({code:'usage_quota_exceeded'},429);
assert.match(maxed.message,/Limite de requisições/);
const unsafe=classify({code:'exposed_secret_12345',error:'PRIVATE_SECRET_MESSAGE',cause:[{code:'PRIVATE_PAYER_ID'}]},402);
assert.equal(unsafe.providerCode,null);
assert.match(unsafe.message,/HTTP 402/);
assert.ok(!JSON.stringify(unsafe).includes('PRIVATE_'));
const uncertain=classify({},500);
assert.match(uncertain.message,/histórico/);
assert.match(server,/console\.warn\("FINANCE_LAB_SANDBOX_PROVIDER_REJECTED",diagnosis\.apiStatus,diagnosis\.providerCode/);
assert.doesNotMatch(server.slice(server.indexOf('async function adminFinanceLabSandboxPix('),server.indexOf('async function billingProviderHealth(')),/console\.warn\([^\n]*config\.token/);
assert.match(admin,/\[400,401,403\]\.includes\(Number\(e\?\.data\?\.apiStatus\)\)/);
assert.match(admin,/e\?\.code==='FINANCE_LAB_SANDBOX_PROVIDER_REJECTED'/);

console.log('PASS admin lab: arbitrary invoice simulation, official sandbox preset, authorization, status');

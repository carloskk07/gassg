import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const admin=read('js/admin.js');
const audit=read('.github/workflows/audit.yml');
const from=merchant.indexOf('// V1.269 — operational claims');
const to=merchant.indexOf('/* V1.170 —',from);
assert.ok(from>0&&to>from,'Expected isolated merchant implementation');
const actor='11111111-1111-4111-8111-111111111111';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const provider={
 provider:'mercadopago',displayName:'<Mercado Pago>',
 setupState:'oauth',connectReady:true,connectionMode:'oauth',
 adapterStatus:'implemented',verificationLevel:'provider',
 supportedMethods:['pix'],notes:'Dinheiro direto na revenda.'
};
const manual={merchant:{paymentMethods:{pix:true}},paymentProviders:[provider],
 receivingAccounts:[],paymentRoutes:[{provider:'mercadopago',verificationMode:'merchant_confirmed',metadata:{merchantDeclaredProvider:true}}]};
const stageCtx=vm.createContext({
 esc,merchantProviderName:()=>'<Mercado Pago>',merchantVerificationLabel:()=>'<PSP>',
 merchantProviderManualDeclared:(key,rt)=>rt?.paymentRoutes?.some(r=>r.provider===key)||false,
 merchantProviderManualMethods:()=>['pix'],
});
vm.runInContext(merchant.slice(from,to),stageCtx,{filename:'merchant-psp-stages.js'});
const account=(enabled,canValidate,e2e)=>({
 provider:'mercadopago',connected:true,
 capabilities:{directSalePaymentsEnabled:enabled,canValidateProviderTransactions:canValidate,e2eValidated:e2e}
});
const state=(a,manualDeclared=false)=>stageCtx.merchantPaymentProviderStage(provider,a,manualDeclared);
assert.equal(state(account(true,true,false)).label,'AUTOMAÇÃO ATIVA');
assert.notEqual(state(account(true,true,false)).label,'INTEGRAÇÃO VERIFICADA');
assert.equal(state(account(true,true,true)).label,'INTEGRAÇÃO VERIFICADA');
assert.equal(state(account(true,false,true)).label,'INCONSISTENTE');
assert.equal(state(account(false,true,true)).label,'AUTOMAÇÃO PAUSADA');
assert.equal(state(account(false,true,false)).label,'CONECTADO');
assert.equal(state(null,true).label,'EM USO • MANUAL');
assert.equal(state(null,false).label,'AUTOMAÇÃO DISPONÍVEL');
assert.match(state(account(true,true,false)).next,/primeira venda automática/);
assert.match(state(account(true,false,true)).next,/revisão administrativa/);
assert.equal(stageCtx.merchantPaymentActivationSteps(account(false,true,true),false)[3].done,true);
assert.equal(stageCtx.merchantPaymentActivationSteps(account(true,true,false),false)[3].done,false);
assert.equal(stageCtx.merchantPaymentActivationSteps(null,true)[0].done,true);
assert.equal(stageCtx.merchantPaymentActivationSteps(null,true)[3].done,false);
const renderAccount=a=>stageCtx.merchantPaymentConnectionsView({...manual,paymentRoutes:[],receivingAccounts:[a]});
assert.match(renderAccount(account(true,true,false)),/AUTOMAÇÃO ATIVA/);
assert.doesNotMatch(renderAccount(account(true,true,false)),/INTEGRAÇÃO VERIFICADA/);
assert.match(renderAccount(account(true,true,true)),/INTEGRAÇÃO VERIFICADA/);
assert.match(renderAccount(account(true,false,true)),/INCONSISTENTE/);
assert.match(renderAccount(account(false,true,true)),/AUTOMAÇÃO PAUSADA/);
assert.match(renderAccount(account(false,true,true)),/CONCLUÍDA/);
assert.match(renderAccount(account(true,true,false)),/PENDENTE/);
assert.match(stageCtx.merchantPaymentConnectionsView(manual),/EM USO • MANUAL/);
assert.match(renderAccount(account(false,false,false)),/Conectado/i);
assert.match(renderAccount(account(false,false,false)),/&lt;Mercado Pago&gt;/);
assert.doesNotMatch(renderAccount(account(false,false,false)),/<Mercado Pago>/);
assert.match(renderAccount(account(true,true,false)),/Etapas de verificação automática/);
assert.match(renderAccount(account(true,true,false)),/TAMÃO não recebe nem repassa/);

const begin=admin.indexOf('function adminPaymentPreflightKey');
const end=admin.indexOf('function adminMerchantPaymentProviderCatalog',begin);
assert.ok(begin>0&&end>begin,'Expected isolated preflight and card implementation');
const adminRuntime={
 session:{user:{id:actor}},
 data:{merchantPayments:{providerCatalog:[{
   provider_key:'mercadopago',adapter_status:'implemented',verification_level:'provider'
 }],globalDirectPaymentsEnabled:true}},
 paymentPreflights:{}
};
const merchantRecord={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Revenda'};
const providerAccount={provider:'mercadopago',status:'active',
  capabilities:{directSalePaymentsEnabled:false,canValidateProviderTransactions:true,e2eValidated:false},
  provider_account_id:'abcdef123456',connected_at:null,verification_level:'provider'};
const adminCtx=vm.createContext({
 adminRuntime,adminInvoke:async()=>({
   readyForActivation:true,readyForCapabilityActivation:true,
   gates:[{key:'activation',label:'Ativação',detail:'Validado',ok:true}]
 }),
 adminBillingProviderName:()=> 'Mercado Pago',
 adminMerchantPaymentAdapterLabel:()=> 'Implementado',
 adminMerchantPaymentVerificationLabel:()=> 'PROVEDOR',
 adminRelativeTime:()=> 'agora',formatDateTime:x=>x,render:()=>{},esc,Date
});
vm.runInContext(admin.slice(begin,end),adminCtx,{filename:'admin-psp-preflight.js'});
const card=()=>adminCtx.adminMerchantPaymentAccountCard({merchant:merchantRecord,account:providerAccount});
assert.match(card(),/disabled title="Conclua a verificação antes da ativação"/);
await adminCtx.adminRunMerchantPaymentPreflight(merchantRecord.id,'mercadopago');
assert.doesNotMatch(card(),/disabled title="Conclua a verificação antes da ativação"/);
const key=merchantRecord.id+'|mercadopago';
const current=adminRuntime.paymentPreflights[key];
assert.equal(adminCtx.adminPaymentPreflightCurrent(current,merchantRecord.id,'mercadopago'),true);
assert.equal(adminCtx.adminPaymentPreflightCurrent(current,merchantRecord.id,'stone'),false);
assert.equal(adminCtx.adminPaymentPreflightCurrent(current,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','mercadopago'),false);
current.checkedAt=new Date(Date.now()-130000).toISOString();
assert.equal(adminCtx.adminPaymentPreflightCurrent(current,merchantRecord.id,'mercadopago'),false);
assert.match(card(),/disabled title="Conclua a verificação antes da ativação"/);
assert.match(adminCtx.adminMerchantPaymentPreflightView(merchantRecord.id,'mercadopago'),/Verificação expirada/);
current.checkedAt=new Date(Date.now()+60000).toISOString();
assert.equal(adminCtx.adminPaymentPreflightCurrent(current,merchantRecord.id,'mercadopago'),false);
current.checkedAt=new Date().toISOString();
adminRuntime.session.user.id='22222222-2222-4222-8222-222222222222';
assert.equal(adminCtx.adminPaymentPreflightCurrent(current,merchantRecord.id,'mercadopago'),false);
assert.match(card(),/disabled title="Conclua a verificação antes da ativação"/);
assert.match(audit,/node tests\/merchant-psp-trust-v1-269.mjs/);
console.log('V1.269 PASS: no premature PSP verified claim, manual continuity, session-scoped expiring preflight.');

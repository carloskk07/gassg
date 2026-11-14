import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const a=src.indexOf('function adminFinanceRealState(){'),b=src.indexOf('function adminFinanceHomologationView(d){',a);
const merchant='22000000-0000-4000-8000-000000000002',actor='11000000-0000-4000-8000-000000000001';
let selected='merchants',checked=false,charge=null,creates=0,reads=0,credit=0;
const runtime={status:'ready',section:'finance',financeWorkspace:'homologation',session:{user:{id:actor}}};
const billing=()=>({source:'admin_finance_owned_billing_v1',readOnly:true,paymentsCreated:0,
 accounts:[{id:merchant,name:'Conta própria',status:'pending'}],selectedMerchantId:merchant,
 account:{credit_balance_cents:credit,credit_reserved_cents:0},
 plans:[{planKey:'credit_01990',title:'Essencial',priceCents:1990,creditCents:1990}],latestCharge:charge});
const context=vm.createContext({adminRuntime:runtime,adminReady:()=>runtime.status==='ready',adminCurrentRole:()=> 'superadmin',
 adminFinanceWorkspaceCurrent:()=>runtime.financeWorkspace,adminFinanceHomologationEvidenceState:()=>({selected}),
 adminAccessToken:async()=> 'local-authenticated-user',CHAMA_BACKEND:{url:'https://isolated.invalid',publishableKey:'local-public-key'},
 adminInvoke:async req=>{assert.equal(req.action,'finance-owned-billing-read');return billing()},
 chamaFetch:async(url,opts)=>{
  const body=JSON.parse(opts.body);assert.equal(opts.headers.Authorization,'Bearer local-authenticated-user');
  if(url.endsWith('/mobility-fee-pix'))return {ok:true,json:async()=>({ok:true,charge:null,driverEligible:false,plans:[{planKey:'essential',priceCents:990}]})};
  assert(url.endsWith('/merchant-billing-pix'));assert.equal(body.merchantId,merchant);
  if(body.action==='charge'){
   assert.match(opts.headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);
   assert.equal(body.planKey,'credit_01990');creates++;
   charge={id:'33000000-0000-4000-8000-000000000003',status:'active',amountCents:1990,
    expiresAt:new Date(Date.now()+3600000).toISOString(),brCode:null,paymentLinkUrl:'https://www.mercadopago.com.br/payment/ticket'};
   return {ok:true,json:async()=>({ok:true,charge})};
  }
  assert.equal(body.action,'status');reads++;
  return {ok:true,json:async()=>({source:'merchant_billing_pix_status_v1',ok:true,newChargesCreated:0,charge})};
 },document:{getElementById:()=>({checked}),visibilityState:'visible'},confirm:()=>true,
 render:()=>{},setTimeout:()=>1,URL,Date,Number,String,Object,Array,Promise,Error,
 crypto:{randomUUID:()=> '44000000-0000-4000-8000-000000000004'},esc:x=>String(x),toast:()=>{}});
vm.runInContext(src.slice(a,b)+';this.native={read:adminFinanceRealRefresh,action:adminFinanceRealAction,panel:adminFinanceRealPanel,state:adminFinanceRealState};',context);
await context.native.read();assert.equal(creates,0);assert.equal(reads,1,'opening Admin only reads the existing charge');
assert.match(context.native.panel('merchants'),/Gerar Pix do pacote escolhido/);
assert.match(context.native.panel('merchants'),/R\$ 19,90/);
await context.native.action('purchase','credit_01990');assert.equal(creates,0,'unchecked consent cannot create a charge');
checked=true;await context.native.action('purchase','foreign_plan');assert.equal(creates,0);
await context.native.action('purchase','credit_01990');assert.equal(creates,1);
await context.native.action('purchase','credit_01990');assert.equal(creates,1,'same active payment cannot be duplicated');
assert.match(context.native.panel('merchants'),/Consultar Pix original/);
charge.status='completed';credit=1990;
await context.native.action('check');assert.equal(creates,1);assert.equal(context.native.state().data.billing.account.credit_balance_cents,1990);
assert.match(context.native.panel('merchants'),/Pagamento do pacote confirmado/);
assert.doesNotMatch(context.native.panel('merchants'),/Gerar Pix do pacote escolhido/);
selected='mobility';await context.native.read();
assert.match(context.native.panel('mobility'),/perfil de motorista publicado/);
assert.doesNotMatch(context.native.panel('mobility'),/Criar recarga real/);
console.log('PASS: owned merchant checkout inside Admin, live prices, explicit consent, existing Pix recovery, single grant readback and ineligible-driver explanation.');

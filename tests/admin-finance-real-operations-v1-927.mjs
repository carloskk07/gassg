import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
new vm.Script(admin);
const begin=admin.indexOf('function adminFinanceRealState(){');
const end=admin.indexOf('function adminFinanceHomologationView(d){',begin);
assert(begin>0&&end>begin,'native buyer/driver/advertiser checkout must be in Admin');
const source=admin.slice(begin,end);
const root='https://admin.tamao.com.br',campaign='11111111-1111-4111-8111-111111111111';
let role='superadmin',selected='coupons',confirm=true,checked=false,requests=[];
let current={actor:'admin-1',user:{id:'admin-1'}};
const runtime={session:{user:{id:'admin-1'}},section:'finance',
 financeWorkspace:'homologation',status:'ready'};
const backend=async(endpoint,body)=>{
 if(endpoint==='coupon-credit-pix'){
  if(body.action==='catalog')return {source:'clube_paid_catalog_v1_807',couponSalesEnabled:false,packages:[]};
  if(body.action==='my-vouchers')return {source:'clube_coupon_paid_my_vouchers_v1',purchases:[]};
  if(body.action==='purchase')return {ok:true,status:'awaiting_payment',
   amountCents:890,pixPayable:false};
 }
 if(endpoint==='mobility-fee-pix'){
  if(body.action==='status')return {ok:true,charge:null};
  if(body.action==='plan')return {ok:true,charge:{status:'active',amountCents:990,
   paymentLinkUrl:'https://www.mercadopago.com.br/payment/ticket',brCode:null}};
 }
 if(endpoint==='ads-independent'){
  if(body.action==='mine')return {source:'ads_independent_mine_v1_884',noCharge:true,
   rows:[{id:campaign,title:'Publicidade local real',status:'approved'}],
   homologationCampaignId:campaign};
  if(body.action==='submit')return {source:'ads_independent_submit_v1_884',paymentCreated:false};
 }
 if(endpoint==='ads-independent-checkout'){
  if(body.action==='purchase')return {source:'ads_independent_checkout_v1_886',
   status:'checkout_ready',amountCents:1990,viewChargesCents:0,
   checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect'};
  if(body.action==='reconcile')return {source:'ads_independent_reconcile_v1_886',
   status:'checkout_ready'};
 }
 throw Error('unmocked '+endpoint+' '+body.action);
};
const context=vm.createContext({
 adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
 adminCurrentRole:()=>role,
 adminFinanceWorkspaceCurrent:()=>runtime.financeWorkspace,
 adminFinanceHomologationEvidenceState:()=>({selected}),
 adminAccessToken:async()=> 'jwt-admin-real-user',
 CHAMA_BACKEND:{url:'https://api.example.test',publishableKey:'public-key'},
 chamaFetch:async(url,opts)=>{
  const body=JSON.parse(opts.body),endpoint=url.split('/').at(-1);
  requests.push({url,endpoint,body,headers:opts.headers});
  const data=await backend(endpoint,body);
  return {ok:true,json:async()=>data};
 },
 confirm:()=>confirm,render:()=>{},setTimeout:()=>1,URL,Date,
 String,Number,Error,Object,Array,Promise,crypto:{randomUUID:()=>campaign},
 document:{getElementById:()=>({checked,value:'https://tamao.com.br/'})},
 adminCopyText:()=>{},toast:()=>{}
});
vm.runInContext(source+';this.native={state:adminFinanceRealState,read:adminFinanceRealRefresh,'+
 'action:adminFinanceRealAction,panel:adminFinanceRealPanel,url:adminFinanceRealPaymentUrl,'+
 'api:adminFinanceRealApi};',context);
assert.match(context.native.panel('coupons'),/Conferir operações existentes/);
assert.equal(requests.length,0,'render must never call real payment service');
await context.native.read();
assert.deepEqual(requests.map(x=>x.body.action),['catalog','my-vouchers']);
assert(requests.every(x=>x.headers.Authorization==='Bearer jwt-admin-real-user'));
assert(requests.every(x=>x.url.startsWith('https://api.example.test/functions/v1/')));
await context.native.action('purchase','all_products_3x5_sponsor');
assert.equal(requests.length,2,'no offer = no actual Pix');
role='finance';
await context.native.read();
assert.equal(requests.length,2,'only superadmin may use this surface');
await assert.rejects(()=>context.native.api('coupon-credit-pix',{action:'purchase'}),/não autorizado/);
role='superadmin';
const pkg={packageKey:'all_products_3x5_sponsor',priceCents:890,
 termsVersion:'clube_coupon_terms_v1_813'};
const state=context.native.state();
state.data={catalog:{packages:[pkg],couponSalesEnabled:true},history:{purchases:[]}};
state.loadedKey='coupons';
await context.native.action('purchase',pkg.packageKey);
assert.equal(requests.length,2,'unchecked terms must block real Pix');
checked=true;
context.document.getElementById=()=>({checked:true});
confirm=false;
await context.native.action('purchase',pkg.packageKey);
assert.equal(requests.length,2,'explicit consent required');
confirm=true;
await context.native.action('purchase',pkg.packageKey);
assert.equal(requests.at(-1).body.action,'purchase');
assert.equal(requests.at(-1).body.termsAccepted,true);
assert.equal(requests.at(-1).body.packageKey,pkg.packageKey);
assert.equal(requests.at(-1).body.requestId,campaign);
assert.equal(requests.at(-1).endpoint,'coupon-credit-pix');
assert.match(context.native.panel('coupons'),/Fatura consultada/);
selected='mobility';
await context.native.read();
assert.equal(requests.at(-1).body.action,'status');
assert(!requests.some(x=>x.body.action==='plan'));
await context.native.action('plan','essential');
assert.equal(requests.at(-1).body.action,'plan');
assert.equal(requests.at(-1).body.planKey,'essential');
assert.equal(requests.at(-1).endpoint,'mobility-fee-pix');
selected='advertising';
await context.native.read();
assert.equal(requests.at(-1).body.action,'mine');
const prior=requests.length;
context.document.getElementById=()=>({checked:false});
await context.native.action('purchase',campaign);
assert.equal(requests.length,prior,'ad checkout requires checked consent');
context.document.getElementById=()=>({checked:true});
await context.native.action('purchase',campaign);
assert.equal(requests.at(-1).endpoint,'ads-independent-checkout');
assert.equal(requests.at(-1).body.requestId,campaign,
 'campaign ID must be a stable idempotency key even after reloading');
assert.equal(requests.at(-1).body.acceptFixedFee,true);
assert.equal(requests.at(-1).body.campaignId,campaign);
assert.equal(context.native.url('https://evil.test/checkout'),'');
assert.equal(context.native.url('http://mercadopago.com.br/'),'');
assert.equal(context.native.url('https://mercadopago.com.br/sandbox/pay'),'');
assert.match(context.native.panel('advertising'),/Abrir pagamento original/);
runtime.session={user:{id:'other-admin'}};
assert.equal(context.native.state().actor,'other-admin');
assert.equal(context.native.state().payment,null,'payment context cannot leak between sessions');
for(const path of [
 'supabase/functions/coupon-credit-pix/index.ts',
 'supabase/functions/mobility-fee-pix/index.ts',
 'supabase/functions/ads-independent/index.ts',
 'supabase/functions/ads-independent-checkout/index.ts'
]){
 const edge=read(path);
 assert.match(edge,/https:\/\/admin\.tamao\.com\.br/,'exact Admin origin in '+path);
 assert.match(edge,/auth\.getUser\(/,'session owner must be verified in '+path);
 assert(!edge.includes('Access-Control-Allow-Origin":"*"'),'never open all origins');
}
const homolog=admin.slice(admin.indexOf('function adminFinanceHomologationView(d){'),
 admin.indexOf('function adminFinanceHomologationToggleLab(){'));
assert.match(homolog,/adminFinanceRealPanel\(chosen\.key\)/);
assert.match(homolog,/Laboratório do gateway \(opcional\)/);
assert(!source.includes("action:'finance-lab-live-pix'"),
 'native operations must not use Pix lab as proof of a real module purchase');
assert.match(read('.github/workflows/audit.yml'),/admin-finance-real-operations-v1-927\.mjs/);
console.log('V1.927 PASS: authenticated, original, explicit buyer/driver/advertiser checkouts; no auto charge or module bypass.');

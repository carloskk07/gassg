import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const a=source.indexOf('function adminFinanceRealState(){'),b=source.indexOf('function adminFinanceHomologationView(d){',a);
const id='b169a647-0740-432e-b92a-590eec5613cf',actor='11000000-0000-4000-8000-000000000001';
const checkout='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=isolated-owned';
async function fixture(){
 let checked=false,ready=true,foreignGate=false,ambiguous=false,changeActor=false,role='superadmin';
 const clock={now:Date.now()},timers=[];
 class Clock extends Date{static now(){return clock.now}}
 let returnedCheckout=checkout;
 const calls=[],campaign={id,advertiser:'TAMÃO',title:'Conheça o TAMÃO em São Gabriel',
  description:'Conheça a plataforma e acompanhe as novidades de comércio e serviços locais.',
  destination:'https://tamao.com.br/',status:'submitted',version:1,budgetCents:1990,durationDays:7};
 let gate=null,gateVersion=1,fixed=null;
 const runtime={status:'ready',section:'finance',session:{user:{id:actor}},actionPending:false};
 const mine=()=>({source:'ads_independent_mine_v1_884',noCharge:true,fixedFeeSalesEnabled:false,
  homologationCampaignId:gate,homologationExpiresAt:gate?new Date(Date.now()+3600000).toISOString():null,
  rows:[{...campaign,fixedFeeStatus:fixed,fixedFeeCheckoutUrl:fixed==='checkout_ready'?returnedCheckout:null}]});
 const context=vm.createContext({adminRuntime:runtime,adminReady:()=>true,adminCurrentRole:()=>role,
  adminFinanceWorkspaceCurrent:()=> 'homologation',adminFinanceHomologationEvidenceState:()=>({selected:'advertising'}),
  adminAccessToken:async()=> 'isolated-verified-user',CHAMA_BACKEND:{url:'https://isolated.invalid',publishableKey:'isolated-public'},
  adminInvoke:async body=>{
   calls.push(body.action);
   if(body.action==='ads-independent-read'){
    assert.equal(body.ownedOnly,true);
    return {source:'admin_ads_independent_read_v1_884',readOnly:true,ownedOnly:true,rows:[{...campaign}]};
   }
   assert.equal(body.action,'ads-independent-psp-preflight');
   return {source:'ads_independent_psp_preflight_v1_890',readOnly:true,paymentsCreated:0,
    readyForFinancialHomologation:ready,salesVersion:gateVersion};
  },
  adminPerform:async(action,body)=>{
   calls.push(action);assert.equal(body.campaignId,id);assert.equal(checked,true);
   if(action==='ads-independent-action'){
    assert.equal(body.decision,'approve');assert.equal(body.expectedVersion,campaign.version);
    campaign.status='approved';campaign.version++;
    if(changeActor)runtime.session.user.id='22000000-0000-4000-8000-000000000002';
    return {source:'admin_ads_independent_action_v1_884',campaignId:id,status:'approved',billingEnabled:false,paymentCreated:false};
   }
   assert.equal(action,'ads-independent-homologation-action');assert.equal(body.enabled,true);
   assert.equal(body.expectedVersion,gateVersion);assert.equal(body.confirmation,'HOMOLOGAR');
   gate=foreignGate?'33000000-0000-4000-8000-000000000003':id;gateVersion++;
   return {source:'admin_ads_independent_homologation_v1_892',homologationAuthorized:true,salesEnabled:false,billingEnabled:false,newChargesCreated:false};
  },
  chamaFetch:async(url,opts)=>{
   const body=JSON.parse(opts.body);assert.equal(opts.headers.Authorization,'Bearer isolated-verified-user');
   if(url.endsWith('/ads-independent')){assert.equal(body.action,'mine');calls.push('mine');return {ok:true,json:async()=>mine()};}
   assert(url.endsWith('/ads-independent-checkout'));calls.push('checkout');
   assert.equal(body.action,'purchase');assert.equal(body.requestId,id);assert.equal(body.campaignId,id);
   assert.equal(body.acceptFixedFee,true);assert.equal(gate,id);assert.equal(campaign.status,'approved');
   fixed='checkout_ready';
   if(ambiguous){ambiguous=false;throw Error('lost response after original checkout');}
   return {ok:true,json:async()=>({source:'ads_independent_checkout_v1_886',status:'checkout_ready',checkoutUrl:checkout,amountCents:1990,viewChargesCents:0})};
  },
  document:{getElementById:key=>key==='admin-finance-real-ads-consent-'+id?{checked}:null,visibilityState:'visible'},
  render:()=>{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout:()=>{},URL,Date:Clock,Number,String,Object,Array,Promise,Error,Set,
  esc:x=>String(x),toast:()=>{},crypto:{randomUUID:()=>id}});
 vm.runInContext(source.slice(a,b)+';this.flow={state:adminFinanceRealState,read:adminFinanceRealRefresh,action:adminFinanceRealAction,panel:adminFinanceRealPanel};',context);
 await context.flow.read();calls.length=0;
 return {flow:context.flow,calls,campaign,runtime,check:()=>checked=true,notReady:()=>ready=false,
  foreignGate:()=>foreignGate=true,ambiguous:()=>ambiguous=true,changeActor:()=>changeActor=true,
  readonly:()=>role='readonly',paid:()=>fixed='payment_approved',unsafeLink:()=>returnedCheckout='https://evil.invalid/pay',
  expirePreview:async()=>{clock.now+=45001;const task=timers.find(t=>t.ms===45000);assert(task);await task.fn()}};
}
{
 const t=await fixture();assert.match(t.flow.panel('advertising'),/Aprovar e gerar cobrança de R\$ 19,90/);
 assert.match(t.flow.panel('advertising'),/Conheça o TAMÃO/);
 assert.equal(await t.flow.action('purchase',id),false);assert.equal(t.calls.length,0);
 assert.match(t.flow.state().error,/Marque a confirmação/);
 t.check();await Promise.all([t.flow.action('purchase',id),t.flow.action('purchase',id)]);
 assert.equal(t.calls.filter(x=>x==='checkout').length,1,'double click prepares a single original checkout');
 assert.equal(t.calls.filter(x=>x==='ads-independent-action').length,1);
 assert.equal(t.calls.filter(x=>x==='ads-independent-homologation-action').length,1);
 assert.equal(t.flow.state().payment.url,checkout);
 await t.flow.action('purchase',id);
 assert.equal(t.calls.filter(x=>x==='checkout').length,1,'ready checkout is recovered, never recreated');
 const panel=t.flow.panel('advertising');
 assert.match(panel,/<a class="primary" href="https:\/\/www\.mercadopago\.com\.br\/checkout\/v1\/redirect\?pref_id=isolated-owned" target="_blank" rel="noopener noreferrer">Pagar R\$ 19,90 no Mercado Pago<\/a>/);
 assert.doesNotMatch(panel,/45 segundos|Ver cobrança original/);
 const count=t.calls.length;
 await t.expirePreview();
 assert.equal(t.flow.state().payment,null,'the short Pix preview expires normally');
 assert.match(t.flow.panel('advertising'),/Pagar R\$ 19,90 no Mercado Pago/,
  'the native payment link must remain visible after the 45-second preview timer');
 assert.equal(t.calls.length,count,'rendering the existing payment link does not issue a checkout');
 await t.flow.read();
 assert.match(t.flow.panel('advertising'),/Pagar R\$ 19,90 no Mercado Pago/,'reload restores the same native payment link');
 assert.equal(t.calls.filter(x=>x==='checkout').length,1);
 t.paid();await t.flow.read();
 assert.match(t.flow.panel('advertising'),/Pagamento de publicidade confirmado/);
 assert.doesNotMatch(t.flow.panel('advertising'),/href="https:\/\/www\.mercadopago|Pagar R\$/,
  'a confirmed payment must remove the payment action');
}
{
 const t=await fixture();t.check();await t.flow.action('purchase',id);
 t.unsafeLink();await t.flow.read();
 assert.doesNotMatch(t.flow.panel('advertising'),/href="https:\/\/evil/);
 assert.match(t.flow.panel('advertising'),/Consultar cobrança original/);
 t.readonly();assert.doesNotMatch(t.flow.panel('advertising'),/Pagar R\$|Consultar cobrança original/);
 t.runtime.session.user.id='new-owner';
 assert.doesNotMatch(t.flow.panel('advertising'),/Conheça o TAMÃO|href="https:\/\/www\.mercadopago/);
}
for(const failure of ['notReady','foreignGate','changeActor','readonly']){
 const t=await fixture();t.check();t[failure]();await t.flow.action('purchase',id);
 assert.equal(t.calls.filter(x=>x==='checkout').length,0,failure+' cannot create a checkout');
}
{
 const t=await fixture();t.check();t.campaign.description+=' conteúdo alterado';
 await t.flow.action('purchase',id);
 assert.equal(t.calls.filter(x=>x==='ads-independent-action').length,0,'altered creative requires a new review');
 assert.match(t.flow.state().error,/alterado/);
}
{
 const t=await fixture();t.check();t.ambiguous();await t.flow.action('purchase',id);
 assert.match(t.flow.state().error,/lost response/);
 await t.flow.action('purchase',id);
 assert.equal(t.calls.filter(x=>x==='checkout').length,1,'lost POST response reuses persisted original checkout');
 assert.equal(t.flow.state().payment.url,checkout);
}
const edge=fs.readFileSync(new URL('../supabase/functions/admin-ops/index.ts',import.meta.url),'utf8');
const start=edge.indexOf('      if(body.ownedOnly===true){');
const end=edge.indexOf('      return json({...data,',start);
let scoped=false;
const db={from:table=>{assert.equal(table,'ads_independent_campaigns_v1_884');return {
 select(){return this},eq(k,v){assert.equal(k,'owner_user_id');assert.equal(v,actor);scoped=true;return this},
 order(){return this},limit(n){assert.equal(n,30);return Promise.resolve({data:[],error:null})}
}}};
const ctx=vm.createContext({body:{ownedOnly:true,ownerId:'foreign'},admin:db,user:{id:actor},data:{rows:['unrelated']},
 DomainError:class extends Error{},Array});
vm.runInContext('(async()=>{'+edge.slice(start,end).replaceAll('(row:any)=>','(row)=>')+'})()',ctx);
await new Promise(resolve=>setImmediate(resolve));assert.equal(scoped,true);assert.equal(ctx.data.rows.length,0);
console.log('PASS: submitted ad becomes one approved, narrowly authorized checkout from Finance; explicit consent, owner scope, current creative, no duplicate/foreign/stale-session payment and visible failure.');

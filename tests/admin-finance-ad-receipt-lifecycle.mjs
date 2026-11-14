import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {evaluateFinanceHomologationEvidence} from '../supabase/functions/admin-ops/finance-homologation-evidence.js';
const source=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const start=source.indexOf('function adminFinanceRealState(){');
const end=source.indexOf('function adminFinanceHomologationView(d){',start);
const navStart=source.indexOf('function adminFinanceHomologationOpenAds(pane){');
const navEnd=source.indexOf('function adminOpenFinanceHomologation(){',navStart);
assert(start>0&&end>start&&navStart>0&&navEnd>navStart);
const now=Date.now(),id='22000000-0000-4000-8000-000000000002';
async function fixture({status='active',delivery=true,endsAt=now+86400000,startsAt=now-60000}={}){
 let role='superadmin';const calls=[];
 const runtime={status:'ready',section:'finance',session:{user:{id:'11000000-0000-4000-8000-000000000001'}}};
 const row={id,title:'Campanha <revisada>',advertiser:'TAMÃO',description:'Anúncio legítimo revisado pelo titular.',
  destination:'https://example.invalid/',budgetCents:1990,durationDays:7,version:3,status,
  fixedFeeStatus:'payment_approved',runStartedAt:new Date(startsAt).toISOString(),
  runEndsAt:Number.isFinite(endsAt)?new Date(endsAt).toISOString():'invalid'};
 const context=vm.createContext({adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
  adminCurrentRole:()=>role,adminRoleCanSection:()=>true,adminFinanceWorkspaceCurrent:()=> 'homologation',
  adminFinanceHomologationEvidenceState:()=>({selected:'advertising'}),adminAccessToken:async()=> 'isolated-owner',
  CHAMA_BACKEND:{url:'https://isolated.invalid',publishableKey:'isolated-public'},
  adminInvoke:async body=>{assert.equal(body.action,'ads-independent-read');assert.equal(body.ownedOnly,true);
   calls.push('owned-admin-read');return {source:'admin_ads_independent_read_v1_884',readOnly:true,ownedOnly:true,
    deliveryEnabled:delivery,rows:[{...row}]};},
  chamaFetch:async(url,opts)=>{const body=JSON.parse(opts.body);assert.equal(body.action,'mine');
   assert(url.endsWith('/ads-independent'));calls.push('owned-receipt-read');
   return {ok:true,json:async()=>({source:'ads_independent_mine_v1_884',noCharge:true,rows:[{...row}]})};},
  adminPerform:()=>assert.fail('receipt or navigation cannot mutate a campaign or charge'),
  adminAdsWorkspaceTab:'campaigns',adminIndependentAdsPane:'campaigns',
  adminSetSection:section=>{runtime.section=section;calls.push('navigate:'+section)},
  adminIndependentAdsRefresh:async()=>{calls.push('campaign-read')},
  render:()=>{},toast:()=>{},setTimeout:()=>1,clearTimeout:()=>{},Date,URL,Set,Number,String,Array,Object,Promise,Error,
  document:{visibilityState:'visible',getElementById:()=>null},
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
 vm.runInContext(source.slice(start,end)+source.slice(navStart,navEnd)+
  ';this.test={state:adminFinanceRealState,read:adminFinanceRealRefresh,panel:adminFinanceRealPanel,open:adminFinanceHomologationOpenAds};',context);
 await context.test.read();return {flow:context.test,context,runtime,calls,readonly:()=>role='readonly'};
}
{
 const f=await fixture(),html=f.flow.panel('advertising');
 assert.match(html,/Anúncio ativo/,'paid and published campaign cannot still await commercial release');
 assert.match(html,/Válido até|Ativo até/);assert.match(html,/Acompanhar campanha/);
 assert.match(html,/<details><summary>Criar outra campanha<\/summary>/,
  'a paid campaign must not be presented as a missing new purchase');
 assert.match(html,/Campanha &lt;revisada>/);assert.doesNotMatch(html,/Campanha <revisada>/);
 assert.doesNotMatch(html,/Aguarda a liberação comercial|Gerar Pix|Aprovar e gerar cobrança/);
 assert.equal(f.flow.state().payment,null);assert.deepEqual(f.calls,['owned-receipt-read','owned-admin-read']);
 assert.equal(f.flow.open('campaigns'),true);assert.equal(f.context.adminIndependentAdsPane,'campaigns');
 assert.equal(f.runtime.section,'ads');assert(f.calls.includes('campaign-read'));
}
for(const delivery of [false,true]){
 const f=await fixture({status:'approved',delivery}),html=f.flow.panel('advertising');
 assert.match(html,/Pagamento de publicidade confirmado/);
 assert.match(html,/Aguardando início da publicação/);
 assert.match(html,delivery?/Iniciar publicação/:/Habilitar exibição/);
 assert(html.includes("adminFinanceHomologationOpenAds('"+(delivery?'campaigns':'finance')+"')"));
 assert.doesNotMatch(html,/Gerar Pix|Aprovar e gerar cobrança/);
}
{
 const f=await fixture({delivery:false}),html=f.flow.panel('advertising');
 assert.match(html,/Exibição pausada/);assert.match(html,/Habilitar exibição/);
 assert.doesNotMatch(html,/Anúncio ativo/,'global delivery disabled must not claim an active public placement');
}
for(const data of [{status:'ended'},{endsAt:now-1},{endsAt:NaN},{status:'paused'}]){
 const f=await fixture(data),html=f.flow.panel('advertising');
 assert.doesNotMatch(html,/Anúncio ativo/);assert.doesNotMatch(html,/Gerar Pix|Aprovar e gerar cobrança/);
 assert.match(html,/Pagamento de publicidade confirmado/);
}
{
 const f=await fixture();f.runtime.session.user.id='another-owner';
 assert.doesNotMatch(f.flow.panel('advertising'),/Campanha &lt;revisada>|Anúncio ativo/);
 f.readonly();assert.equal(f.flow.open('campaigns'),false);
 assert.equal(f.flow.open('finance'),false);
}
const keys=['coupons','mobility','merchants','orders','advertising','benefits','professional_ads'];
const modules=keys.map(key=>({key,counts:{issuances:0,events:0,appliedCredits:0}}));
const signals={couponPaid:0,couponNetVerified:0,mobilityPaid:0,merchantCompleted:0,orderApproved:0,
 adsApproved:1,adsPaymentApproved:1,referralBankEvidence:0,professionalBilledDays:0};
const paid=evaluateFinanceHomologationEvidence(modules,signals,[])[4].diagnosis;
assert.match(paid.progressLabel,/Pagamento de publicidade confirmado/);
assert.match(paid.nextAction,/campanha já paga/);
assert.doesNotMatch(paid.nextAction,/Testar checkout/);
assert.equal(paid.financiallyHomologated,false);assert.equal(paid.bankSettlementChecked,false);
const review=evaluateFinanceHomologationEvidence(modules,{...signals,adsPaymentApproved:0},[])[4].diagnosis;
assert.equal(review.state,'needs_review');assert.doesNotMatch(review.progressLabel,/Pagamento de publicidade confirmado/);
console.log('PASS: owned paid Ads receipt reflects publication, delivery pause and expiry; clear next step, read-only navigation, no new payment or false homologation.');

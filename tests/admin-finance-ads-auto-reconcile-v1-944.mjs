import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const file=read('js/admin.js');
new vm.Script(file);
const begin=file.indexOf('function adminFinanceRealState(){');
const end=file.indexOf('function adminFinanceHomologationView(d){',begin);
assert.ok(begin>0&&end>begin);
const id='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const link='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=live-original';
const runtime={session:{user:{id:owner}},section:'finance',
 financeWorkspace:'homologation',status:'ready'};
let selected='advertising',live='checkout_ready',backendApproval=false;
let transientFailures=0,malformedResponses=0;
let requests=[],tasks=[],nextId=0;
const row=()=>({id,title:'Campanha São Gabriel',status:'approved',
 fixedFeeStatus:live,fixedFeeCheckoutUrl:live==='checkout_ready'?link:null});
const mine=()=>({source:'ads_independent_mine_v1_884',noCharge:true,
 rows:[row()],homologationCampaignId:id,fixedFeeSalesEnabled:true});
const context=vm.createContext({
 adminRuntime:runtime,adminReady:()=>runtime.status==='ready',
 adminCurrentRole:()=> 'superadmin',
 adminFinanceWorkspaceCurrent:()=>runtime.financeWorkspace,
 adminFinanceHomologationEvidenceState:()=>({selected}),
 adminAccessToken:async()=> 'test-jwt',
 CHAMA_BACKEND:{url:'https://api.test.invalid',publishableKey:'test-pub'},
 chamaFetch:async(url,opts)=>{
  const body=JSON.parse(opts.body),path=url.split('/').at(-1);
  requests.push({path,body});
  let value;
  if(path==='ads-independent'&&body.action==='mine')value=mine();
  else if(path==='ads-independent-checkout'&&body.action==='reconcile'){
   assert.equal(body.campaignId,id);
   if(transientFailures>0){
    transientFailures--;
    throw Error('Temporary upstream network outage');
   }
   value=malformedResponses>0?(malformedResponses--,{source:'UNTRUSTED_RESPONSE'}):backendApproval?
    {source:'ads_independent_reconcile_v1_886',status:'payment_approved',
     paymentApproved:true,autoPublished:false,netSettlementVerified:false}:
    {source:'ads_independent_reconcile_v1_886',status:'checkout_ready',
     paymentApproved:false,autoPublished:false,netSettlementVerified:false};
  }else throw Error('Unexpected charge / operation '+path+' '+body.action);
  return {ok:true,json:async()=>value};
 },
 document:{visibilityState:'visible',getElementById:()=>({checked:false})},
 render:()=>{},adminFinanceLabLoadQrEncoder:async()=>false,
 adminFinanceLabLiveQrBlock:()=>'',formatDateTime:()=> '11/11/2026',
 adminCopyText:()=>{},toast:()=>{},esc:x=>String(x),
 confirm:()=>false,Date,URL,String,Number,Array,Object,Promise,Math,
 setTimeout:(fn,ms)=>{const item={id:++nextId,fn,ms};tasks.push(item);return item.id},
 clearTimeout:id=>{tasks=tasks.filter(t=>t.id!==id)}
});
vm.runInContext(file.slice(begin,end)+
 ';this.test={state:adminFinanceRealState,read:adminFinanceRealRefresh,'+
 'action:adminFinanceRealAction,panel:adminFinanceRealPanel,'+
 'stop:adminFinanceRealAdsStopWatch,watch:adminFinanceRealAdsWatch};',context);
const x=context.test;
await x.read();
assert.equal(requests.length,1,'only owner mine read, never create new preference');
assert.equal(requests[0].body.action,'mine');
assert.equal(x.state().payment.url,link,'reload restores the original payment link');
assert.equal(x.state().adsWatch.campaignId,id);
assert.match(x.panel('advertising'),/Checkout existente/);
assert.doesNotMatch(x.panel('advertising'),/Gerar checkout real R\$ 19,90/);
const count=requests.length;
await x.action('purchase',id);
assert.equal(requests.length,count,'never generate second ad checkout when original exists');
const first=tasks.find(t=>t.ms===45000&&x.state().adsWatch?.timer===t.id);
assert.ok(first,'must automatically check original payment soon');
await first.fn();
assert.equal(requests.at(-1).body.action,'reconcile');
assert.equal(requests.filter(r=>r.body.action==='purchase').length,0);
const follow=tasks.find(t=>t.ms===180000&&x.state().adsWatch?.timer===t.id);
assert.ok(follow,'pending result schedules bounded provider follow-up');
backendApproval=true;live='payment_approved';
await follow.fn();
assert.deepEqual(requests.slice(-2).map(r=>r.body.action),['reconcile','mine'],
 'provider success must be independently read back from customer-owned ledger');
assert.equal(x.state().adsWatch,null,'approved payment stops the watcher');
assert.equal(x.state().payment,null,'approved Ads payment hides old checkout link');
assert.match(x.panel('advertising'),/Pagamento de publicidade confirmado/);
assert.match(x.state().message,/liquidação bancária continua separada/);
assert(!requests.some(r=>r.body.action==='purchase'),'watcher must never create a charge');
const after=requests.length;
await x.action('purchase',id);
assert.equal(requests.length,after,'paid checkout cannot be regenerated');

// V1.957: one failed network read cannot strand the existing campaign.
// The same checkout is checked again, never a new purchase or preference.
live='checkout_ready';backendApproval=false;await x.read();
const pendingRetry=tasks.find(t=>t.ms===45000&&x.state().adsWatch?.timer===t.id);
assert.ok(pendingRetry,'already issued checkout is watched once');
transientFailures=1;
const chargedBeforeRetry=requests.filter(r=>r.body.action==='purchase').length;
await pendingRetry.fn();
assert.equal(x.state().adsWatch?.campaignId,id,'network failure keeps bounded original watch');
assert.match(x.state().message,/mesma campanha/);
const retryTimer=tasks.find(t=>t.ms===180000&&x.state().adsWatch?.timer===t.id);
assert.ok(retryTimer,'transient outage schedules another GET to same campaign');
backendApproval=true;live='payment_approved';
await retryTimer.fn();
assert.equal(x.state().adsWatch,null,'terminal verified approval ends retry');
assert.equal(x.state().payment,null,'old link is hidden after verified approval');
assert.equal(requests.filter(r=>r.body.action==='purchase').length,chargedBeforeRetry,
 'retries must never create a second payment');
console.log('V1.957 PASS — transient Ads provider read retries the existing checkout only.');

// A malformed provider/readback response is not temporary evidence. Stop,
// keep the existing charge, and require an explicit authenticated recheck.
live='checkout_ready';backendApproval=false;await x.read();
const malformedTimer=tasks.find(t=>t.ms===45000&&x.state().adsWatch?.timer===t.id);
assert.ok(malformedTimer);
malformedResponses=1;
const beforeMalformed=requests.filter(r=>r.body.action==='purchase').length;
await malformedTimer.fn();
assert.equal(x.state().adsWatch,null,'malformed provider receipt must fail closed');
assert.match(x.state().message,/não confirmou a conferência/);
assert.equal(requests.filter(r=>r.body.action==='purchase').length,beforeMalformed,
 'malformed finance readback never creates another charge');

// A provider preference may remain in 'reserved' after an interrupted handoff.
live='reserved';backendApproval=false;await x.read();
assert.match(x.panel('advertising'),/Retomar checkout existente/);
assert.equal(x.state().adsWatch,null,
 'reserved preference has no payable link and should not start PSP polling');
live='checkout_ready';backendApproval=false;await x.read();
const next=tasks.find(t=>t.ms===45000&&x.state().adsWatch?.timer===t.id);
assert.ok(next);
runtime.session={user:{id:'different-owner'}};
await next.fn();
assert.equal(requests.at(-1).body.action,'mine','session change stops provider calls');
assert.equal(x.state().payment,null,'new session must never inherit payment');
console.log('V1.944 PASS: Ads original checkout recovered, automatic PSP fact + ledger readback, no duplicate charge or cross-session leak.');

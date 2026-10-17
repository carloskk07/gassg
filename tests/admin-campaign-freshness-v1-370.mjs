import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin-acquisition.js');
const css=read('css/components.css');
new vm.Script(src,{filename:'admin-acquisition.js'});
const a=src.indexOf('// V1.369 — read-only, by the same immutable allocation ID');
const b=src.indexOf('\nfunction adminOwnerCampaignSignalsSection(){',a);
assert.ok(a>0&&b>a);
const cut=src.slice(a,b);
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tag='tam-customer_referral-202610-source_01';
const month='2026-10-01';
const signal={allocationId:id,campaignTag:tag,campaignLabel:'Convite local',
  landingViews:100,formViews:60,leads:20,qualifiedLeads:6,crmConvertedLeads:3};
const order={allocationId:id,campaignTag:tag,createdOrders:5,settledOrders:3,
  reversedOrders:1,settledMerchantOrderValueCents:21000,
  platformReceivedRevenueCents:null,financialReturnMeasured:false};
const fee={allocationId:id,campaignTag:tag,attributedOrders:5,
  providerConfirmedOrders:2,providerConfirmedFeeCents:890,
  marketingSpendPaidCents:null,bankSettlementVerified:false,roiMeasured:false};
const sourceRows={a:{loadedFor:'owner',source:'admin_owner_campaign_signals_v1_251',month,
  readOnly:true,truncated:false,totalCampaigns:1,rows:[signal]},
 o:{loadedFor:'owner',source:'admin_owner_campaign_orders_v1_252',month,readOnly:true,
  truncated:false,totalCampaigns:1,metricMeaning:'first_party_checkout_utm_non_causal_attribution',
  financialReturnMeasured:false,rows:[order]},
 f:{loadedFor:'owner',source:'admin_owner_campaign_fee_receipts_v1_253',month,
  readOnly:true,truncated:false,totalCampaigns:1,
  evidenceLevel:'provider_event_applied_single_order_statement_no_refund',
  bankSettlementVerified:false,roiMeasured:false,rows:[fee]}
};
let currentMonth='2026-10',role='superadmin',actor='owner',calls=[],alerts=[];
let now=Date.now();
class NowDate extends Date{constructor(...args){super(...(args.length?args:[now]))} static now(){return now}}
const env=vm.createContext({
 Date:NowDate,Number,String,Array,Map,Set,
 adminRuntime:{session:{user:{id:actor}}},
 adminCurrentRole:()=>role,
 document:{getElementById:()=>({value:currentMonth})},
 adminOwnerCampaignSignalsState:null,adminOwnerCampaignOrdersState:null,
 adminOwnerCampaignFeeReceiptsState:null,
 adminOwnerCampaignSignalsBusy:false,adminOwnerCampaignOrdersBusy:false,
 adminOwnerCampaignFeeReceiptsBusy:false,
 adminMoney:c=>'R$ '+(c/100).toFixed(2),
 esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),
 toast:s=>{alerts.push(String(s))},render:()=>{}
});
env.adminOwnerCampaignSignalsLoadFromUi=async()=>{calls.push('a');env.adminOwnerCampaignSignalsState=structuredClone(sourceRows.a)};
env.adminOwnerCampaignOrdersLoadFromUi=async()=>{calls.push('o');env.adminOwnerCampaignOrdersState=structuredClone(sourceRows.o)};
env.adminOwnerCampaignFeeReceiptsLoadFromUi=async()=>{calls.push('f');env.adminOwnerCampaignFeeReceiptsState=structuredClone(sourceRows.f)};
vm.runInContext(cut+'\nthis.bundle=adminOwnerCampaignEvidenceBundle;this.refresh=adminOwnerCampaignEvidenceRefreshFromUi;this.next=adminOwnerCampaignNextEvidence;this.view=adminOwnerCampaignEvidenceSection;',env);
assert.equal(await env.refresh(),true);
assert.equal(env.bundle().rows.length,1);
assert.deepEqual(calls,['a','o','f']);
let html=env.view();
assert.match(html,/Próxima verificação recomendada/);
assert.match(html,/extrato e os custos reais/);
assert.doesNotMatch(html,/ROI: [0-9]|resultado garantido/i);

now+=120001;
assert.equal(env.bundle(),null,'combined proof must expire after two minutes');
assert.match(env.view(),/Sem evidências combinadas e recentes/);
assert.doesNotMatch(env.view(),/Taxas confirmadas pelo PSP/);
now+=1;
assert.equal(await env.refresh(),true,'explicit refresh should regenerate the snapshot');
assert.equal(env.bundle().rows.length,1);
now-=600000;
assert.equal(env.bundle(),null,'future-dated snapshots must be rejected');
now+=600000;

calls=[];
env.adminOwnerCampaignOrdersBusy=true;
assert.equal(await env.refresh(),false);
assert.deepEqual(calls,[]);
assert.match(alerts.at(-1),/Outra consulta está em andamento/);
env.adminOwnerCampaignOrdersBusy=false;
assert.equal(env.bundle().rows.length,1,'busy veto must not mutate the last accepted snapshot');

calls=[];
currentMonth='2026-09';
assert.equal(env.bundle(),null,'month selection must hide old proofs');
currentMonth='2026-10';
assert.equal(env.bundle().rows.length,1);
role='operations';assert.equal(env.bundle(),null);assert.equal(env.view(),'');
role='superadmin';
env.adminRuntime.session.user.id='other';assert.equal(env.bundle(),null);
env.adminRuntime.session.user.id='owner';

assert.match(env.next({signal:{landingViews:0,formViews:0,leads:0},order:{createdOrders:0},fee:{providerConfirmedOrders:0}}),/divulgação do link/);
assert.match(env.next({signal:{landingViews:5,formViews:3,leads:0},order:{createdOrders:0},fee:{providerConfirmedOrders:0}}),/fluxo público/);
assert.match(env.next({signal:{landingViews:5,formViews:3,leads:4,qualifiedLeads:0},order:{createdOrders:0},fee:{providerConfirmedOrders:0}}),/Revise a fila/);
assert.match(env.next({signal:{landingViews:5,formViews:3,leads:4,qualifiedLeads:2},order:{createdOrders:0},fee:{providerConfirmedOrders:0}}),/identificação UTM/);
assert.match(env.next({signal:{landingViews:5,formViews:3,leads:4,qualifiedLeads:2},order:{createdOrders:3},fee:{providerConfirmedOrders:0}}),/conciliação por pedido/);
assert.match(env.next({signal:{landingViews:5,formViews:3,leads:4,qualifiedLeads:2},order:{createdOrders:3},fee:{providerConfirmedOrders:1}}),/extrato e os custos reais/);

// If any one RPC fails while refreshing, prior proof must not be reused.
await env.refresh();
env.adminOwnerCampaignFeeReceiptsLoadFromUi=async()=>{calls.push('f-failed');env.adminOwnerCampaignFeeReceiptsState=null};
assert.equal(await env.refresh(),false);
assert.equal(env.bundle(),null);
assert.match(alerts.at(-1),/fontes da campanha não coincidem/);
for(const marker of ['.admin-campaign-next-check','@media(max-width:640px)'])
 assert.ok(css.includes(marker));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-campaign-freshness-v1-370.mjs'));
console.log('V1.370 PASS — time-limited proof, refresh isolation, truthful next-step guidance and mobile admin UI.');

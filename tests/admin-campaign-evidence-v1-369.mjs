import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/admin-acquisition.js'),css=read('css/components.css');
new vm.Script(ui,{filename:'admin-acquisition.js'});
const a=ui.indexOf('// V1.369 — read-only, by the same immutable allocation ID');
const b=ui.indexOf('\nfunction adminOwnerCampaignSignalsSection(){',a);
assert.ok(a>=0&&b>a);
const tag='tam-customer_cashback-202610-fundador_01';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const base={
 signals:{loadedFor:'owner',source:'admin_owner_campaign_signals_v1_251',
  readOnly:true,truncated:false,month:'2026-10-01',totalCampaigns:1,rows:[
   {allocationId:id,campaignTag:tag,campaignLabel:'Divulgação da cidade',
    landingViews:240,formViews:170,leads:35,qualifiedLeads:12,crmConvertedLeads:5}]},
 orders:{loadedFor:'owner',source:'admin_owner_campaign_orders_v1_252',
  readOnly:true,truncated:false,month:'2026-10-01',totalCampaigns:1,
  metricMeaning:'first_party_checkout_utm_non_causal_attribution',
  financialReturnMeasured:false,rows:[
   {allocationId:id,campaignTag:tag,createdOrders:8,settledOrders:5,
    reversedOrders:1,settledMerchantOrderValueCents:53200,
    platformReceivedRevenueCents:null,financialReturnMeasured:false}]},
 fees:{loadedFor:'owner',source:'admin_owner_campaign_fee_receipts_v1_253',
  readOnly:true,truncated:false,month:'2026-10-01',totalCampaigns:1,
  evidenceLevel:'provider_event_applied_single_order_statement_no_refund',
  bankSettlementVerified:false,roiMeasured:false,rows:[
   {allocationId:id,campaignTag:tag,attributedOrders:8,
    providerConfirmedOrders:2,providerConfirmedFeeCents:2800,
    bankSettlementVerified:false,roiMeasured:false,marketingSpendPaidCents:null}]}
};
const deep=v=>structuredClone(v);
let role='superadmin',month='2026-10',rendered=0,notice='';
const env=vm.createContext({
 adminRuntime:{session:{user:{id:'owner'}}},adminCurrentRole:()=>role,
 adminOwnerCampaignSignalsBusy:false,adminOwnerCampaignOrdersBusy:false,
 adminOwnerCampaignFeeReceiptsBusy:false,
 adminOwnerCampaignSignalsState:deep(base.signals),
 adminOwnerCampaignOrdersState:deep(base.orders),
 adminOwnerCampaignFeeReceiptsState:deep(base.fees),
 adminOwnerCampaignSignalsLoadFromUi:async()=>{},
 adminOwnerCampaignOrdersLoadFromUi:async()=>{},
 adminOwnerCampaignFeeReceiptsLoadFromUi:async()=>{},
 document:{getElementById:id=>id==='owner-campaign-signals-month'?{value:month}:null},
 Date,Number,String,Array,Set,Map,
 esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
 adminMoney:n=>'R$ '+(Number(n)/100).toFixed(2).replace('.',','),
 toast:t=>{notice=String(t)},render:()=>{rendered++}
});
vm.runInContext(ui.slice(a,b)+'\nthis.bundle=adminOwnerCampaignEvidenceBundle;this.section=adminOwnerCampaignEvidenceSection;this.refresh=adminOwnerCampaignEvidenceRefreshFromUi;',env);
const restore=()=>{
 env.adminOwnerCampaignSignalsState=deep(base.signals);
 env.adminOwnerCampaignOrdersState=deep(base.orders);
 env.adminOwnerCampaignFeeReceiptsState=deep(base.fees);
 role='superadmin';month='2026-10';
 vm.runInContext("adminOwnerCampaignEvidenceSnapshot={actor:'owner',role:'superadmin',month:'2026-10-01',checkedAt:new Date().toISOString(),signals:adminOwnerCampaignSignalsState,orders:adminOwnerCampaignOrdersState,fees:adminOwnerCampaignFeeReceiptsState}",env);
};
restore();
assert.equal(env.bundle().rows.length,1);
let html=env.section();
for(const token of [
 'Da divulgação ao pedido, com provas distintas',
 '1. Interesse registrado','2. Pedidos com UTM','3. Taxas com prova individual',
 '240','170','35','12','8','5','R$ 532,00','R$ 28,00',
 'evento de PSP','não comprova crédito em conta bancária','não é receita TAMÃO',
 'retorno sobre investimento não são inferidos'
])assert.ok(html.includes(token),'missing proof '+token);
assert.doesNotMatch(html,/R\$ 560,00|ROI: [0-9]|taxa de conversão comprovada/i);
assert.ok(html.includes('Conferir resultados comprováveis'));
for(const [label,mutate] of [
 ['different actor',()=>{env.adminOwnerCampaignOrdersState.loadedFor='other'}],
 ['different month',()=>{env.adminOwnerCampaignFeeReceiptsState.month='2026-09-01'}],
 ['different selection',()=>{month='2026-09'}],
 ['different allocation',()=>{env.adminOwnerCampaignOrdersState.rows[0].allocationId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'}],
 ['different tag',()=>{env.adminOwnerCampaignFeeReceiptsState.rows[0].campaignTag='tam-other-202610-different'}],
 ['missing order',()=>{env.adminOwnerCampaignOrdersState.rows=[]}],
 ['missing fee data',()=>{env.adminOwnerCampaignFeeReceiptsState=null}],
 ['truncated source',()=>{env.adminOwnerCampaignSignalsState.truncated=true}],
 ['mismatched orders',()=>{env.adminOwnerCampaignFeeReceiptsState.rows[0].attributedOrders=9}],
 ['negative count',()=>{env.adminOwnerCampaignOrdersState.rows[0].settledOrders=-1}],
 ['impossible settlement',()=>{env.adminOwnerCampaignOrdersState.rows[0].settledOrders=9}],
 ['fake bank proof',()=>{env.adminOwnerCampaignFeeReceiptsState.rows[0].bankSettlementVerified=true}],
 ['fake platform revenue',()=>{env.adminOwnerCampaignOrdersState.rows[0].platformReceivedRevenueCents=2000}],
 ['fee without orders',()=>{env.adminOwnerCampaignFeeReceiptsState.rows[0].providerConfirmedOrders=0}],
 ['stale snapshot',()=>{env.adminOwnerCampaignSignalsState={...env.adminOwnerCampaignSignalsState}}]
]){
 restore();mutate();
 assert.equal(env.bundle(),null,label);
 assert.doesNotMatch(env.section(),/1\. Interesse registrado/,label);
}
restore();
env.adminOwnerCampaignSignalsState.rows[0].campaignLabel='<img src=x onerror=alert(1)>';
assert.doesNotMatch(env.section(),/<img /,'remote campaign names must be escaped');
restore();role='operations';assert.equal(env.section(),'');assert.equal(env.bundle(),null);
restore();env.adminRuntime.session.user.id='other';assert.equal(env.bundle(),null);
env.adminRuntime.session.user.id='owner';
restore();
let called=[];
env.adminOwnerCampaignSignalsLoadFromUi=async()=>{called.push('signals');env.adminOwnerCampaignSignalsState=deep(base.signals)};
env.adminOwnerCampaignOrdersLoadFromUi=async()=>{called.push('orders');env.adminOwnerCampaignOrdersState=deep(base.orders)};
env.adminOwnerCampaignFeeReceiptsLoadFromUi=async()=>{called.push('fees');env.adminOwnerCampaignFeeReceiptsState=deep(base.fees)};
assert.equal(await env.refresh(),true);
assert.deepEqual(called,['signals','orders','fees']);
assert.equal(env.bundle().rows[0].fee.providerConfirmedFeeCents,2800);
assert.ok(rendered>0);
called=[];notice='';
env.adminOwnerCampaignOrdersLoadFromUi=async()=>{called.push('orders');env.adminOwnerCampaignOrdersState=null};
assert.equal(await env.refresh(),false);
assert.match(notice,/fontes da campanha não coincidem/i);
assert.equal(env.bundle(),null);
assert.ok(!ui.includes('adminOwnerCampaignEvidenceSetFromUi'));
for(const selector of ['.admin-campaign-evidence-section','.admin-campaign-evidence-lanes',
 '@media(max-width:640px)'])assert.ok(css.includes(selector));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-campaign-evidence-v1-369.mjs'));
console.log('V1.369 PASS — immutable allocation joins, evidence safeguards, actor and period isolation, mobile styling.');

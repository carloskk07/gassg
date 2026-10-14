import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014180000_owner_campaign_order_attribution_v1_252.sql');
const edge=read('supabase/functions/create-order/index.ts');
const admin=read('supabase/functions/admin-ops/index.ts');
const client=read('js/backend.js');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const fragment of [
 'platform_owner_campaign_order_attributions_v1_252',
 'order_id uuid primary key references public.orders(id)',
 'allocation_id uuid not null references public.platform_owner_budget_allocations_v1_247',
 'alter table public.platform_owner_campaign_order_attributions_v1_252 enable row level security',
 'revoke all on public.platform_owner_campaign_order_attributions_v1_252',
 'v_order.customer_id<>p_customer',
 'v_order.created_at>=a.created_at',
 'v_order.created_at<a.released_at',
 "v_order.created_at<clock_timestamp()-interval '10 minutes'",
 'on conflict (order_id) do nothing',
 'CAMPAIGN_ATTRIBUTION_IMMUTABLE',
 'CAMPAIGN_ATTRIBUTION_NOT_ELIGIBLE',
 'public.owner_order_campaign_bind_v1_252',
 'platform_funding_private_v1_252.results',
 "o.status='SETTLED'",
 "o.financial_state='settled'",
 'o.payment_confirmed_at is not null',
 "o.financial_state='reversed'",
 "'platformReceivedRevenueCents',null",
 "'financialReturnMeasured',false",
 "'first_party_checkout_utm_non_causal_attribution'",
 'grant execute on function public.owner_order_campaign_bind_v1_252(uuid,uuid,text)',
 ' to service_role'
]) assert.ok(sql.includes(fragment),'Migration contract missing: '+fragment);
assert.ok(!/grant\s+(?:insert|update|delete|all)\s+on\s+public\.platform_owner_campaign_order_attributions_v1_252\s+to\s+(?:anon|authenticated)/i.test(sql));
assert.ok(edge.includes('if(campaignTag && UUID_RE.test(String(data?.orderId||"")))'));
assert.ok(edge.includes('await admin.rpc("owner_order_campaign_bind_v1_252"'));
assert.ok(edge.includes('if(linkError||linked?.source!=="owner_order_attribution_v1_252"'));
assert.ok(edge.includes('return json(data, 201, origin)'), 'Do not block commerce on attribution failure');
assert.ok(edge.indexOf('await admin.rpc("owner_order_campaign_bind_v1_252"')>
   edge.indexOf('await admin.rpc("create_order_from_quote_v8"'));
assert.ok(edge.includes('...(campaignTag?{campaignTag}:{})'));
assert.ok(client.includes('const ownerCampaignTag=(()=>{'));
assert.ok(client.includes("p.get('utm_source')!=='tamao'"));
assert.ok(client.includes("p.get('utm_medium')!=='owner_campaign'"));
assert.ok(client.includes('...(ownerCampaignTag?{campaignTag:ownerCampaignTag}:{})'));
assert.ok(admin.includes('"owner-campaign-orders"'));
assert.ok(admin.includes('if(action==="owner-campaign-orders")'));
assert.ok(admin.includes('admin_owner_campaign_orders_v1_252'));
assert.ok(admin.includes('data?.platformReceivedRevenueCents!==null'));
assert.ok(boot.includes('adminOwnerCampaignOrdersLoadFromUi'));
assert.ok(ui.includes('function adminOwnerCampaignOrdersSection()'));
assert.ok(ui.includes('adminOwnerCampaignOrdersSection()+'));
assert.ok(audit.includes('node tests/owner-campaign-orders-v1-252.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
new vm.Script(client,{filename:'backend.js'});
const actor='11111111-1111-4111-8111-111111111111';
const fixture={
 source:'admin_owner_campaign_orders_v1_252',
 month:'2026-10-01',totalCampaigns:1,limit:50,truncated:false,
 metricMeaning:'first_party_checkout_utm_non_causal_attribution',
 platformReceivedRevenueCents:null,financialReturnMeasured:false,
 readOnly:true,plannedOnly:true,noCharge:true,spendableCents:0,newBenefitsEnabled:false,
 rows:[{
   allocationId:'22222222-2222-4222-8222-222222222222',
   campaignTag:'tam-customer_cashback-202610-primeiros-clientes',
   createdOrders:5,settledOrders:2,reversedOrders:1,
   settledMerchantOrderValueCents:29990,
   platformReceivedRevenueCents:null,financialReturnMeasured:false
 }]
};
let role='superadmin',calls=[],toasts=[];
const ctx=vm.createContext({
 adminCurrentRole:()=>role,adminRuntime:{session:{user:{id:actor}}},
 document:{getElementById:()=>({value:'2026-10'})},
 adminInvoke:async p=>{calls.push(p);return fixture;},
 toast:s=>toasts.push(s),render:()=>{},
 adminMoney:c=>'R$ '+(c/100).toFixed(2),
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 Number,Date,String,Array
});
const start=ui.indexOf('// TAMÃO V1.252 —');
const end=ui.indexOf('function adminOwnerFinanceWorkspaceSection(){',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end),ctx);
assert.ok(!ctx.adminOwnerCampaignOrdersSection().includes('R$ 299.90'));
await ctx.adminOwnerCampaignOrdersLoadFromUi();
assert.equal(calls.length,1);
assert.equal(calls[0].month,'2026-10-01');
const view=ctx.adminOwnerCampaignOrdersSection();
assert.ok(view.includes('R$ 299.90'));
assert.ok(view.includes('Pedidos liquidados, sem estorno'));
assert.ok(view.includes('pertence às vendas das revendas'));
assert.ok(view.includes('não comprova que a campanha causou a compra'));
ctx.adminRuntime.session.user.id='33333333-3333-4333-8333-333333333333';
assert.ok(!ctx.adminOwnerCampaignOrdersSection().includes('R$ 299.90'));
ctx.adminRuntime.session.user.id=actor;
role='readonly';
assert.equal(ctx.adminOwnerCampaignOrdersSection(),'');
await ctx.adminOwnerCampaignOrdersLoadFromUi();
assert.equal(calls.length,1,'No unauthorized request');
role='superadmin';
fixture.platformReceivedRevenueCents=300;
await ctx.adminOwnerCampaignOrdersLoadFromUi();
assert.ok(toasts.some(s=>s.includes('não validados')));
assert.ok(!ctx.adminOwnerCampaignOrdersSection().includes('R$ 299.90'));
console.log('V1.252 PASS — order attribution source, commerce resilience, settlement/reversal and zero fictional revenue.');

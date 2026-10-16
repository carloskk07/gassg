import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016120000_ads_psp_freshness_v1_318.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin-activations.js');
new vm.Script(ui);
for(const token of [
 'admin_ads_psp_freshness_v1_318','admin_ads_psp_refresh_v1_318',
 "a.admin_role in ('superadmin','operations','readonly')",
 "a.admin_role='superadmin'","security definer set search_path to 'pg_catalog'",
 'platform_ads_mp_inbox_v1_316','platform_ads_psp_checkouts_v1_314',
 'stale_approved_verification','possible_reversal','stalled_reservation',
 'overdue_unconfirmed_checkout','approval_due_for_refresh',
 'interval \'24 hours\'','interval \'30 minutes\'',
 "'automaticReconciliation',false","'paymentStateChanged',false",
 "'adsLive',false","'merchantBillingSeparate',true",
 'p_payment_data->>\'collector_id\' is distinct from v_c.collector_id',
 'p_payment_data->>\'status_detail\' is distinct from \'accredited\'',
 'p_payment_data->>\'payment_id\' is distinct from v_c.payment_id',
 "v_c.status<>'payment_approved'","v_c.version<>p_expected_version",
 'ADS_PSP_REFRESH_REQUEST_REUSE','platform_admin_audit',
 'update public.platform_ads_psp_checkouts_v1_314',
 "'providerRechecked',true","'noNewCharge',true",
 'revoke all on function public.admin_ads_psp_freshness_v1_318(uuid)',
 'revoke all on function public.admin_ads_psp_refresh_v1_318(uuid,uuid,integer,jsonb,uuid)'
])assert.ok(sql.includes(token),'SQL security and evidence contract: '+token);
assert.ok(!/insert into public\.(merchant_billing|merchant_sale|platform_ads_receivables)/i.test(sql));
assert.ok(!/update public\.(ads_placement_controls|merchant_ads_campaigns|merchant_billing|merchant_sale)/i.test(sql));
for(const token of [
 '"ads-psp-freshness-read"','if(action==="ads-psp-freshness-read")',
 'admin_ads_psp_freshness_v1_318','data.paymentStateChanged!==false',
 '"refresh"','admin_ads_psp_refresh_v1_318','data.providerRechecked!==true',
 'operationDb==="refresh"','saved.data.version!==checkout.version+1'
])assert.ok(edge.includes(token),'Edge contract: '+token);
assert.ok(ui.includes("['adsPspFreshness','ads-psp-freshness-read','admin_ads_psp_freshness_v1_318']"));
assert.ok(ui.includes('adminAdsPspFreshnessView()'));
const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',paymentId='123456789';
let role='superadmin';
const row={merchantId,merchantName:'Revenda Teste',checkoutStatus:'payment_approved',
 checkoutVersion:3,amountCents:12900,paymentId,inboxPaymentId:paymentId,
 inboxProviderStatus:'refunded',inboxProviderDetail:'refunded',
 inboxReceivedAt:'2026-10-15T15:00:00Z',verifiedAt:'2026-10-14T15:00:00Z',
 dueDate:'2026-10-16',externalReference:'tamao-ads',reason:'possible_reversal',
 priority:1,hoursSinceVerified:24,canRequestProviderCheck:true};
const freshness={source:'admin_ads_psp_freshness_v1_318',readOnly:true,snapshotOnly:true,
 automaticReconciliation:false,paymentStateChanged:false,adsLive:false,
 merchantBillingSeparate:true,totalCheckouts:1,needsReview:1,urgentCount:1,
 staleApprovals:0,overdueUnconfirmed:0,stalledReservations:0,rows:[row]};
const desk={actor:'actor',role,checkedAt:new Date().toISOString(),
 data:{adsPspFreshness:freshness,adsPsp:{platformPspConfigured:true}}};
const context=vm.createContext({
 adminActivationDesk:desk,
 adminRuntime:{session:{user:{id:'actor'}}},
 adminCurrentRole:()=>role,adminRoleCanSection:()=>true,
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
 formatDateTime:s=>String(s),Date,String,Number
});
const tail=ui.slice(ui.indexOf('// V1.318 — ageing and reconciliation evidence'));
vm.runInContext(tail+'\nthis.show=adminAdsPspFreshnessView;',context);
assert.match(context.show(),/Conferências vencidas/);
assert.match(context.show(),/Possível estorno/);
assert.match(context.show(),/Consultar novamente no Mercado Pago/);
assert.match(context.show(),/não mostram o status atual/);
role='readonly';desk.role=role;
assert.doesNotMatch(context.show(),/onclick="adminAdsPspAction/);
desk.data.adsPspFreshness=null;
assert.match(context.show(),/Não foi possível confirmar/);
console.log('V1.318 PASS: stale evidence priority, read-only role and server readback, authenticated refresh only, no auto-revenue.');

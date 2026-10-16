import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261016110000_ads_mp_prioritized_triage_v1_317.sql");
const edge=read("supabase/functions/admin-ops/index.ts");
const ui=read("js/admin-activations.js");
new vm.Script(ui);
for(const x of [
 "admin_ads_mp_triage_v1_317","security definer","set search_path to 'pg_catalog'",
 "a.admin_role in ('superadmin','operations','readonly')",
 "platform_ads_mp_inbox_v1_316","platform_ads_psp_checkouts_v1_314",
 "distinct on (e.merchant_id,e.payment_id)","order by e.merchant_id,e.payment_id,e.received_at desc",
 "'possible_reversal'","'approval_to_verify'","'post_reversal_activity'",
 "'aligned_observation'","'check_latest_provider_state'",
 "'refunded','charged_back'","'partially_refunded'",
 "'providerSnapshotOnly',true","'automaticReconciliation',false",
 "'paymentStateChanged',false","'adsLive',false",
 "revoke all on function public.admin_ads_mp_triage_v1_317(uuid) from public,anon,authenticated",
 "grant execute on function public.admin_ads_mp_triage_v1_317(uuid) to service_role"
])assert.ok(sql.includes(x),"SQL contract: "+x);
assert.ok(!/\b(insert into|update|delete from)\s+public\.(?:platform_ads_psp_checkouts|merchant_billing_payment)/i.test(sql),
 "Triage must not mutate financial state");
assert.ok(edge.includes('"ads-mp-triage-read"'));
assert.ok(edge.includes('if(action==="ads-mp-triage-read")'));
assert.ok(edge.includes('admin_ads_mp_triage_v1_317'));
assert.ok(edge.includes('data.paymentStateChanged!==false'));
assert.ok(ui.includes("['adsMpTriage','ads-mp-triage-read','admin_ads_mp_triage_v1_317']"));
assert.ok(ui.includes('adminAdsMpTriageView()'));

const merchantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const paymentId="123456789";
let role="superadmin";
const triage={source:"admin_ads_mp_triage_v1_317",readOnly:true,
 providerSnapshotOnly:true,automaticReconciliation:false,paymentStateChanged:false,
 refundsAlwaysRequireProviderCheck:true,adsLive:false,
 totalUniquePaymentObservations:3,actionableObservations:2,priorityOneObservations:1,
 rows:[
 {eventKey:"a".repeat(64),merchantId,merchantName:"Revenda de Teste",paymentId,
  providerStatus:"refunded",providerStatusDetail:"refunded",triage:"possible_reversal",
  priority:1,amountCents:19900,checkoutStatus:"payment_approved",
  receivedAt:"2026-10-15T21:12:00Z",canRequestReconciliation:true},
 {eventKey:"b".repeat(64),merchantId,merchantName:"Revenda de Teste",paymentId:"987654321",
  providerStatus:"approved",providerStatusDetail:"accredited",triage:"approval_to_verify",
  priority:2,amountCents:12900,checkoutStatus:"checkout_ready",
  receivedAt:"2026-10-15T20:00:00Z",canRequestReconciliation:true}
 ]};
const desk={actor:"actor",role,checkedAt:new Date().toISOString(),
 data:{adsMpTriage:triage,adsPsp:{platformPspConfigured:true,
  rows:[{merchantId,checkout:{status:"payment_approved",version:3}}]}}};
const ctx=vm.createContext({
 adminActivationDesk:desk,adminRuntime:{session:{user:{id:"actor"}}},
 adminCurrentRole:()=>role,adminRoleCanSection:()=>true,
 Date,Number,String,
 esc:s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;")
});
const tail=ui.slice(ui.indexOf("// V1.317 — latest signed-event snapshot triage"));
vm.runInContext(tail+"\nthis.show=adminAdsMpTriageView;",ctx);
const visible=ctx.show();
assert.match(visible,/Prioridade alta/);
assert.match(visible,/Possível estorno ou contestação/);
assert.match(visible,/Snapshot de webhook, não é consulta ao vivo/);
assert.match(visible,/Consultar novamente no provedor/);
assert.match(visible,/Sem observações de pagamento Ads/,{});
role="readonly";desk.role=role;
assert.doesNotMatch(ctx.show(),/onclick="adminAdsPspAction/);
desk.data.adsMpTriage=null;
assert.match(ctx.show(),/Não foi possível confirmar a triagem/);
console.log("V1.317 PASS: risk-focused read-only triage, refund priority, founder reconciliation only, no financial mutation.");

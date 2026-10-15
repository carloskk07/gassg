import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261015214000_admin_push_reliability_v1_294.sql');
const edge=read('supabase/functions/admin-push-reliability/index.ts');
const admin=read('js/admin.js'),bootstrap=read('js/bootstrap.js');
const config=read('supabase/config.toml'),audit=read('scripts/audit-edge-functions.sh');
const ci=read('.github/workflows/audit.yml');
for(const [name,source] of [['admin.js',admin],['bootstrap.js',bootstrap]])
 new vm.Script(source,{filename:name});

for(const marker of [
 'admin_merchant_push_reliability_v1_294',
 "admin_role in ('superadmin','operations','readonly')",
 'public.platform_admins','raise exception \'ADMIN_ACCESS_DENIED\'',
 'where active and revoked_at is null',
 "created_at >= pg_catalog.now()-interval '7 days'",
 "state='provider_accepted'",
 "device_report='seen'","device_report='not_seen'",
 'sum(devices)','count(*) filter(where devices>0)',
 'senderEnabled','cronEnabled','automaticDeliveryVerified',
 'limit 30','merchantListLimit',
 'revoke all on function public.admin_merchant_push_reliability_v1_294(uuid)',
 'to service_role'
])assert.ok(sql.includes(marker),'missing privacy or aggregation: '+marker);
assert.doesNotMatch(sql,/grant execute on function public\.admin_merchant_push_reliability_v1_294\(uuid\)\s+to authenticated/);
assert.ok(!sql.includes('update public.merchant_push_cron_config'));
assert.ok(!sql.includes('update public.merchant_push_keyring'));
assert.ok(!sql.includes('update public.merchant_push_subscriptions'));
assert.ok(!sql.includes('update public.merchant_push_test_runs'));
assert.ok(!sql.includes("'endpoint',")&&!sql.includes("'p256dh',")&&!sql.includes("'auth',"));

for(const marker of [
 'auth.getUser','user.is_anonymous===true','platform_admins',
 'admin_merchant_push_reliability_v1_294',
 'ADMIN_ACCESS_DENIED','ALLOWED_ORIGINS','raw.length>512',
 'body.action!=="read"','readOnly!==true',
 'Cache-Control','no-store'
])assert.ok(edge.includes(marker),'missing Edge guard: '+marker);
assert.ok(!edge.includes('merchant_push_claim_due'));
assert.ok(!edge.includes('merchant_push_cron_tick'));
assert.ok(!edge.includes('sendPushNotification'));
assert.ok(!edge.includes('console.log'));
assert.match(config,/\[functions\.admin-push-reliability\]\s*verify_jwt = false/);
assert.ok(audit.includes('supabase/functions/admin-push-reliability/index.ts'));
assert.ok(bootstrap.includes('adminPushReliabilityLoadFromUi'));
assert.ok(ci.includes('tests/admin-push-reliability-v1-294.mjs'));

for(const marker of [
 'function adminPushReliabilityView','async function adminPushReliabilityLoadFromUi',
 "['superadmin','operations','readonly']", "data.readOnly!==true",
 'adminPushReliabilityView()', 'Avisos vistos, segundo usuários',
 'Relatos manuais não provam',
 'Esta tela é somente de leitura',
 'Últimos 7 dias',
 'Aparelhos cadastrados'
])assert.ok(admin.includes(marker),'missing UI: '+marker);

const start=admin.indexOf('function adminPushReliabilityView(){');
const end=admin.indexOf('\nfunction adminSystemHealthView()',start);
assert.ok(start>=0&&end>start);
let role='superadmin';
const data={
 source:'admin_push_reliability_v1_294',readOnly:true,
 summary:{registeredDevices:1,merchantsWithDevices:1,tests7d:0,providerAccepted7d:0,
  providerFailed7d:0,reportedSeen7d:0,reportedNotSeen7d:0,acceptedUnconfirmed7d:0},
 gates:{senderEnabled:false,cronEnabled:false,automaticDeliveryVerified:false},
 merchants:[{name:'&lt;script&gt;malicious',devices:1,tests:0,
  providerAccepted:0,reportedSeen:0,reportedNotSeen:0}]
};
const state={data,loading:false,error:null,checkedAt:'2026-10-15T18:00:00Z',loadedFor:'actor'};
const ctx=vm.createContext({
 adminRuntime:{pushReliability:state,session:{user:{id:'actor'}}},
 adminCurrentRole:()=>role,
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 formatDateTime:s=>String(s),Date,Number,String
});
vm.runInContext(admin.slice(start,end)+'\nthis.view=adminPushReliabilityView;',ctx);
assert.match(ctx.view(),/Aparelhos cadastrados/);
assert.match(ctx.view(),/Revendas com push/);
assert.match(ctx.view(),/Envios automáticos: desativados/);
assert.match(ctx.view(),/Somente fatos registrados/);
assert.doesNotMatch(ctx.view(),/<script>/);
role='finance';assert.equal(ctx.view(),'','finance role has no system push view');
role='readonly';assert.match(ctx.view(),/Atualizar indicadores/);
state.loadedFor='other-user';assert.doesNotMatch(ctx.view(),/Envios automáticos/);
assert.match(ctx.view(),/Selecione Atualizar indicadores/);
console.log('V1.294 PASS — private administrative aggregate, role-scoped UI, secure read-only gates.');

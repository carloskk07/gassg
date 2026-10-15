import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261015182000_merchant_push_device_test_v1_291.sql');
const server=read('supabase/functions/merchant-push-self-test/index.ts');
const sw=read('sw.js'),backend=read('js/backend.js'),merchant=read('js/merchant.js');
const bootstrap=read('js/bootstrap.js'),config=read('supabase/config.toml');
const audit=read('.github/workflows/audit.yml');
new vm.Script(sw,{filename:'sw.js'});
new vm.Script(backend,{filename:'backend.js'});
new vm.Script(merchant,{filename:'merchant.js'});
new vm.Script(bootstrap,{filename:'bootstrap.js'});

for(const token of [
 'create table if not exists public.merchant_push_test_runs',
 'enable row level security',
 'revoke all on public.merchant_push_test_runs from public,anon,authenticated',
 'grant select,insert,update on public.merchant_push_test_runs to service_role',
 'merchant_push_test_credentials','vault.decrypted_secrets',
 'merchant_push_test_reserve','pg_advisory_xact_lock',
 't.created_at>clock_timestamp()-interval \'3 minutes\'',
 's.endpoint_hash=p_endpoint_hash',
 's.active and s.revoked_at is null',
 'mm.member_role in (\'owner\',\'manager\',\'operator\',\'driver\')',
 'merchant_push_test_finish',
 "and state='reserved'",
 'revoke all on function public.merchant_push_test_credentials()',
 'revoke all on function public.merchant_push_test_reserve(uuid,uuid,text)',
 'revoke all on function public.merchant_push_test_finish(uuid,uuid,text,integer,text)'
])assert.ok(sql.includes(token),'missing private SQL protection: '+token);
assert.ok(!sql.includes('grant execute on function public.merchant_push_test_reserve(uuid,uuid,text) to authenticated'));
assert.ok(!sql.includes('update public.merchant_push_cron_config'));
assert.ok(!sql.includes('update public.merchant_push_keyring'));

for(const token of [
 'auth.getUser','merchant_members','merchant_push_test_reserve',
 'merchant_push_test_finish','merchant_push_test_credentials',
 'await sha256(body.endpoint)','p_user_id:user.id','sendPushNotification',
 'kind:"test"','ttl:45','timeoutMs:8000',
 'deviceDisplayConfirmed:false','body.action!=="send-self-test"',
 'raw.length>2500','!allowedPushEndpoint(body.endpoint)',
 'RATE_LIMITED','DEVICE_NOT_REGISTERED','providerAccepted',
])assert.ok(server.includes(token),'missing self-test protection: '+token);
assert.ok(!server.includes('merchant_push_claim_due'));
assert.ok(!server.includes('merchant_push_cron_tick'));
assert.ok(!server.includes('console.log('));
assert.ok(!server.includes('Deno.env.get("MERCHANT_VAPID_PRIVATE_KEY")'));
assert.match(config,/\[functions\.merchant-push-self-test\]\s*verify_jwt = false/);
assert.match(audit,/node tests\/merchant-push-self-test-v1-291\.mjs/);
assert.match(bootstrap,/merchantPushTestFromUi/);
assert.match(backend,/globalThis\.merchantPushSelfTestLive=merchantPushSelfTestLive/);
assert.match(merchant,/Enviar notificação de teste/);
assert.match(merchant,/O servidor não comprova exibição ou leitura/);

const notices=[],handlers={};
const self={
 location:{origin:'https://parceiro.tamao.com.br'},
 registration:{scope:'https://parceiro.tamao.com.br/',showNotification:async(title,options)=>notices.push({title,options})},
 clients:{matchAll:async()=>[],openWindow:async()=>{}},
 addEventListener:(type,cb)=>handlers[type]=cb
};
vm.runInNewContext(sw,{self,URL,caches:{},fetch:async()=>{},Response,Promise,console});
async function push(payload){
 let pending;handlers.push({
  data:{json:()=>payload},waitUntil:p=>{pending=p}
 });
 if(pending)await pending;
}
await push({kind:'test',customer:'A',phone:'51999999999',pin:'1234',address:'Rua privada'});
assert.equal(notices.length,1);
assert.equal(notices[0].title,'Teste de notificação TAMÃO');
assert.doesNotMatch(JSON.stringify(notices[0]),/51999999999|Rua privada|1234/);
await push({kind:'new_offer'});
assert.equal(notices.length,2);
await push({kind:'unknown'});
assert.equal(notices.length,2,'invalid kind must not display notification');

const start=merchant.indexOf('function merchantAlertControl(');
const end=merchant.indexOf('\n}',start);
assert.ok(start>=0&&end>start);
const model={
 enabled:true,notificationSupported:true,notificationPermission:'granted'
};
const pushState={available:true,subscribed:true,testMode:true,testPending:false,diagnostic:null,testResult:null};
const ctx=vm.createContext({
 esc:x=>String(x),
 globalThis:{merchantAlertStatus:()=>model,merchantPushStatus:()=>pushState}
});
vm.runInContext(merchant.slice(start,end+2)+'\nthis.view=merchantAlertControl;',ctx);
assert.match(ctx.view(),/Enviar notificação de teste/);
assert.match(ctx.view(),/Os avisos automáticos continuam desativados/);
pushState.testPending=true;
assert.match(ctx.view(),/Enviando teste/);
pushState.subscribed=false;
assert.doesNotMatch(ctx.view(),/merchantPushTestFromUi/);
pushState.subscribed=true;
pushState.testPending=false;
pushState.testResult={providerAccepted:true};
assert.match(ctx.view(),/O provedor aceitou o envio/);
assert.match(ctx.view(),/O servidor não comprova exibição ou leitura/);
model.enabled=false;
assert.doesNotMatch(ctx.view(),/merchantPushTestFromUi/);

console.log('V1.291 PASS — authenticated device-scoped self-test, atomic 3-minute limit, private ledger, safe push SW, no automatic order send.');

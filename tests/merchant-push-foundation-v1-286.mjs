import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sw=read('sw.js'),backend=read('js/backend.js'),merchant=read('js/merchant.js');
const bootstrap=read('js/bootstrap.js'),api=read('supabase/functions/merchant-push-registration/index.ts');
const config=read('supabase/config.toml'),audit=read('.github/workflows/audit.yml');
const schema=read('supabase/migrations/20261015133000_merchant_push_foundation_v1_286.sql');
const consent=read('supabase/migrations/20261015133200_merchant_push_consent_filter_v1_286.sql');
for(const [name,script] of [['sw',sw],['backend',backend],['merchant',merchant],['bootstrap',bootstrap]])
  new vm.Script(script,{filename:name+'.js'});
assert.match(schema,/create table if not exists public\.merchant_push_subscriptions/);
assert.match(schema,/create table if not exists public\.merchant_push_outbox/);
assert.match(schema,/endpoint_hash text not null unique/);
for(const table of ['merchant_push_subscriptions','merchant_push_outbox']){
  assert.match(schema,new RegExp('alter table public\\.'+table+' enable row level security'));
  assert.match(schema,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated'));
}
assert.match(schema,/event_key text not null unique/);
assert.match(schema,/on conflict \(event_key\) do nothing/);
assert.match(schema,/provider_accepted/);
assert.doesNotMatch(schema,/delivered_to_device/);
assert.match(consent,/and exists \([\s\S]*?merchant_push_subscriptions sub/);
assert.match(consent,/sub\.active and sub\.revoked_at is null/);
assert.match(consent,/mm\.member_role='driver'/);
assert.match(api,/publicClient\.auth\.getUser/);
assert.match(api,/\.eq\("merchant_id",body\.merchantId\)/);
assert.match(api,/\.eq\("user_id",user\.id\)/);
assert.match(api,/\.eq\("active",true\)/);
assert.ok(api.includes('merchant_push_public_config'),'V1.289: public enrollment config must come from protected RPC');
assert.ok(api.includes('if(!enrollmentEnabled)'),'No subscriptions without provisioned VAPID');
assert.match(api,/enforceApiQuota|consume_api_quota/);
assert.match(api,/validEndpoint\(body\.endpoint\)/);
assert.match(api,/endpoint_hash:endpointHash/);
assert.match(api,/onConflict:"endpoint_hash"/);
assert.match(api,/action:"config"|body\.action==="config"/);
assert.doesNotMatch(api,/(?:VAPID_PRIVATE_KEY|PUSH_PRIVATE_KEY|SECRET_KEY)\s*=\s*["']M/);
assert.match(config,/\[functions\.merchant-push-registration\][\s\S]*?verify_jwt = false/);
assert.match(backend,/async function merchantPushEnableLive\(/);
assert.match(backend,/await Notification\.requestPermission\(\)/);
assert.match(backend,/userVisibleOnly:true/);
assert.match(backend,/merchantInvoke\('merchant-push-registration'/);
assert.match(backend,/await subscription\.unsubscribe\(\)/);
assert.match(backend,/merchantPushRuntime\.available/);
assert.match(merchant,/merchantPushStatus\?\.\(\)\.available===true/);
assert.match(merchant,/Ativar push deste aparelho/);
assert.match(merchant,/Desativar push deste aparelho/);
assert.match(bootstrap,/merchantPushEnableFromUi,merchantPushDisableFromUi/);
assert.match(audit,/node tests\/merchant-push-foundation-v1-286.mjs/);

const handlers={};const notices=[];
const self={
 location:{origin:'https://parceiro.tamao.com.br'},
 registration:{scope:'https://parceiro.tamao.com.br/',showNotification:async(title,options)=>{
    notices.push({title,options});
 }},
 clients:{matchAll:async()=>[],openWindow:async()=>{}},
 addEventListener:(name,callback)=>handlers[name]=callback
};
vm.runInNewContext(sw,{self,URL,caches:{},fetch:async()=>{},Response,Promise,console});
assert.equal(typeof handlers.push,'function');
const push=async payload=>{
  let pending=null;
  handlers.push({data:{json:()=>payload},waitUntil:p=>pending=p});
  if(pending)await pending;
};
await push({kind:'new_offer',address:'Rua particular',customerPhone:'51999999999',pin:'1234',totalCents:99000});
assert.equal(notices.length,1);
assert.equal(notices[0].title,'Novo pedido no TAMÃO');
assert.doesNotMatch(JSON.stringify(notices[0]),/Rua particular|51999999999|1234|99000/);
await push({kind:'assigned_delivery'});
assert.equal(notices.length,2);
assert.equal(notices[1].title,'Nova entrega no TAMÃO');
await push({kind:'unrecognized'});
assert.equal(notices.length,2,'untrusted push kind cannot generate arbitrary notification');
console.log('V1.286 PASS — private RLS, consent-scoped outbox, safe push handler, auth guard and feature-off gate.');

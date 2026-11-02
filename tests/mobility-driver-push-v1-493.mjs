import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/mobility.js'),sw=read('sw.js'),
 sql=read('supabase/migrations/20261101233340_mobility_driver_push_outbox_v1_493.sql'),
 edge=read('supabase/functions/mobility-push-registration/index.ts'),
 sender=read('supabase/functions/merchant-push-delivery/index.ts');
new vm.Script(js);new vm.Script(sw);
for(const table of ['mobility_push_subscriptions','mobility_push_outbox','mobility_push_deliveries','mobility_push_rollout']){
 assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security'));
 assert.match(sql,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated'));
}
assert.match(sql,/create trigger mobility_push_new_request after insert on public.mobility_requests/);
assert.match(sql,/insert into public.mobility_push_rollout\(id,enabled\) values\(true,false\)/);
assert.match(sender,/const mobilityEnabled=!gateError&&gate\?\.enabled===true/);
assert.match(edge,/rollout\?\.enabled===true/);
assert.match(sql,/on conflict\(request_id\) do nothing/);
assert.match(sql,/s.registered_at<=o.created_at/);
assert.match(sql,/r.status='requested' and r.expires_at>v_now/);
assert.match(sql,/l.owner_id=o.driver_id and l.status='published'/);
assert.match(sql,/for update of d skip locked limit v_limit/);
assert.match(sql,/d.attempts<5/);
assert.match(sql,/lease_token=p_lease_token/);
assert.match(sql,/grant execute on function public.mobility_push_claim_due\(integer\) to service_role/);
assert.match(sql,/grant execute on function public.mobility_push_resolve_delivery\(bigint,uuid,text,integer,text\)/);
assert.match(edge,/auth\.getUser\(token.slice\(7\)\)/);
assert.match(edge,/user.is_anonymous/);
assert.match(edge,/eq\("owner_id",user.id\)/);
assert.match(edge,/eq\("status","published"\)/);
const guard=read('supabase/migrations/20261102011500_mobility_push_session_guard_v1_493.sql');
assert.equal((guard.match(/join auth\.sessions sess/g)||[]).length,2);
assert.match(guard,/alter column auth_session_id set not null/);
assert.match(guard,/sess\.not_after is null or sess\.not_after>v_now/);
assert.match(guard,/mobility_push_device_is_active/);
assert.match(guard,/mobility_push_delivery_allowed/);
assert.match(sender,/admin\.rpc\(\s*"mobility_push_delivery_allowed"/);
assert.match(sender,/if\(authorized!==true\)\{outcome="expired"/);
assert.match(guard,/grant execute on function public\.mobility_push_device_is_active\(uuid,uuid,text\)/);
assert.match(edge,/auth\.getUser\(token.slice\(7\)\)/);
assert.match(edge,/authenticatedSessionId\(token.slice\(7\),user.id\)/);
assert.match(edge,/auth_session_id:sessionId/);
assert.match(edge,/mobility_push_device_is_active/);
assert.match(edge,/\.eq\("auth_session_id",sessionId\)/);
assert.match(edge,/\.upsert\(\{/);
assert.match(sender,/if\(!credentials\)/);
assert.match(sender,/mobility_push_claim_due/);
assert.match(sender,/mobility_push_resolve_delivery/);
assert.match(sender,/kind:"mobility_request"/);
assert.doesNotMatch(sender,/kind:"mobility_request"[^}]*request_id/);
assert.match(read('supabase/config.toml'),/\[functions\.mobility-push-registration\]\s+verify_jwt = false/);

const driver='11111111-1111-4111-8111-111111111111';
const key='B'+'A'.repeat(86);
const endpoint='https://fcm.googleapis.com/fcm/send/test-subscription';
const calls=[],notices=[];
let permission='granted',subscription=null,registered=false,revoked=false;
function Notification(){}
Notification.permission='granted';
Notification.requestPermission=async()=>permission;
const sub={
 endpoint,options:{applicationServerKey:Uint8Array.from(Buffer.from(key.replace(/-/g,'+').replace(/_/g,'/')+'=','base64'))},
 toJSON:()=>({keys:{p256dh:'A'.repeat(87),auth:'A'.repeat(22)}}),
 unsubscribe:async()=>{revoked=true;return true}
};
const registration={active:{},
 pushManager:{getSubscription:async()=>subscription,
 subscribe:async(opts)=>{registered=true;assert.equal(opts.userVisibleOnly,true);
 subscription=sub;return sub}}
};
const doc={visibilityState:'visible',querySelector:()=>null,createElement:()=>({}),
 head:{appendChild(){}},getElementById:()=>null,addEventListener:()=>{}};
let remoteEnabled=false;
const ctx={console,URL,URLSearchParams,Date,Uint8Array,atob,AbortController,
 setTimeout,clearTimeout,
 isSecureContext:true,PushManager:class {},Notification,document:doc,
 navigator:{serviceWorker:{ready:Promise.resolve(registration)},
 geolocation:{clearWatch(){}}},
 location:{origin:'https://tamao.com.br',pathname:'/',search:'',hash:'#mobility'},
 CHAMA_BACKEND:{url:'https://example.supabase.co',publishableKey:'public-test'},
 route:()=> 'mobility',shell:x=>x,render(){},esc:x=>String(x),
 addEventListener:()=>{},
 fetch:async (url,opts)=>{
  assert.equal(url,'https://example.supabase.co/functions/v1/mobility-push-registration');
  assert.ok(opts.headers.Authorization.startsWith('Bearer '));
  const body=JSON.parse(opts.body);calls.push(body);
  if(body.action==='config')return {ok:true,json:async()=>({
   available:true,publicKey:key,senderEnabled:false,testMode:true})};
  if(body.action==='subscribe')return {ok:true,json:async()=>({
   ok:true,active:true,testMode:true})};
  if(body.action==='unsubscribe')return {ok:true,json:async()=>({
   ok:true,active:false})};
  if(body.action==='status')return {ok:true,json:async()=>({
   active:remoteEnabled})};
  throw Error('unexpected action');
 }};
ctx.globalThis=ctx;
vm.runInNewContext(js+';this.state=mobilityRuntime;',ctx);
const s=ctx.state;s.phase='ready';s.user={id:driver};
s.client={auth:{getSession:async()=>({data:{session:{user:{id:driver},
 access_token:'jwt-synthetic'}}})}};
assert.equal(registered,false,'no automatic permission request or subscription');
assert.equal(await ctx.mobilityEnableRemoteAlerts(),true);
assert.equal(registered,true);
assert.equal(s.pushEnabled,true);
assert.match(s.notice,/emissor remoto continua desligado/);
assert.deepEqual(calls.map(c=>c.action),['config','subscribe']);
assert.deepEqual(Object.keys(calls[1]).sort(),['action','endpoint','keys']);
assert.equal(await ctx.mobilityDisableRemoteAlerts(),true);
assert.equal(revoked,true);
assert.equal(s.pushEnabled,false);
assert.equal(calls.at(-1).action,'unsubscribe');
assert.equal(calls.at(-1).endpoint,endpoint);
permission='denied';s.error='';subscription=null;
assert.equal(await ctx.mobilityEnableRemoteAlerts(),false);
assert.equal(calls.filter(c=>c.action==='subscribe').length,1);
assert.match(s.error,/Permissão/);
// A registration that never becomes ready must fail instead of leaving the
// enroll button indefinitely blocked on real phones.
const realReady=ctx.navigator.serviceWorker.ready,realTimer=ctx.setTimeout;
ctx.navigator.serviceWorker.ready=new Promise(()=>{});
ctx.setTimeout=fn=>{Promise.resolve().then(fn);return 1};
await assert.rejects(ctx.mobilityReadyPushWorker(),/PUSH_WORKER_TIMEOUT/);
ctx.setTimeout=realTimer;ctx.navigator.serviceWorker.ready=realReady;

// Reopening the PWA must restore only the current account's existing
// subscription without asking permission or subscribing automatically.
ctx.navigator.serviceWorker.getRegistration=async()=>registration;
subscription=sub;remoteEnabled=true;s.pushEnabled=false;
const registeredBefore=registered,subscribesBefore=calls.filter(x=>x.action==='subscribe').length;
assert.equal(await ctx.mobilityRestoreRemoteAlerts(),true);
assert.equal(s.pushEnabled,true);
assert.equal(registered,registeredBefore);
assert.equal(calls.filter(x=>x.action==='subscribe').length,subscribesBefore);
assert.equal(calls.at(-1).action,'status');
remoteEnabled=false;s.pushEnabled=true;
assert.equal(await ctx.mobilityRestoreRemoteAlerts(),false);
assert.equal(s.pushEnabled,false,'revoked/other account is not restored');

// The real SW handles a remote driver push with generic content and safe route.
const handlers={};
const worker={registration:{scope:'https://tamao.com.br/',
 showNotification:async(title,options)=>{notices.push({title,options})}},
 clients:{matchAll:async()=>[],openWindow:async()=>{}},
 addEventListener:(kind,fn)=>{handlers[kind]=fn},skipWaiting:()=>{}};
vm.runInNewContext(sw,{self:worker,URL,console});
let pending;
handlers.push({data:{json:()=>({kind:'mobility_request',origin:'HOME SECRET',request_id:driver})},
 waitUntil:p=>{pending=p}});
await pending;
assert.equal(notices.length,1);
assert.equal(notices[0].options.data.url,'./?mobility=1#mobility');
assert.doesNotMatch(JSON.stringify(notices),/HOME SECRET|11111111/);
assert.match(read('.github/workflows/audit.yml'),/node tests\/mobility-driver-push-v1-493\.mjs/);
console.log('PASS: server-only driver push outbox, opt-in and revocation, disabled sender notice, SW privacy and route');

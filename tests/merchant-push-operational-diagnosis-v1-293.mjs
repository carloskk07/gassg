import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261015210000_merchant_push_diagnostics_v1_293.sql');
const edge=read('supabase/functions/merchant-push-self-test/index.ts');
const backend=read('js/backend.js'),merchant=read('js/merchant.js');
const audit=read('.github/workflows/audit.yml');
for(const [name,code] of [['backend',backend],['merchant',merchant]])new vm.Script(code,{filename:name});
for(const key of ['merchant_push_test_diagnostics','security definer',
 's.endpoint_hash=p_endpoint_hash','s.active','s.revoked_at is null',
 "mm.member_role in ('owner','manager','operator','driver')",
 "interval '7 days'",'t.merchant_id=p_merchant_id and t.user_id=p_user_id',
 "count(*) filter(where state='provider_accepted')",
 "count(*) filter(where device_report='seen')",
 'revoke all on function public.merchant_push_test_diagnostics',
 'to service_role'
])assert.ok(sql.includes(key),'missing SQL authorization or aggregation: '+key);
assert.ok(!sql.includes('grant execute on function public.merchant_push_test_diagnostics(uuid,uuid,text) to authenticated'));
assert.ok(!sql.includes('update public.merchant_push_cron_config'));
for(const key of ['auth.getUser','!user||user.is_anonymous',
 'body.action==="diagnose-tests"','merchant_push_test_diagnostics',
 'p_endpoint_hash:endpointHash','p_user_id:user.id','autoOrderSenderEnabled:false',
 'deviceDisplayConfirmed:false','diagnosis?.registered!==true'
])assert.ok(edge.includes(key),'missing Edge protection: '+key);
assert.ok(!edge.includes('merchant_push_claim_due'));
assert.ok(!edge.includes('merchant_push_cron_tick'));
for(const key of ['merchantPushDiagnoseServerLive','deviceHealth:','healthError:',
 'action:\'diagnose-tests\'','merchantPushFriendlyError','merchantPushRuntime.deviceHealth=null'])
 assert.ok(backend.includes(key),'missing frontend code: '+key);
for(const key of ['Histórico de testes deste aparelho','Próximo passo recomendado',
 'Não Perturbe','Desative o push e cadastre novamente','merchantPushDiagnoseServerLive'])
 assert.ok(merchant.includes(key),'missing merchant guidance: '+key);
assert.match(audit,/node tests\/merchant-push-operational-diagnosis-v1-293\.mjs/);

// Isolated browser test: a server failure must not erase local health checks.
const start=backend.indexOf('async function merchantPushDiagnoseServerLive(){');
const end=backend.indexOf('\nasync function merchantPushEnableLive(){',start);
assert.ok(start>=0&&end>start);
let merchantId='m',userId='u',hasSub=true,error=null,diagnosis={
 registered:true,tests:4,providerAccepted:2,providerFailed:2,
 reportedSeen:1,reportedNotSeen:1,latestState:'failed',
 latestFailureCode:'SUBSCRIPTION_GONE',latestReport:null
};
const rt={healthPending:false,deviceHealth:null,healthError:null,diagnostic:null};
const registration={pushManager:{getSubscription:async()=>hasSub?{endpoint:'secret-test-endpoint'}:null}};
let calls=[];
const ctx=vm.createContext({
 merchantPushRuntime:rt,
 merchantRuntime:{merchant:{merchantId:'m'},session:{user:{id:'u'}}},
 merchantReady:()=>true,
 merchantPushDiagnoseLive:async()=>{
   rt.diagnostic={permission:'granted',workerReady:true,localSubscription:hasSub,keyMatches:true};
 },
 navigator:{serviceWorker:{getRegistration:async()=>registration}},
 merchantInvoke:async(name,request)=>{
   calls.push({name,action:request.action});
   if(error)throw {data:{code:error}};
   return {diagnosis};
 },
 render:()=>{},Date,Number,String
});
vm.runInContext(backend.slice(start,end)+'\nthis.run=merchantPushDiagnoseServerLive;',ctx);
assert.equal(await ctx.run(),true);
assert.equal(rt.deviceHealth.tests,4);
assert.equal(rt.deviceHealth.providerFailed,2);
assert.equal(rt.deviceHealth.latestFailureCode,'SUBSCRIPTION_GONE');
assert.equal(JSON.stringify(rt.deviceHealth).includes('secret-test-endpoint'),false);
assert.equal(calls[0].action,'diagnose-tests');
error='DEVICE_NOT_REGISTERED';
assert.equal(await ctx.run(),true);
assert.equal(rt.deviceHealth,null);
assert.equal(rt.healthError.code,'DEVICE_NOT_REGISTERED');
assert.equal(rt.diagnostic.localSubscription,true,'local observations preserved on network errors');
error=null;hasSub=false;calls=[];
assert.equal(await ctx.run(),true);
assert.equal(calls.length,0,'do not query server without browser subscription');
hasSub=true;diagnosis={registered:true,tests:9999999,latestState:'strange',
 latestFailureCode:'sensitive custom message',latestReport:null};
assert.equal(await ctx.run(),true);
assert.equal(rt.deviceHealth.tests,100000,'clamp unexpected count');
assert.equal(rt.deviceHealth.latestFailureCode,null,'do not echo untrusted failure codes');
ctx.merchantRuntime.session.user.id='different-user';
assert.equal(rt.deviceHealth.userId,'u','diagnostic remains tied to original user');
assert.ok(backend.includes('deviceHealth.userId===String(merchantRuntime.session?.user?.id'));

// Merchant UI never promotes provider acceptance or manual reports to verified receipts.
const i=merchant.indexOf('function merchantAlertControl(');
const j=merchant.indexOf('\n}',i);
assert.ok(i>=0&&j>i);
const p={available:true,subscribed:true,diagnostic:{
 secure:true,supported:true,workerReady:true,permission:'granted',
 localSubscription:true,keyMatches:true
},deviceHealth:{tests:4,providerAccepted:2,providerFailed:2,
 reportedSeen:1,reportedNotSeen:1,latestFailureCode:'SUBSCRIPTION_GONE'},healthPending:false};
const displayCtx=vm.createContext({esc:x=>String(x),globalThis:{
 merchantAlertStatus:()=>({enabled:true,notificationSupported:true,notificationPermission:'granted'}),
 merchantPushStatus:()=>p
}});
vm.runInContext(merchant.slice(i,j+2)+'\nthis.display=merchantAlertControl;',displayCtx);
assert.match(displayCtx.display(),/Histórico de testes deste aparelho/);
assert.match(displayCtx.display(),/Desative o push e cadastre novamente/);
assert.match(displayCtx.display(),/Aceite pelo provedor e relatos manuais não garantem/);
p.deviceHealth.latestFailureCode=null;p.deviceHealth.latestReport='not_seen';
assert.match(displayCtx.display(),/Não Perturbe/);
p.healthError='DEVICE_NOT_REGISTERED';
assert.match(displayCtx.display(),/servidor não reconhece esta inscrição/);
console.log('V1.293 PASS — local/server diagnosis, own-device scope, real counts, no auto notifications.');

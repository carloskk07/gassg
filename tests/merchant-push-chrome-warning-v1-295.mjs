import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261015225000_push_chrome_spam_warning_v1_295.sql');
const edge=read('supabase/functions/merchant-push-self-test/index.ts');
const sw=read('sw.js'),backend=read('js/backend.js');
const merchant=read('js/merchant.js'),admin=read('js/admin.js');
const bootstrap=read('js/bootstrap.js'),audit=read('.github/workflows/audit.yml');
for(const [name,s] of [['sw.js',sw],['backend.js',backend],['merchant.js',merchant],['admin.js',admin],['bootstrap.js',bootstrap]])
  new vm.Script(s,{filename:name});

for(const marker of [
 "check (device_report in ('seen','not_seen','spam_warning'))",
 'merchant_push_report_corrections','enable row level security',
 'original_report','corrected_report','reason_code',
 'merchant_push_test_correct_spam_warning','for update of t',
 'on conflict (run_id) do nothing','s.endpoint_hash=p_endpoint_hash',
 's.active and s.revoked_at is null',
 "mm.member_role in ('owner','manager','operator','driver')",
 "interval '24 hours'","v_run.device_report not in ('seen','not_seen')",
 "v_run.device_report<>p_report",
 'revoke all on function public.merchant_push_test_correct_spam_warning',
 'to service_role',
 "pg_catalog.coalesce(c.corrected_report,t.device_report)",
 "'reportedWarning7d'","'reportedWarning'",
 "'reportedWarning',count(*)",
 "'previousReport'"
])assert.ok(sql.includes(marker),'missing SQL evidence: '+marker);
assert.ok(!sql.includes('update public.merchant_push_cron_config'));
assert.ok(!sql.includes('update public.merchant_push_keyring'));
assert.ok(!sql.includes('update public.merchant_push_test_runs set device_report='));
assert.doesNotMatch(sql,/grant execute on function public.merchant_push_test_correct_spam_warning\(uuid,uuid,uuid,text\)\s*to authenticated/);

for(const marker of ['auth.getUser','member.member_role',
 'body.action==="correct-spam-warning"',
 'merchant_push_test_correct_spam_warning',
 'receiptKind:"manual_user_report"','correctionRecorded:true',
 'providerReceiptVerified:false',
 '!["seen","not_seen","spam_warning"].includes',
 'deviceDisplayConfirmed:false'
])assert.ok(edge.includes(marker),'missing Edge guard: '+marker);
assert.ok(!edge.includes('merchant_push_claim_due'));
assert.ok(!edge.includes('merchant_push_cron_tick'));

for(const marker of ['merchantPushCorrectChromeWarningLive','action:\'correct-spam-warning\'',
 'deviceReport=\'spam_warning\'','action:\'report-display\'',
 'reportedWarning:count(\'reportedWarning\')',
 'latestReport:[\'seen\',\'not_seen\',\'spam_warning\']',
 'globalThis.merchantPushCorrectChromeWarningLive'])
 assert.ok(backend.includes(marker),'missing browser support '+marker);
for(const marker of ['Apareceu com aviso de possível spam',
 'Na verdade, apareceu com aviso do Chrome','Marcar como seguro',
 'Chrome controla essa classificação',
 'merchantPushCorrectChromeWarningFromUi',
 "report==='spam_warning'"])
 assert.ok(merchant.includes(marker),'missing UI '+marker);
assert.ok(bootstrap.includes('merchantPushCorrectChromeWarningFromUi'));
assert.ok(admin.includes("count(summary,'reportedWarning7d')"));
assert.ok(admin.includes("count(row,'reportedWarning')"));
assert.ok(sw.includes('renotify:!isTest'));
assert.ok(sw.includes('Você solicitou este aviso no Portal das Revendas TAMÃO.'));
assert.ok(audit.includes('node tests/merchant-push-chrome-warning-v1-295.mjs'));

const start=merchant.indexOf('function merchantAlertControl(');
const end=merchant.indexOf('\n}',start);
const obj={enabled:true,notificationSupported:true,notificationPermission:'granted'};
const push={
 available:true,subscribed:true,testMode:true,reportPending:false,
 testPending:false,deviceHealth:null,diagnostic:null,
 testResult:{runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 providerAccepted:true,deviceReport:null}
};
const ctx=vm.createContext({esc:x=>String(x),globalThis:{
 merchantAlertStatus:()=>obj,merchantPushStatus:()=>push
}});
vm.runInContext(merchant.slice(start,end+2)+'\nthis.view=merchantAlertControl;',ctx);
assert.match(ctx.view(),/Apareceu com aviso de possível spam/);
assert.doesNotMatch(ctx.view(),/merchantPushCorrectChromeWarningFromUi/);
push.testResult.deviceReport='not_seen';
assert.match(ctx.view(),/merchantPushCorrectChromeWarningFromUi/);
push.testResult.deviceReport='spam_warning';
assert.match(ctx.view(),/Chrome mostrou um aviso de possível spam/);
assert.doesNotMatch(ctx.view(),/merchantPushCorrectChromeWarningFromUi/);
push.deviceHealth={latestReport:'spam_warning',reportedSeen:0,reportedNotSeen:0,reportedWarning:1,tests:1};
assert.match(ctx.view(),/Marcar como seguro/);
assert.match(ctx.view(),/Aviso de spam: 1/);

const lo=backend.indexOf('async function merchantPushCorrectChromeWarningLive(){');
const hi=backend.indexOf('\nasync function merchantPushDisableLive(){',lo);
assert.ok(lo>=0&&hi>lo);
let methodCalls=[];
const runtime={testPending:false,reportPending:false,deviceHealth:null,
 testResult:{merchantId:'m',userId:'u',runId:'r',providerAccepted:true,deviceReport:'not_seen'},
 subscribed:true};
const env=vm.createContext({
 merchantRuntime:{merchant:{merchantId:'m'},session:{user:{id:'u'}}},
 merchantPushRuntime:runtime,merchantReady:()=>true,
 merchantPushStatus:()=>({testResult:runtime.testResult}),
 merchantInvoke:async(_,body)=>{
   methodCalls.push(body);
   return {correctionRecorded:true,receiptKind:'manual_user_report',deviceReport:'spam_warning'};
 },
 navigator:{serviceWorker:{getRegistration:async()=>({
   pushManager:{getSubscription:async()=>({endpoint:'private-device-endpoint'})}
 })}},render:()=>{},Error,String
});
vm.runInContext(backend.slice(lo,hi)+'\nthis.correct=merchantPushCorrectChromeWarningLive;',env);
assert.equal(await env.correct(),true);
assert.equal(runtime.testResult.deviceReport,'spam_warning');
assert.equal(runtime.testResult.previousReport,'not_seen');
assert.equal(methodCalls.length,1);
assert.equal(methodCalls[0].action,'correct-spam-warning');
assert.equal(JSON.stringify(runtime.testResult).includes('private-device-endpoint'),false);
await assert.rejects(env.correct(),/Consulte o último teste/);
console.log('V1.295 PASS — Chrome spam-warning report, append-only correction, role/device scope and safer tests.');

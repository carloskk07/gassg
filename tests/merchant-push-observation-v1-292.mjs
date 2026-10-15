import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261015194500_merchant_push_observation_v1_292.sql');
const edge=read('supabase/functions/merchant-push-self-test/index.ts');
const merchant=read('js/merchant.js'),backend=read('js/backend.js');
const bootstrap=read('js/bootstrap.js');
for(const [name,source] of [['merchant.js',merchant],['backend.js',backend],['bootstrap.js',bootstrap]])
  new vm.Script(source,{filename:name});

for(const required of [
  'add column if not exists device_report',
  "('seen','not_seen')",'device_reported_at',
  'merchant_push_test_latest','merchant_push_test_report',
  's.endpoint_hash=p_endpoint_hash','s.active and s.revoked_at is null',
  "t.state='provider_accepted'", "interval '24 hours'",
  'v_run.device_report<>p_report','for update of t',
  'revoke all on function public.merchant_push_test_latest',
  'revoke all on function public.merchant_push_test_report',
  'to service_role'
])assert.ok(sql.includes(required),'SQL missing: '+required);
assert.ok(!sql.includes('update public.merchant_push_cron_config'));
assert.ok(!sql.includes('update public.merchant_push_keyring'));
assert.ok(!sql.includes('grant execute on function public.merchant_push_test_report(uuid,uuid,uuid,text,text) to authenticated'));

for(const required of [
  'auth.getUser','!user||user.is_anonymous','member.member_role',
  'body.action==="last-test"','body.action==="report-display"',
  'merchant_push_test_latest','merchant_push_test_report',
  'p_user_id:user.id','p_endpoint_hash:endpointHash',
  'receiptKind:"manual_user_report"','providerReceiptVerified:false',
  'deviceDisplayConfirmed:false',
  'body.action==="report-display"&&'
])assert.ok(edge.includes(required),'Edge missing: '+required);
assert.ok(!edge.includes('merchant_push_claim_due'));
assert.ok(!edge.includes('merchant_push_cron_tick'));

for(const token of ['merchantPushLastFromUi','merchantPushReportFromUi',
  'Recebi a notificação','Não apareceu','Consultar último teste',
  'Relato manual da revenda'])assert.ok(merchant.includes(token),'UI missing '+token);
for(const token of ['merchantPushLatestTestLive','merchantPushReportTestLive',
  "action:'last-test'","action:'report-display'",'merchantPushRuntime.testResult.deviceReport=report',
  'globalThis.merchantPushLatestTestLive','globalThis.merchantPushReportTestLive'])
  assert.ok(backend.includes(token),'frontend missing '+token);
assert.ok(bootstrap.includes('merchantPushLastFromUi,merchantPushReportFromUi'));

const start=merchant.indexOf('function merchantAlertControl(');
const end=merchant.indexOf('\n}',start);
assert.ok(start>=0&&end>start);
const base={enabled:true,notificationSupported:true,notificationPermission:'granted'};
const push={available:true,subscribed:true,testMode:true,testPending:false,
  reportPending:false,diagnostic:null,testResult:{
    runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',providerAccepted:true,deviceReport:null}};
const context=vm.createContext({esc:x=>String(x),globalThis:{
  merchantAlertStatus:()=>base,merchantPushStatus:()=>push
}});
vm.runInContext(merchant.slice(start,end+2)+'\nthis.display=merchantAlertControl;',context);
assert.match(context.display(),/Recebi a notificação/);
assert.match(context.display(),/Não apareceu/);
assert.match(context.display(),/Consultar último teste/);
push.testResult.deviceReport='seen';
assert.match(context.display(),/Você confirmou que o aviso apareceu/);
assert.doesNotMatch(context.display(),/merchantPushReportFromUi/);
push.testResult.deviceReport='not_seen';
assert.match(context.display(),/não apareceu neste aparelho/);
push.testResult.deviceReport=null;
push.testResult.providerAccepted=false;
assert.doesNotMatch(context.display(),/merchantPushReportFromUi/);
push.subscribed=false;
assert.doesNotMatch(context.display(),/merchantPushLastFromUi/);
push.subscribed=true;
push.testResult.providerAccepted=true;
push.reportPending=true;
assert.match(context.display(),/disabled[^>]+onclick="merchantPushReportFromUi/);
base.enabled=false;
assert.doesNotMatch(context.display(),/merchantPushLastFromUi/);
console.log('V1.292 PASS — authenticated endpoint-bound manual report, immutable evidence, reloadable last test, no auto-sends.');

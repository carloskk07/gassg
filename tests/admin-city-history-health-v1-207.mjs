import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/admin-acquisition.js'),adm=read('js/admin.js'),
 sql=read('supabase/migrations/20261013021500_city_history_monitor_v1_207.sql');
new vm.Script(src,{filename:'admin-acquisition.js'});
new vm.Script(adm,{filename:'admin.js'});
const extract=name=>{
 const p=['adminLoadCityHistory'].includes(name)?'async function ':'function ';
 const start=src.indexOf(p+name+'('),end=src.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing '+name);
 return src.slice(start,end+2);
};
const health=(status,overrides={})=>({
 status,
 asOf:'2026-10-12T23:45:00Z',
 firstDueAt:'2026-10-13T12:18:00Z',
 expectedAt:'2026-10-13T12:18:00Z',
 graceMinutes:40,
 captureJobActive:true,watchdogJobActive:true,
 lastScheduledAt:null,lastCaptureAt:null,lastWatchdogAt:null,
 cronRunStatus:null,lastWatchdogStatus:null,...overrides
});
let role='operations',reads=0,renders=0;
let response={source:'database_authoritative',snapshots:[],health:health('awaiting_first'),
 scheduler:{active:true,cadence:'daily',utcTime:'12:18'}};
const runtime={status:'ready',session:{user:{id:'admin-A'}},cityHistory:{
 items:[],loading:false,loaded:false,error:null,loadedFor:null,chosen:null,scheduler:null,health:null
}};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const sandbox=vm.createContext({
 adminRuntime:runtime,Date,Array,String,Object,Number,Map,esc,
 adminReady:()=>runtime.status==='ready',
 adminRoleCanSection:section=>section==='prospects'&&role!=='finance',
 adminCurrentRole:()=>role,
 adminInvoke:async body=>{assert.equal(body.action,'commercial-history-list');reads++;return response},
 render:()=>renders++
});
const names=['adminCityHistoryReset','adminLoadCityHistory','adminCityHistoryValidatedHealth',
 'adminCityHistoryHealthView','adminCityHistoryCompare','adminCityCommercialHistoryView'];
vm.runInContext(names.map(extract).join('\n')+
 '\nthis.load=adminLoadCityHistory;this.reset=adminCityHistoryReset;'+
 'this.validate=adminCityHistoryValidatedHealth;this.healthView=adminCityHistoryHealthView;'+
 'this.view=adminCityCommercialHistoryView;',sandbox);
await sandbox.load();
assert.equal(reads,1);
assert.equal(runtime.cityHistory.health.status,'awaiting_first');
assert.ok(sandbox.view().includes('Primeira execução programada'));
assert.ok(!sandbox.view().includes('Captura diária atrasada'));
for(const status of ['healthy','awaiting_first','in_grace','missing_capture','run_failed',
 'job_missing','job_disabled','job_changed','watchdog_missing','watchdog_disabled',
 'watchdog_changed','watchdog_late']){
 const txt=sandbox.healthView(sandbox.validate(health(status)));
 assert.ok(txt.includes('role=\\'status\\''),status);
 assert.ok(!txt.includes('undefined'),status);
 if(['missing_capture','run_failed','job_missing','job_disabled','job_changed',
 'watchdog_missing','watchdog_disabled','watchdog_changed','watchdog_late'].includes(status)){
   assert.ok(txt.includes('class=\\'notice danger\\''),status);
 }else{
   assert.ok(!txt.includes('class=\\'notice danger\\''),status);
 }
}
assert.ok(sandbox.healthView(sandbox.validate(health('healthy'))).includes('Captura diária confirmada'));
assert.ok(sandbox.healthView(sandbox.validate(health('in_grace'))).includes('dentro do prazo'));
assert.equal(sandbox.validate(health('invalid')),null);
assert.equal(sandbox.validate(health('healthy',{expectedAt:'<script>alert(1)</script>'})),null);
assert.equal(sandbox.validate(health('healthy',{cronRunStatus:'<img onerror=evil>'})),null);
// The displayed text comes exclusively from the fixed allowlist (never injected content).
assert.ok(!sandbox.healthView(sandbox.validate(health('healthy',{
 lastWatchdogStatus:'<img onerror=evil>'
}))).includes('<img'));
response={...response,health:health('run_failed',{
  lastWatchdogAt:'2026-10-13T13:06:00Z',
  cronRunStatus:'failed',
  lastWatchdogStatus:'run_failed'
})};
await sandbox.load({force:true});
assert.equal(runtime.cityHistory.health.status,'run_failed');
assert.ok(sandbox.view().includes('Falha registrada pelo agendador'));
runtime.session={user:{id:'admin-B'}};
assert.ok(!sandbox.view().includes('Falha registrada pelo agendador'),'Cross-session health leakage');
sandbox.reset();
assert.equal(runtime.cityHistory.health,null);
runtime.status='unauthenticated';
await sandbox.load({force:true});
assert.equal(reads,2);
role='finance';runtime.status='ready';
await sandbox.load({force:true});
assert.equal(reads,2);
const checks=[
 'create table if not exists tamao_internal.city_history_health_config_v1_207',
 'create table if not exists tamao_internal.city_history_health_checks_v1_207',
 'p_as_of timestamptz default clock_timestamp()',
 "v_status:='awaiting_first'",
 "v_status:='job_missing'",
 "v_status:='job_disabled'",
 "v_status:='job_changed'",
 "v_status:='watchdog_missing'",
 "v_status:='watchdog_disabled'",
 "v_status:='watchdog_changed'",
 "v_status:='run_failed'",
 "v_status:='healthy'",
 "v_status:='in_grace'",
 "v_status:='missing_capture'",
 "v_status:='watchdog_late'",
 "interval '40 minutes'",
 "interval '47 minutes'",
 'from cron.job_run_details',
 'from public.admin_city_commercial_history_v1_205',
 'on conflict(due_at) do nothing',
 "'health',tamao_internal.city_history_health_v1_207(clock_timestamp())",
 "'5 13 * * *'",
 "security invoker",
 "if session_user<>'postgres' then",
 "revoke all on function tamao_internal.record_city_history_health_v1_207()",
 "from public,anon,authenticated,service_role"
];
for(const x of checks)assert.ok(sql.includes(x),'SQL guard absent: '+x);
assert.ok(!sql.includes('grant execute on function tamao_internal.'));
assert.ok(!sql.includes('http_post'));
assert.ok(!sql.includes('pg_net'));
assert.ok(!sql.includes('update public.merchants'));
assert.ok(!sql.includes('delete from public.admin_city_commercial_history_v1_205'));
assert.ok(adm.includes('health:null'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/admin-city-history-health-v1-207.mjs'));
console.log('V1.207 OK: first-run grace, cron failure, stale monitoring, role isolation, hardcoded safe notices, private DB-only watchdog and no financial mutations.');

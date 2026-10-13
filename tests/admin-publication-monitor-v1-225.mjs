import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013200000_portal_attestation_monitor_v1_225.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin.js');
const audit=read('.github/workflows/audit.yml');

const sqlContracts=[
  'classify_portal_attestation_monitor_v1_225(',
  'admin_portal_attestation_monitor_v1_225(p_actor_user_id uuid)',
  "a.admin_role in ('superadmin','operations','readonly')",
  "v_job.username='postgres' and v_job.schedule='53 * * * *'",
  "from cron.job_run_details",
  "from tamao_internal.portal_attestation_observations_v1_223",
  "v_expected:=v_expected-interval '1 hour'",
  "if p_now<v_expected+interval '5 minutes'",
  "when 'missed_run' then",
  "when 'interrupted' then",
  "when 'run_failed' then",
  "when 'missing_observation' then",
  "when 'evidence_unverified' then",
  "when 'awaiting_first' then",
  "'automaticRemediation',false",
  "'noOutageClaim',true",
  "'scope','postgres_oidc_monitor_not_portal_uptime'",
  "revoke all on function public.admin_portal_attestation_monitor_v1_225(uuid)",
  "grant execute on function public.admin_portal_attestation_monitor_v1_225(uuid)"
];
for(const required of sqlContracts)
  assert.ok(sql.includes(required),'Missing private scheduler safeguard: '+required);
assert.ok(!/drop\s+table|alter\s+role|grant\s+select|net\.http_post|commerce_enabled/i.test(sql));
assert.ok(edge.includes('admin.rpc("admin_portal_attestation_monitor_v1_225"'));
assert.ok(edge.includes("data?.automaticRemediation===false"));
assert.ok(edge.includes("data?.noOutageClaim===true"));
assert.ok(edge.includes("p_actor_user_id:actorId"));
assert.ok(edge.includes("groups:{incidents,support,finance,capture,portals,publication,publicationHistory,publicationTrends,publicationMonitor}"));
assert.ok(audit.includes('node tests/admin-publication-monitor-v1-225.mjs'));

const extract=name=>{
  const start=ui.indexOf('function '+name+'(');
  const end=ui.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing JS function '+name);
  return ui.slice(start,end+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;')
 .replaceAll('<','&lt;').replaceAll('>','&gt;')
 .replaceAll('"','&quot;').replaceAll("'","&#39;");
const ctx=vm.createContext({Date,Number,Array,Set,String,Object,Math,esc});
vm.runInContext([
  extract('adminOperationalAlertHistoryDate'),
  extract('adminPublicationCronMonitorView'),
  extract('adminOperationalAlertModel'),
  extract('adminOperationalAlertTriage')
].join('\n')+
 '\nthis.model=adminOperationalAlertModel;this.view=adminPublicationCronMonitorView;'+
 'this.triage=adminOperationalAlertTriage;',ctx);
const now=new Date().toISOString();
const earlier=new Date(Date.now()-20*60000).toISOString();
const next=new Date(Date.now()+40*60000).toISOString();
const sample={
  available:true,valid:true,status:'healthy',severity:'none',noOutageClaim:true,
  checkedAt:now,expectedSlotAt:earlier,graceUntil:earlier,nextDueAt:next,
  lastRunAt:earlier,lastRunStatus:'succeeded',lastSuccessAt:earlier,missingSlots:0,
  cause:'A última janela de execução foi devidamente comprovada.',
  impact:'O histórico foi confirmado, mas não mede a disponibilidade dos sites.',
  action:'Conferir a próxima execução programada no Supabase.',
  recoveryCriteria:'Uma nova execução automática com registro OIDC consistente.'
};
const quiet={
  incidents:{valid:true,open:0,critical:0,high:0},
  finance:{available:false},support:{available:false},capture:{available:false},
  portals:{available:true,valid:true,verified:true}
};
let model=ctx.model({...quiet,publicationMonitor:sample});
assert.equal(model.alerts.length,0);
assert.equal(model.unavailable.length,0);
assert.ok(ctx.view(sample).includes('Execução comprovada'));
assert.ok(ctx.view(sample).includes('próxima programada'));

const failed={...sample,status:'run_failed',severity:'high',
  cause:'O PostgreSQL registrou uma falha real na execução do monitor.'};
model=ctx.model({...quiet,publicationMonitor:failed});
assert.equal(model.alerts.length,1,'One monitor issue, no portal alert duplication');
assert.equal(model.alerts[0].id,'portal-monitor');
assert.equal(model.alerts[0].severity,'high');
assert.equal(model.alerts[0].target,'system');
assert.equal(ctx.triage(model.alerts,null,now).length,1);
assert.ok(ctx.view(failed).includes('Próxima ação:'));
assert.ok(ctx.view(failed).includes('Como confirmar recuperação:'));

for(const status of ['job_missing','job_disabled','job_changed','missed_run','interrupted',
 'run_failed','run_stalled','missing_observation']){
  const m=ctx.model({...quiet,publicationMonitor:{...failed,status}});
  assert.equal(m.alerts.length,1,'Missing scheduler issue '+status);
  assert.equal(m.alerts[0].severity,'high');
}
const first=ctx.model({...quiet,publicationMonitor:{...sample,
  status:'awaiting_first',severity:'warning'}});
assert.equal(first.alerts.length,1);
assert.equal(first.alerts[0].severity,'medium','No automatic run is uncertain, not proof of outage');
for(const status of ['run_processing','healthy']){
 const m=ctx.model({...quiet,publicationMonitor:{...sample,status}});
 assert.equal(m.alerts.length,0,'No premature incident '+status);
}
for(const invalid of [
 {...sample,valid:false},
 {...sample,noOutageClaim:false},
 {...sample,checkedAt:'invalid'},
 {...sample,missingSlots:-1},
 {...sample,impact:'short'},
 {...sample,status:'unknown_status'}]){
 const rendered=ctx.view(invalid);
 assert.ok(rendered.includes('não confirmado'),'Malformed monitor state rejected');
 const m=ctx.model({...quiet,publicationMonitor:invalid});
 assert.ok(m.unavailable.includes('Diagnóstico do agendador OIDC'));
}
const malicious={...failed,cause:'<script>alert(1)</script>'};
const injected=ctx.view(malicious);
assert.ok(injected.includes('&lt;script&gt;'));
assert.ok(!injected.includes('<script>'));
assert.ok(!extract('adminPublicationCronMonitorView').includes('adminPerform('));
assert.ok(!extract('adminPublicationCronMonitorView').includes('adminInvoke('));
assert.ok(ui.includes("adminPublicationCronMonitorView(present?.rawPublicationMonitor)"));
new vm.Script(ui,{filename:'admin.js'});
console.log('V1.225 PASS — cron grace logic contracts, scoped SQL, fail-closed diagnosis and safe Admin actions.');

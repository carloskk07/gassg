import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013193000_portal_attestation_trends_v1_224.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin.js');
const audit=read('.github/workflows/audit.yml');
const tests=read('tests/admin-publication-history-v1-223.mjs');

const required=[
  'security definer','set search_path=pg_catalog',
  "a.admin_role in ('superadmin','operations','readonly')",
  "from cron.job_run_details", "from tamao_internal.portal_attestation_observations_v1_223",
  "from tamao_internal.portal_attestation_episodes_v1_223",
  "v_last_run.status='failed'", "v_success_count<3 or v_obs_count<3",
  "when v_monitor<>'current' then 'monitor_unverified'",
  "when v_episodes>=2 then 'recurrent_attestation_issue'",
  "when v_open>0 and v_persistent>0 then 'persistent_attestation_issue'",
  "'coveragePercentage',null","'historicalSiteOutageProven',false",
  "revoke all on function public.admin_portal_attestation_trends_v1_224(uuid)",
  "grant execute on function public.admin_portal_attestation_trends_v1_224(uuid)"
];
for(const text of required)assert.ok(sql.includes(text),'Missing SQL provenance guard: '+text);
assert.ok(!sql.includes('create table')&&!sql.includes('net.http_post')&&
  !sql.includes('commerce_enabled')&&!sql.includes('alter role')&&!sql.includes('grant select'));
assert.ok(edge.includes('admin.rpc("admin_portal_attestation_trends_v1_224"'));
assert.ok(edge.includes("publicationTrends={available:true,valid:false}"));
assert.ok(edge.includes("groups:{incidents,support,finance,capture,portals,publication,publicationHistory,publicationTrends}"));
assert.ok(edge.includes("data?.trend?.coveragePercentage===null"));
assert.ok(edge.includes("p_actor_user_id:actorId"));
assert.ok(audit.includes('node tests/admin-publication-trends-v1-224.mjs'));
assert.ok(tests.includes('publicationTrends'),'V1.223 contract must remain current');
const extract=name=>{
 const start=ui.indexOf('function '+name+'(');
 const end=ui.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing function '+name);
 return ui.slice(start,end+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;')
  .replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'","&#39;");
const ctx=vm.createContext({Date,Number,Array,Object,Set,String,Math,esc});
vm.runInContext([
  extract('adminOperationalAlertHistoryDate'),extract('adminPublicationTrendView'),
  extract('adminOperationalAlertModel')
].join('\n')+'\nthis.view=adminPublicationTrendView;this.model=adminOperationalAlertModel;',ctx);
const now=new Date().toISOString();
const val={
 available:true,valid:true,noOutageClaim:true,
 asOf:now,monitor:{status:'current',scheduled:true,lastSucceededAt:now},
 last24h:{scheduledSuccesses:4,scheduledFailures:0,observedSlots:4,
   clearObservations:4,activeObservations:0,unknownObservations:0},
 last30d:{episodes:0,resolved:0,open:0,persistentOpen:0,recurrent:false},
 trend:{status:'no_recent_attestation_issue_observed',
   scope:'OIDC_evidence_only_not_portal_uptime',coveragePercentage:null}
};
const html=ctx.view(val);
assert.ok(html.includes('Sem problema de atestação observado na amostra'));
assert.ok(html.includes('Execuções automáticas aprovadas'));
assert.ok(html.includes('não é monitoramento de disponibilidade'));
assert.ok(html.includes('Percentual de disponibilidade não calculado'));
assert.ok(!html.includes('100%'));
const insufficient={...val,monitor:{status:'awaiting_first',scheduled:true,lastSucceededAt:null},
 last24h:{...val.last24h,scheduledSuccesses:0,observedSlots:1,clearObservations:1},
 trend:{...val.trend,status:'monitor_unverified'}};
const noAuto=ctx.view(insufficient);
assert.ok(noAuto.includes('Nenhuma execução automática registrada'));
assert.ok(noAuto.includes('São necessárias ao menos três execuções automáticas'));
assert.ok(!noAuto.includes('Agendamento com execução recente comprovada'));
const expired={...val,monitor:{...val.monitor,status:'stale'},
 trend:{...val.trend,status:'monitor_unverified'}};
assert.ok(ctx.view(expired).includes('Agendamento sem execução bem-sucedida recente'));
const failed={...val,monitor:{...val.monitor,status:'run_failed'},
 trend:{...val.trend,status:'monitor_unverified'}};
assert.ok(ctx.view(failed).includes('Última execução automática falhou'));
const ongoing={...val,last30d:{episodes:2,resolved:1,open:1,persistentOpen:1,recurrent:true},
 trend:{...val.trend,status:'persistent_attestation_issue'}};
assert.ok(ctx.view(ongoing).includes('Atestação com problema persistente'));
assert.ok(ctx.view({...val,trend:{...val.trend,status:'recurrent_attestation_issue'}})
 .includes('Episódios recorrentes de atestação'));
const invalid=[
 {...val,valid:false},
 {...val,trend:{...val.trend,coveragePercentage:100}},
 {...val,last24h:{...val.last24h,scheduledSuccesses:-1}},
 {...val,last24h:{...val.last24h,observedSlots:3}},
 {...val,last30d:{...val.last30d,resolved:2}},
 {...val,monitor:{...val.monitor,status:'script_injection'}},
 {...val,noOutageClaim:false}
];
for(const x of invalid){
 assert.ok(ctx.view(x).includes('indisponíveis ou inconsistentes'),
   'Untrusted trend response must fail closed');
}
const quiet={incidents:{valid:true,open:0,critical:0,high:0},
 support:{available:false},finance:{available:false},capture:{available:false},
 portals:{available:true,valid:true,verified:true}};
const modeled=ctx.model({...quiet,publicationTrends:{available:true,valid:false}});
assert.ok(modeled.unavailable.includes('Tendências da atestação'));
assert.equal(modeled.alerts.length,0,'Missing analytics cannot invent outage');
assert.ok(!extract('adminPublicationTrendView').includes('adminPerform('));
assert.ok(!extract('adminPublicationTrendView').includes('adminInvoke('));
new vm.Script(ui,{filename:'admin.js'});
console.log('V1.224 PASS — cron-proven samples, incomplete data stays unverified, role-scoped SQL, no invented uptime, safe trend UI.');

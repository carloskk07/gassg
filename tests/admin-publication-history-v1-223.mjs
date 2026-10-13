import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013190000_portal_attestation_history_v1_223.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin.js');
const workflow=read('.github/workflows/audit.yml');

for(const name of ['portal_attestation_episodes_v1_223',
  'portal_attestation_state_v1_223','portal_attestation_observations_v1_223',
  'record_portal_attestation_history_v1_223',
  'admin_portal_attestation_history_v1_223']){
  assert.ok(sql.includes(name),'Missing historical structure '+name);
}
assert.match(sql,/unique index if not exists portal_episode_one_open_v1_223/);
assert.match(sql,/where resolved_at is null;/);
assert.match(sql,/where slot_at=v_slot/);
assert.match(sql,/pg_advisory_xact_lock\(184223,223\)/);
assert.match(sql,/session_user<>'postgres'/);
assert.match(sql,/security invoker/);
assert.match(sql,/security definer/);
assert.match(sql,/set search_path=pg_catalog/);
assert.match(sql,/grant execute on function public\.admin_portal_attestation_history_v1_223\(uuid\)\s+to service_role;/);
assert.match(sql,/revoke all on function public\.admin_portal_attestation_history_v1_223\(uuid\)\s+from public,anon,authenticated;/);
assert.match(sql,/revoke all on function tamao_internal\.record_portal_attestation_history_v1_223\(\)\s+from public,anon,authenticated,service_role;/);
assert.match(sql,/and a\.admin_role in \('superadmin','operations','readonly'\)/);
assert.match(sql,/v_att\.verified_at<v_now-interval '60 minutes'/);
assert.match(sql,/v_sha<>v_att\.source_sha/);
assert.match(sql,/v_next:='unknown';v_reason:='SOURCE_UNVERIFIED'/);
assert.match(sql,/v_next='clear' and v_episode is not null and v_proof/);
assert.match(sql,/recovered_attestation_id=v_att\.id/);
assert.match(sql,/jobname='tamao-portal-attestation-history-v1-223'/);
assert.match(sql,/'53 \* \* \* \*'/);
assert.match(sql,/when v_now-v_state\.checked_at>interval '90 minutes' then 'stale'/);
assert.match(sql,/noOutageClaim',true/);
assert.match(sql,/scope','oidc_freshness_not_site_uptime'/);
assert.match(sql,/from tamao_internal\.portal_attestation_episodes_v1_223\s+order by opened_at desc,id desc limit 12/);
assert.ok(!sql.includes('net.http_post')&&!sql.includes('commerce_enabled=true'));

assert.ok(edge.includes('admin.rpc("admin_portal_attestation_history_v1_223"'));
assert.ok(edge.includes('p_actor_user_id:actorId'));
assert.ok(edge.includes('publicationHistory={available:true,valid:false}'));
assert.ok(edge.includes('groups:{incidents,support,finance,capture,portals,publication,publicationHistory,publicationTrends,publicationMonitor}'));
assert.ok(ui.includes('adminPublicationEpisodeHistoryView(present?.rawPublicationHistory)'));
assert.ok(ui.includes('Histórico de provas de publicação'));
assert.ok(ui.includes('histórico de publicação não comprovado')||
          ui.includes('Histórico de publicação não comprovado'));
assert.ok(workflow.includes('node tests/admin-publication-history-v1-223.mjs'));
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const extract=name=>{
 const start=ui.indexOf('function '+name+'(');
 const end=ui.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,name+' not found');
 return ui.slice(start,end+2);
};
const vmx=vm.createContext({Date,Number,Array,Math,Set,esc});
vm.runInContext([extract('adminOperationalAlertHistoryDate'),
 extract('adminPublicationEpisodeHistoryView'),
 extract('adminOperationalAlertModel'),extract('adminOperationalAlertTriage')].join('\n')+
 '\nthis.view=adminPublicationEpisodeHistoryView;this.model=adminOperationalAlertModel;'+
 'this.triage=adminOperationalAlertTriage;',vmx);
const t=new Date().toISOString(),resolvedAt=new Date(Date.now()-30*60000).toISOString();
const openedAt=new Date(Date.now()-50*60000).toISOString();
const history={available:true,valid:true,noOutageClaim:true,
  monitor:{status:'current',checkedAt:t},
  state:{status:'clear'},
  episodes:[{id:1,openedAt,lastObservedAt:resolvedAt,resolvedAt,latestReason:'OIDC_EXPIRED',
   observations:3,recoveredByOidc:true},
   {id:2,openedAt:new Date(Date.now()-60*60000).toISOString(),
    lastObservedAt:new Date(Date.now()-10*60000).toISOString(),resolvedAt:null,
    latestReason:'SOURCE_SHA_MISMATCH',observations:2,recoveredByOidc:false}]
};
const display=vmx.view(history);
assert.ok(display.includes('Atestação recuperada por nova prova OIDC'));
assert.ok(display.includes('Atestação sem normalização registrada'));
assert.ok(display.includes('min entre observações'));
assert.ok(display.includes('não é uma medição de indisponibilidade'));
assert.ok(vmx.view({available:true,valid:false}).includes('não comprovado'));
assert.ok(vmx.view({...history,monitor:{status:'stale',checkedAt:t}}).includes('Monitor sem confirmação atual'));
assert.ok(vmx.view({...history,episodes:[{...history.episodes[0],latestReason:'<img onerror=alert(1)>'}]}).includes('&lt;img'));
assert.ok(!vmx.view({...history,episodes:[{...history.episodes[0],recoveredByOidc:false}]}).includes('Atestação recuperada por nova prova OIDC'));
assert.ok(vmx.view({...history,episodes:[]}).includes('Nenhum episódio foi registrado'));
const quiet={incidents:{valid:true,open:0,critical:0,high:0},finance:{available:false},
 support:{available:false},capture:{available:false},portals:{available:true,valid:true,verified:true}};
const pub={available:true,valid:true,status:'attention',guidance:[],
 recurrence:null,recovery:{verified:false,historicalRestorationProven:false}};
const model=vmx.model({...quiet,publication:pub,publicationHistory:history});
assert.equal(model.alerts.length,1);
assert.equal(model.alerts[0].publication.history.valid,true);
const ranked=vmx.triage(model.alerts,null,t);
assert.ok(ranked[0].triage.reasons.some(x=>x.includes('episódios de prova OIDC vencida')));
const untrusted=vmx.model({...quiet,publication:pub,
 publicationHistory:{available:true,valid:false}});
assert.ok(untrusted.unavailable.includes('Histórico de atestação dos portais'));
assert.ok(!extract('adminPublicationEpisodeHistoryView').includes('adminPerform('));
assert.ok(!extract('adminPublicationEpisodeHistoryView').includes('adminInvoke('));
new vm.Script(ui,{filename:'admin.js'});
console.log('V1.223 PASS — private cron, OIDC-only provenance, one episode/slot, evidence-based closure, safe admin history and recurrence.');

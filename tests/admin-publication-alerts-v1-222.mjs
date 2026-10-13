import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publicationSummary,publicationAlertInsight} from '../supabase/functions/admin-ops/publication-health.js';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const audit=read('.github/workflows/audit.yml');
const sha='a'.repeat(40),other='b'.repeat(40);
const checkedAt='2026-10-13T14:45:00.000Z';
const wf=['TAMÃO Cloudflare official production deploy','TAMÃO launch readiness'];
const portals=['customer','merchant','admin'].map(role=>({role,ok:true,sourceSha:sha}));
const baseRuns=wf.map((name,i)=>({name,id:1000+i,head_sha:sha,head_branch:'main',
  head_repository:{full_name:'carloskk07/gassg'},event:'push',
  status:'completed',conclusion:'success',created_at:'2026-10-13T13:00:00Z',
  updated_at:'2026-10-13T13:10:00Z'}));
const base={headSha:sha,runs:baseRuns,portals:{ok:true,probes:portals},
  readiness:{portalsFresh:true,portalsSourceSha:sha},
  attestation:{source_sha:sha,attestation_source:'github_oidc_edge',run_id:220,run_attempt:1,verified_at:checkedAt},
  githubError:null,checkedAt};
const summarize=overrides=>publicationSummary({...base,...overrides});
const healthy=summarize({});
let insight=publicationAlertInsight(healthy,baseRuns,checkedAt);
assert.equal(insight.valid,true);
assert.equal(insight.failedRuns,0);
assert.equal(insight.recurrent,false);
assert.equal(insight.resolutionState,'current_conformity');
assert.equal(insight.historicalResolutionProven,false);
const failure=(id,name=wf[0],additional={})=>({
  ...baseRuns[0],id,name,conclusion:'failure',
  updated_at:'2026-10-13T13:08:00Z',...additional
});
const history=[...baseRuns,failure(101),failure(102),
  failure(102,wf[0],{updated_at:'2026-10-13T13:09:00Z'}), // same run, deduplicate
  failure(103,wf[0],{head_sha:other}),
  failure(104,wf[0],{head_repository:{full_name:'evil/fork'}}),
  failure(105,wf[0],{updated_at:'2026-09-10T13:08:00Z'}),
  failure(106,'Unrecognized workflow'),
  failure(107,wf[0],{status:'in_progress'}),
  failure(108,wf[0],{updated_at:'invalid'})
];
insight=publicationAlertInsight(healthy,history,checkedAt);
assert.equal(insight.failedRuns,2,'Same-run retries, other SHAs/repos, stale and invalid runs ignored');
assert.equal(insight.recurrent,true);
assert.equal(insight.lastFailureFollowedBySuccess,true);
assert.equal(insight.historicalResolutionProven,false,'Workflow timing is not full portal incident resolution');
assert.equal(publicationAlertInsight(summarize({headSha:null,githubError:'unavailable'}),history,checkedAt).valid,false);
assert.equal(publicationAlertInsight(healthy,null,checkedAt).valid,false);
const degraded=summarize({portals:{probes:portals.map((p,i)=>i===2?{...p,ok:false,sourceSha:null}:p)}});
assert.equal(publicationAlertInsight(degraded,history,checkedAt).resolutionState,'requires_review');

const extract=name=>{
 const start=source.indexOf('function '+name+'(');
 const end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'Missing '+name);
 return source.slice(start,end+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'","&#39;");
const sandbox=vm.createContext({esc,Date,Number,Object,Array,Set,String,Math});
vm.runInContext(['adminOperationalAlertModel','adminOperationalAlertTriage'].map(extract).join('\n')+
  '\nthis.model=adminOperationalAlertModel;this.triage=adminOperationalAlertTriage;',sandbox);
const quiet={incidents:{valid:true,open:0,critical:0,high:0},
  finance:{available:false},support:{available:false},capture:{available:false},
  portals:{available:true,valid:true,verified:true}};
let model=sandbox.model({...quiet,publication:{available:true,valid:true,status:'healthy',
  guidance:[],recurrence:publicationAlertInsight(healthy,baseRuns,checkedAt),
  recovery:{verified:true,historicalRestorationProven:false}}});
assert.equal(model.alerts.length,0);
const pub=(snap,runs,flags={})=>({
 available:true,valid:true,status:snap.status,guidance:snap.guidance,
 recurrence:publicationAlertInsight(snap,runs,checkedAt),
 recovery:snap.recovery,...flags});
model=sandbox.model({...quiet,portals:{available:true,valid:true,verified:false},
  publication:pub(degraded,history)});
assert.equal(model.alerts.length,1,'No duplicate legacy portal alert');
assert.equal(model.alerts[0].id,'portals');
assert.equal(model.alerts[0].severity,'high');
assert.equal(model.alerts[0].target,'system');
assert.ok(model.alerts[0].publication);
let triage=sandbox.triage(model.alerts,null,checkedAt);
assert.equal(triage.length,1);
assert.equal(triage[0].triage.priority,'immediate','Recurrent verified failures increase priority');
assert.ok(triage[0].triage.reasons.some(s=>s.includes('Reincidência')));
let unavailable=sandbox.model({...quiet,publication:{available:true,valid:false}});
assert.ok(unavailable.unavailable.includes('Saúde da publicação'));
assert.equal(unavailable.alerts.length,0,'An unavailable modern proof does not fabricate an outage');
let checking=sandbox.model({...quiet,publication:pub(summarize({runs:baseRuns.map((r,i)=>i===0?{...r,status:'in_progress',conclusion:null}:r)}),baseRuns)});
assert.equal(checking.alerts.length,1);
assert.equal(checking.alerts[0].severity,'medium','In-progress workflow should not imply outage');
const unknown=sandbox.model({...quiet,publication:pub(summarize({headSha:null,githubError:'unavailable'}),[])});
assert.equal(unknown.alerts.length,1);
assert.equal(unknown.alerts[0].severity,'medium','Unavailable API should not imply downtime');
assert.equal(sandbox.model({...quiet}).alerts.length,0,'Legacy source continues to work');

assert.ok(edge.includes('publicationAlertInsight(current,github.runs,checkedAt)'));
assert.ok(edge.includes('groups:{incidents,support,finance,capture,portals,publication}'));
assert.ok(edge.includes('if(portalRole)tasks.push('),'Limited roles only');
assert.ok(edge.includes('admin.from("platform_portal_attestations")'));
assert.ok(edge.includes('admin.rpc("platform_launch_readiness")'));
assert.ok(source.includes("adminOperationalAlertsOpen('${item.target}')"));
assert.ok(source.includes("esc(g.action)"));
assert.ok(source.includes("esc(g.impact)"));
assert.ok(source.includes('Histórico de reincidência indisponível'));
assert.ok(source.includes("score+=16"));
assert.ok(!extract('adminOperationalAlertModel').includes('adminPerform('));
assert.ok(!extract('adminOperationalAlertsView').includes('adminPerform('));
assert.ok(audit.includes('node tests/admin-publication-alerts-v1-222.mjs'));
new vm.Script(source,{filename:'admin.js'});
console.log('V1.222 PASS — deduplicated portal alert, main-only history, valid recurrence, fail-closed state, priority, no writes.');

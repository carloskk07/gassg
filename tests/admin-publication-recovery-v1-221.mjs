import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publicationSummary} from '../supabase/functions/admin-ops/publication-health.js';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const workflow=read('.github/workflows/audit.yml');
const sha='a'.repeat(40),older='b'.repeat(40);
const checkedAt='2026-10-13T14:30:00.000Z';
const probes=['customer','merchant','admin'].map(role=>({role,ok:true,sourceSha:sha}));
const names=['TAMÃO Cloudflare official production deploy','TAMÃO launch readiness'];
const runs=names.map((name,i)=>({name,id:2500+i,head_sha:sha,head_branch:'main',
  head_repository:{full_name:'carloskk07/gassg'},status:'completed',conclusion:'success',
  created_at:checkedAt,event:'push'}));
const snapshot={
 headSha:sha,runs,portals:{ok:true,sourceSha:sha,probes},
 readiness:{portalsFresh:true,portalsSourceSha:sha},
 attestation:{source_sha:sha,attestation_source:'github_oidc_edge',run_id:6201,
   run_attempt:1,verified_at:checkedAt},checkedAt,githubError:null
};
const check=overrides=>publicationSummary({...snapshot,...overrides});
const healthy=check({});
assert.equal(healthy.status,'healthy');
assert.equal(healthy.recovery.verified,true);
assert.equal(healthy.recovery.historicalRestorationProven,false,
  'A snapshot is not a historical timeline of incident resolution');
assert.deepEqual(healthy.recovery.checks.map(x=>x.id),['github','cloudflare','oidc','workflows']);
assert.ok(healthy.recovery.checks.every(x=>x.ok===true));
assert.equal(healthy.guidance.length,0);
assert.equal(healthy.readOnly,true);
const cases=[
 {code:'GITHUB_SOURCE_UNAVAILABLE',kind:'unverified',
  state:{headSha:null,githubError:'RATE_LIMIT'}},
 {code:'PORTAL_EVIDENCE_INCOMPLETE',kind:'attention',
  state:{portals:{probes:[...probes.slice(0,2),{role:'admin',ok:false,sourceSha:null}]}}},
 {code:'PORTAL_VERSION_SPLIT',kind:'attention',
  state:{portals:{probes:probes.map((p,i)=>i===2?{...p,sourceSha:older}:p)}}},
 {code:'PORTAL_VERSION_BEHIND',kind:'attention',
  state:{portals:{probes:probes.map(p=>({...p,sourceSha:older}))}}},
 {code:'OIDC_ATTESTATION_NOT_VERIFIED',kind:'attention',
  state:{attestation:{...snapshot.attestation,verified_at:'2026-10-13T11:00:00.000Z'}}},
 {code:'OIDC_ATTESTATION_NOT_VERIFIED',kind:'attention',
  state:{attestation:{...snapshot.attestation,source_sha:older}}},
 {code:'OIDC_ATTESTATION_NOT_VERIFIED',kind:'attention',
  state:{attestation:{...snapshot.attestation,attestation_source:'manual'}}},
 {code:'OIDC_ATTESTATION_NOT_VERIFIED',kind:'attention',
  state:{readiness:{portalsFresh:false,portalsSourceSha:sha}}},
 {code:'GITHUB_WORKFLOW_FAILED',kind:'attention',
  state:{runs:runs.map((r,i)=>i?{...r,conclusion:'failure'}:r)}},
 {code:'GITHUB_WORKFLOW_RUNNING',kind:'checking',
  state:{runs:runs.map((r,i)=>i?{...r,status:'in_progress',conclusion:null}:r)}},
 {code:'GITHUB_WORKFLOW_UNVERIFIED',kind:'unverified',
  state:{runs:[]}}
];
for(const test of cases){
 const res=check(test.state);
 assert.equal(res.status,test.kind,'Wrong classification for '+test.code);
 assert.ok(res.guidance.some(g=>g.code===test.code),'Missing guided action: '+test.code);
 assert.equal(res.recovery.verified,false,'No false recovery after '+test.code);
 assert.ok(res.recovery.checks.some(x=>x.ok===false),'At least one proof must fail');
 for(const guidance of res.guidance){
   for(const key of ['problem','impact','action','recoveryCriteria'])
     assert.ok(typeof guidance[key]==='string'&&guidance[key].length>20,
       'Human readable '+key+' missing for '+guidance.code);
   assert.equal(guidance.requiresHumanReview,true,'Never auto-execute sensitive repairs');
 }
}
const invalidOidc=check({attestation:{...snapshot.attestation,run_id:'Infinity'}});
assert.equal(invalidOidc.recovery.verified,false,'Malformed OIDC provenance never passes');
const injection=check({portals:{probes:[...probes.slice(0,2),{role:'admin',ok:false,sourceSha:null}]}});
injection.guidance[0].problem='<img src=x onerror=alert(1)>';
const escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const from=source.indexOf('function adminPublicationRecoveryView(');
const until=source.indexOf('function adminSystemHealthView(',from);
assert.ok(from>=0&&until>from);
const extract=source.slice(from,until);
const ctxt=vm.createContext({esc:escapeHtml,formatDateTime:value=>value});
vm.runInContext(extract+'\nthis.renderPlaybook=adminPublicationRecoveryView;',ctxt);
const html=ctxt.renderPlaybook(injection);
assert.ok(html.includes('Impacto:')&&html.includes('Próxima ação:')&&html.includes('Como confirmar:'));
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!html.includes('<img src=x'));
const goodHtml=ctxt.renderPlaybook(healthy);
assert.ok(goodHtml.includes('Conformidade atual comprovada'));
assert.ok(goodHtml.includes('Não comprova quando uma falha anterior foi resolvida'));
assert.ok(!goodHtml.includes('Próxima ação:'));
assert.ok(extract.includes('adminPublicationRecoveryView(p)'));
assert.ok(edge.includes('publicationSummary({'));
assert.ok(!extract.includes('adminPerform(')&&!extract.includes('adminInvoke('));
assert.ok(workflow.includes('node tests/admin-publication-recovery-v1-221.mjs'));
new vm.Script(source,{filename:'admin.js'});
console.log('V1.221 PASS — actionable impact/action/proof; OIDC and GitHub failures never green; HTML escaped and read-only.');

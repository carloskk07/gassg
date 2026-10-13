import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publicationSummary} from '../supabase/functions/admin-ops/publication-health.js';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const backend=read('supabase/functions/admin-ops/index.ts');
const frontend=read('js/admin.js');
const audit=read('.github/workflows/audit.yml');
const sha='a'.repeat(40),old='b'.repeat(40);
const checkedAt='2026-10-13T12:45:00.000Z';
const probes=['customer','merchant','admin'].map(role=>({role,ok:true,sourceSha:sha}));
const runs=['TAMÃO Cloudflare official production deploy','TAMÃO launch readiness'].map((name,i)=>({
 name,id:300+i,head_sha:sha,head_branch:'main',head_repository:{full_name:'carloskk07/gassg'},
 status:'completed',conclusion:'success',created_at:checkedAt,event:'push'
}));
const good={
 headSha:sha,runs,portals:{ok:true,sourceSha:sha,probes},githubError:null,
 readiness:{portalsFresh:true,portalsSourceSha:sha},
 attestation:{source_sha:sha,attestation_source:'github_oidc_edge',run_id:555,run_attempt:1,verified_at:checkedAt},
 checkedAt
};
const check=overrides=>publicationSummary({...good,...overrides});
assert.equal(check({}).status,'healthy');
assert.equal(check({}).issues.length,0);
assert.equal(check({}).readOnly,true);
assert.equal(check({}).workflows.length,2);
assert.equal(check({headSha:null,githubError:'GITHUB_EVIDENCE_UNAVAILABLE'}).status,'unverified');
assert.equal(check({portals:{probes:[...probes.slice(0,2),{role:'admin',ok:false,sourceSha:null}]}}).status,'attention');
assert.equal(check({portals:{probes:probes.map((p,i)=>i===1?{...p,sourceSha:old}:p)}}).status,'attention');
assert.equal(check({portals:{probes:probes.map(p=>({...p,sourceSha:old}))}}).status,'attention');
assert.equal(check({readiness:{portalsFresh:false,portalsSourceSha:sha}}).status,'attention');
assert.equal(check({readiness:{portalsFresh:true,portalsSourceSha:old}}).status,'attention');
assert.equal(check({attestation:{...good.attestation,source_sha:old}}).status,'attention');
assert.equal(check({attestation:{...good.attestation,attestation_source:'manual'}}).status,'attention');
assert.equal(check({attestation:{...good.attestation,verified_at:'2026-10-13T10:00:00Z'}}).status,'attention');
assert.equal(check({attestation:null}).status,'attention');
assert.equal(check({runs:[]}).status,'unverified');
assert.equal(check({runs:runs.map((r,i)=>i?{...r,conclusion:'failure'}:r)}).status,'attention');
assert.equal(check({runs:runs.map((r,i)=>i?{...r,status:'in_progress',conclusion:null}:r)}).status,'checking');
assert.equal(check({runs:runs.map(r=>({...r,head_repository:{full_name:'other/repo'}}))}).status,'unverified');
assert.ok(check({}).workflows[0].url.endsWith('/300'));
assert.ok(backend.includes('publicationGithubEvidence()'));
assert.ok(backend.includes('admin.from("platform_portal_attestations")'));
assert.ok(backend.includes('publicationSummary({'));
assert.ok(backend.includes('githubError:githubPublication.error'));
assert.ok(frontend.includes('adminPublicationHealthView(h.publication)'));
assert.ok(frontend.includes('GitHub, Cloudflare e Supabase'));
assert.ok(audit.includes('node tests/admin-publication-health-v1-220.mjs'));
new vm.Script(frontend,{filename:'admin.js'});
console.log('V1.220 PASS — no false green with drift/stale/OIDC failure, GitHub run identity and frontend diagnostic.');

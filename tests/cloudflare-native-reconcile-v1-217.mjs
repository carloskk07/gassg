import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reconcileNativeDelivery} from '../scripts/reconcile-cloudflare-native-v1-217.mjs';
const src=fs.readFileSync(new URL('../scripts/reconcile-cloudflare-native-v1-217.mjs',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/cloudflare-native-reconcile.yml',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
const sha='a'.repeat(40),old='b'.repeat(40);
const evidence={
 GITHUB_EVENT_NAME:'workflow_run',EVIDENCE_REPOSITORY:'carloskk07/gassg',
 EVIDENCE_BRANCH:'main',EVIDENCE_CONCLUSION:'success',
 EVIDENCE_SHA:sha,GH_TOKEN:'secret_action_token_mock'
};
const run=(id,status,conclusion,which=sha,at='2026-10-13T08:00:00Z')=>({
 id,status,conclusion,head_sha:which,head_branch:'main',created_at:at
});
function mock({main=sha,runs=[run(72,'completed','failure')],beforePost=main,postStatus=201}={}){
 const visited=[];
 let branchCalls=0;
 const request=async(url,init)=>{
   visited.push({url,method:init.method,auth:init.headers.Authorization});
   if(url.endsWith('/branches/main')){
     branchCalls++;
     return new Response(JSON.stringify({commit:{sha:branchCalls>1?beforePost:main}}),{status:200});
   }
   if(url.includes('/actions/workflows/cloudflare-production-deploy.yml/runs?'))
     return new Response(JSON.stringify({workflow_runs:runs}),{status:200});
   if(url.includes('/rerun-failed-jobs'))
     return new Response('',{status:postStatus});
   throw new Error('Unexpected endpoint: '+url);
 };
 return {visited,request};
}
const runCheck=async(env=evidence,overrides={})=>{
 const api=mock(overrides);
 const messages=[];
 const result=await reconcileNativeDelivery({env,request:api.request,report:msg=>messages.push(msg)});
 return {result,api,messages};
};
const happy=await runCheck();
assert.equal(happy.result.status,'rerun_requested');
assert.equal(happy.result.runId,72);
assert.equal(happy.api.visited.filter(x=>x.method==='POST').length,1);
assert.ok(happy.api.visited.some(x=>x.url.endsWith('/actions/runs/72/rerun-failed-jobs')));
assert.ok(happy.api.visited.every(x=>x.auth==='Bearer '+evidence.GH_TOKEN));
assert.ok(happy.messages.some(x=>x.includes('re-queued')));
const invalid=[
 {...evidence,EVIDENCE_REPOSITORY:'attacker/fork'},
 {...evidence,EVIDENCE_BRANCH:'other'},
 {...evidence,EVIDENCE_CONCLUSION:'failure'},
 {...evidence,EVIDENCE_SHA:'../evil'},
 {...evidence,GITHUB_EVENT_NAME:'pull_request'}
];
for(const env of invalid){
 const z=await runCheck(env);
 assert.equal(z.result.status,'skipped_invalid_proof');
 assert.equal(z.api.visited.length,0,'Must not query or mutate on invalid evidence');
}
const oldMain=await runCheck(evidence,{main:old});
assert.equal(oldMain.result.status,'skipped_superseded');
assert.equal(oldMain.api.visited.length,1);
assert.equal((await runCheck(evidence,{beforePost:old})).result.status,'skipped_superseded');
assert.equal((await runCheck(evidence,{runs:[run(72,'in_progress',null)]})).result.status,'skipped_running');
assert.equal((await runCheck(evidence,{runs:[run(72,'completed','success')]})).result.status,'already_reconciled');
assert.equal((await runCheck(evidence,{runs:[run(72,'completed','cancelled')]})).result.status,'skipped_not_failed');
assert.equal((await runCheck(evidence,{runs:[]})).result.status,'no_matching_deploy');
const latestWrong=[run(100,'completed','failure',old,'2026-10-13T10:00:00Z'),
 run(101,'completed','success',sha,'2026-10-13T09:00:00Z')];
assert.equal((await runCheck(evidence,{runs:latestWrong})).result.status,'already_reconciled');
const sorted=[run(88,'completed','failure',sha,'2026-10-13T08:00:00Z'),
 run(89,'completed','success',sha,'2026-10-13T09:00:00Z')];
assert.equal((await runCheck(evidence,{runs:sorted})).result.status,'already_reconciled');
const due=[run(88,'completed','success',sha,'2026-10-13T08:00:00Z'),
 run(89,'completed','failure',sha,'2026-10-13T09:00:00Z')];
assert.equal((await runCheck(evidence,{runs:due})).result.runId,89);
await assert.rejects(runCheck({...evidence,GH_TOKEN:''}),/GITHUB_ACTIONS_TOKEN_NOT_AVAILABLE/);
await assert.rejects(runCheck(evidence,{postStatus:403}),/GITHUB_API_HTTP_403_FOR_POST/);
assert.ok(src.includes("proof.conclusion!=='success'"));
assert.ok(src.includes("canonical!==proof.sha"));
assert.ok(src.includes("now?.commit?.sha!==canonical"));
assert.ok(src.includes("latest.conclusion!=='failure'"));
assert.ok(src.includes("rerun-failed-jobs"));
assert.ok(!src.includes("wrangler")&&!src.includes("CLOUDFLARE_API_TOKEN"));
assert.ok(workflow.includes('workflow_run:'));
assert.ok(workflow.includes('workflows:\n      - TAMÃO launch readiness'));
assert.ok(workflow.includes("head_repository.full_name == 'carloskk07/gassg'"));
assert.ok(workflow.includes("github.event.workflow_run.conclusion == 'success'"));
assert.ok(workflow.includes('actions: write'));
assert.ok(!workflow.includes('pull_request:'));
assert.ok(!workflow.includes('secrets.CLOUDFLARE'));
assert.ok(!workflow.includes('wrangler'));
assert.ok(audit.includes('node tests/cloudflare-native-reconcile-v1-217.mjs'));
console.log('V1.217 PASS — hard SHA identity, strict readiness evidence, idempotent retry, no secret leak or fake success, drift and role-safe native delivery.');

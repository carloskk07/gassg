import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PortalPropagationPending,isTransientPortalHttp,
  PORTAL_PROPAGATION_DELAYS_MS,verifyPortalSetWithPropagation
} from '../supabase/functions/portal-readiness-attestor/propagation.js';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const attestor=read('supabase/functions/portal-readiness-attestor/index.ts');
const workflow=read('.github/workflows/launch-readiness.yml');
const audit=read('.github/workflows/audit.yml');
const entries=[['customer',{}],['merchant',{}],['admin',{}]];
const old='a'.repeat(40),current='b'.repeat(40);
const pending=(role='customer',stage='build',reason='STALE_SOURCE_SHA')=>
  new PortalPropagationPending(role,stage,reason);

assert.deepEqual(PORTAL_PROPAGATION_DELAYS_MS,[1500,3000]);
for(const status of [404,408,425,429,500,502,503,504])assert.equal(isTransientPortalHttp(status),true);
for(const status of [0,200,301,400,401,403,409,422,'503'])assert.equal(isTransientPortalHttp(status),false);

const calls=[],delays=[],notices=[];
let bad=true;
const recovered=await verifyPortalSetWithPropagation(entries,async role=>{
  calls.push(role);
  if(role==='customer'&&bad){bad=false;throw pending()}
  return {role,sourceSha:current};
},{
  sleep:async ms=>delays.push(ms),
  report:r=>notices.push(r)
});
assert.deepEqual(recovered.map(x=>x.role),entries.map(x=>x[0]));
assert.deepEqual(recovered.map(x=>x.sourceSha),[current,current,current]);
assert.equal(calls.filter(x=>x==='customer').length,2);
assert.deepEqual(delays,[1500]);
assert.equal(notices[0].reason,'STALE_SOURCE_SHA');

let attempts=0;
await assert.rejects(verifyPortalSetWithPropagation(entries,async role=>{
  if(role==='customer'){attempts++;throw pending(role,'build','HTTP_503')}
  return {role,sourceSha:current};
},{sleep:async ms=>delays.push(ms)}),PortalPropagationPending);
assert.equal(attempts,3,'Three complete bounded attempts, never infinite');
assert.deepEqual(delays,[1500,1500,3000]);

for(const reason of ['WRONG_ROLE','WRONG_ORIGIN','BAD_TURNSTILE','BAD_HTML','BAD_RUNTIME','OIDC_DENIED']){
  let count=0;
  await assert.rejects(verifyPortalSetWithPropagation(entries,async role=>{
    count++; if(role==='customer')throw Error(reason);
    return {role,sourceSha:current};
  },{sleep:async()=>{throw Error('MUST_NOT_SLEEP')}}),new RegExp(reason));
  assert.equal(count,3,'No additional round may happen on security drift');
}
await assert.rejects(verifyPortalSetWithPropagation([entries[0]],async()=>({})),/PORTAL_EVIDENCE_ENTRY_COUNT_INVALID/);

// Static security contract: no retry of OIDC, no bypass of the canonical SHA,
// and only a completely rechecked group may reach the privileged RPC.
assert.ok(attestor.includes('verifyGithubOidc(auth.slice("Bearer ".length))'));
assert.ok(attestor.includes('canonicalSha!==expectedSourceSha'));
assert.ok(attestor.includes('verifyPortalSetWithPropagation('));
assert.ok(attestor.includes('new PortalPropagationPending('));
assert.ok(attestor.includes('isTransientPortalHttp('));
assert.ok(attestor.indexOf('verifyPortalSetWithPropagation(')<attestor.indexOf('record_automated_portal_attestation'));
assert.ok(attestor.includes('if(latestCanonicalSha!==expectedSourceSha)'));
assert.ok(attestor.includes('if(error instanceof PortalPropagationPending)'));
assert.ok(attestor.includes('console.warn("portal-readiness-attestor propagation exhausted"'));
assert.ok(!attestor.includes('commerce_enabled=true'));
assert.ok(workflow.includes('.readiness.portalsSourceSha == $sha'));
assert.ok(audit.includes('node tests/portal-oidc-propagation-v1-219.mjs'));
console.log('V1.219 PASS — 3 bounded evidence snapshots, stale SHA and transient HTTP recovery, hard security drift blocking, OIDC/DB authority preserved.');

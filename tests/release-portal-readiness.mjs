import assert from 'node:assert/strict';
import {PORTAL_ORIGINS,inspectLivePortals} from '../scripts/release-portal-readiness.mjs';

const live='9ee0547aaaf2ac8b1ca742dab16984f025ca3548';
const candidate='39c66ecb997dc56f7a5cb6a9ae6cfd56c37b8bda';
function mockFetch({shas={},overrides={},status={},failRole=null}={}){
  return async (url,options)=>{
    assert.equal(options.redirect,'error','Never trust redirected manifest from another origin');
    assert.equal(options.method,'GET','Read-only inspection must never write');
    assert.ok(options.signal,'Every network operation needs a timeout');
    const role=Object.entries(PORTAL_ORIGINS).find(([,origin])=>url.startsWith(origin+'/'))?.[0];
    assert.ok(role,'No arbitrary caller-supplied origins');
    if(role===failRole)throw new Error('DNS unavailable');
    const manifest={
      schemaVersion:1,portalRole:role,
      sourceSha:shas[role]||live,
      customerOrigin:PORTAL_ORIGINS.customer,
      merchantOrigin:PORTAL_ORIGINS.merchant,
      adminOrigin:PORTAL_ORIGINS.admin,
      ...(overrides[role]||{})
    };
    return {ok:(status[role]||200)===200,status:status[role]||200,
      text:async()=>JSON.stringify(manifest)};
  };
}
const passing=await inspectLivePortals({fetcher:mockFetch(),candidateSha:candidate,expectedLiveSha:live});
assert.equal(passing.ok,true);
assert.equal(passing.result,'LIVE_BASELINE_SYNCED_RELEASE_NOT_DEPLOYED');
assert.equal(passing.liveSha,live);
assert.equal(passing.releaseAlreadyDeployed,false);
assert.deepEqual(passing.portals.map(p=>p.role),['customer','merchant','admin']);
assert.deepEqual(passing.errors,[]);

const divergence=await inspectLivePortals({
 fetcher:mockFetch({shas:{merchant:candidate}}),candidateSha:candidate
});
assert.equal(divergence.ok,false);
assert.ok(divergence.errors.some(x=>x.includes('Different deployed Git SHAs')));
const early=await inspectLivePortals({fetcher:mockFetch({shas:{
 customer:candidate,merchant:candidate,admin:candidate
}}),candidateSha:candidate});
assert.equal(early.ok,false);
assert.equal(early.releaseAlreadyDeployed,true);
assert.ok(early.errors.some(x=>x.includes('unexpectedly already deployed')));
const stale=await inspectLivePortals({fetcher:mockFetch(),expectedLiveSha:candidate});
assert.equal(stale.ok,false);
assert.ok(stale.errors.some(x=>x.includes('expected stable main')));
const missing=await inspectLivePortals({fetcher:mockFetch({failRole:'admin'}),candidateSha:candidate});
assert.equal(missing.ok,false);
assert.equal(missing.portals.find(x=>x.role==='admin').valid,false);
const wrong=await inspectLivePortals({
 fetcher:mockFetch({overrides:{merchant:{portalRole:'customer'}}})
});
assert.equal(wrong.ok,false);
assert.ok(wrong.errors.some(x=>x.startsWith('merchant: Wrong portal role')));
const wrongOrigin=await inspectLivePortals({
 fetcher:mockFetch({overrides:{admin:{merchantOrigin:'https://other.example'}}})
});
assert.equal(wrongOrigin.ok,false);
assert.ok(wrongOrigin.errors.some(x=>x.includes('Incorrect merchantOrigin')));
const invalid=await inspectLivePortals({fetcher:mockFetch({status:{customer:503}})});
assert.equal(invalid.ok,false);
assert.ok(invalid.errors.some(x=>x.includes('HTTP 503')));
await assert.rejects(
 ()=>inspectLivePortals({candidateSha:'not-a-sha',fetcher:mockFetch()}),
 /40-character Git SHA/
);
console.log('Release readiness: live three-portal SHA equality, baseline match, candidate not deployed, role/origin/source validation and fail-closed errors passed.');

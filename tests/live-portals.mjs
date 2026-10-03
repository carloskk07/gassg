import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildLivePortals,assertProductionTurnstile,assertAuthRedirectsConfirmed} from '../scripts/build-live-portals.mjs';

const origins={
  CHAMA_CUSTOMER_ORIGIN:'https://chama-sg-cliente.netlify.app',
  CHAMA_MERCHANT_ORIGIN:'https://chama-sg-revenda.netlify.app',
  CHAMA_ADMIN_ORIGIN:'https://chama-sg-admin.netlify.app'
};
const releaseEnv={
  ...origins,
  CHAMA_AUTH_REDIRECTS_CONFIRMED:'1'
};
const testKey='1x00000000000000000000AA';

assert.throws(
  ()=>assertProductionTurnstile({...origins,CHAMA_TURNSTILE_SITE_KEY:''}),
  /required/
);
assert.throws(
  ()=>assertAuthRedirectsConfirmed(origins),
  /CHAMA_AUTH_REDIRECTS_CONFIRMED=1/
);
assert.equal(assertAuthRedirectsConfirmed(releaseEnv),true);
assert.throws(
  ()=>assertProductionTurnstile({...origins,CHAMA_TURNSTILE_SITE_KEY:testKey}),
  /test\/demo key/
);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'chama-live-portals-'));
const built=buildLivePortals({
  ...releaseEnv,
  CHAMA_TURNSTILE_SITE_KEY:testKey,
  CHAMA_ALLOW_TEST_TURNSTILE:'1',
  CHAMA_SOURCE_SHA:'test-sha'
},{outputRoot:root});

assert.deepEqual(built.map(x=>x.role),['customer','merchant','admin']);
for(const {role,path:dir} of built){
  assert.ok(fs.existsSync(path.join(dir,'index.html')));
  assert.ok(fs.existsSync(path.join(dir,'sw.js')));
  assert.ok(fs.existsSync(path.join(dir,'_headers')));
  assert.ok(fs.existsSync(path.join(dir,'_redirects')));
  assert.ok(!fs.existsSync(path.join(dir,'supabase')));
  assert.ok(!fs.existsSync(path.join(dir,'tests')));
  assert.ok(!fs.existsSync(path.join(dir,'scripts')));

  const runtime=fs.readFileSync(path.join(dir,'js','runtime-config.js'),'utf8');
  assert.ok(runtime.includes('globalThis.CHAMA_PORTAL_ROLE='+JSON.stringify(role)+';'));
  for(const origin of Object.values(origins))assert.ok(runtime.includes(origin));

  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  assert.ok(html.includes('data-chama-portal="'+role+'"'));

  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');

  const metadata=JSON.parse(fs.readFileSync(path.join(dir,'portal-build.json'),'utf8'));
  assert.equal(metadata.portalRole,role);
  assert.equal(metadata.sourceSha,'test-sha');
}

const releaseManifest=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
assert.equal(releaseManifest.schemaVersion,1);
assert.equal(releaseManifest.sourceSha,'test-sha');
assert.equal(releaseManifest.supabaseAuth.siteUrl,'https://chama-sg-cliente.netlify.app/');
assert.deepEqual(
  releaseManifest.supabaseAuth.additionalRedirectUrls,
  ['https://chama-sg-revenda.netlify.app/','https://chama-sg-admin.netlify.app/']
);
for(const role of ['customer','merchant','admin']){
  const entry=releaseManifest.portals[role];
  assert.match(entry.bundleSha256,/^[0-9a-f]{64}$/);
  assert.ok(entry.fileCount>5);
  assert.ok(entry.bytes>1000);
  assert.ok(entry.netlifySiteId);
}

fs.rmSync(root,{recursive:true,force:true});
console.log('Live portal bundles contract passou.');

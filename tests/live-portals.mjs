import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildLivePortals,assertProductionTurnstile} from '../scripts/build-live-portals.mjs';
import {buildCloudflarePortal,CLOUDFLARE_PROJECTS,PUBLIC_TURNSTILE_SITE_KEY} from '../scripts/build-cloudflare-portal.mjs';

const origins={
  CHAMA_CUSTOMER_ORIGIN:'https://tamao.com.br',
  CHAMA_MERCHANT_ORIGIN:'https://parceiro.tamao.com.br',
  CHAMA_ADMIN_ORIGIN:'https://admin.tamao.com.br'
};
const testKey='1x00000000000000000000AA';

assert.throws(
  ()=>assertProductionTurnstile({...origins,CHAMA_TURNSTILE_SITE_KEY:''}),
  /required/
);
assert.throws(
  ()=>assertProductionTurnstile({...origins,CHAMA_TURNSTILE_SITE_KEY:testKey}),
  /test\/demo key/
);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'chama-live-portals-'));
const built=buildLivePortals({
  ...origins,
  CHAMA_TURNSTILE_SITE_KEY:testKey,
  CHAMA_ALLOW_TEST_TURNSTILE:'1',
  CHAMA_SOURCE_SHA:'test-sha'
},{outputRoot:root});

assert.deepEqual(built.map(x=>x.role),['customer','merchant','admin']);
for(const {role,path:dir} of built){
  assert.ok(fs.existsSync(path.join(dir,'index.html')));
  assert.ok(fs.existsSync(path.join(dir,'sw.js')));
  const sw=fs.readFileSync(path.join(dir,'sw.js'),'utf8');
  assert.ok(sw.includes('tamao-sg-test-sha'),'service worker precisa versionar cache pelo sourceSha do bundle');
  assert.ok(fs.existsSync(path.join(dir,'robots.txt')));
  const robots=fs.readFileSync(path.join(dir,'robots.txt'),'utf8');
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const headers=fs.readFileSync(path.join(dir,'_headers'),'utf8');
  if(role==='customer'){
    assert.match(robots,/Allow:\s*\//);
    assert.ok(fs.existsSync(path.join(dir,'sitemap.xml')));
    assert.ok(html.includes('name="robots" content="index,follow,max-image-preview:large"'));
    assert.ok(!headers.includes('X-Robots-Tag: noindex'));
  }else{
    assert.match(robots,/Disallow:\s*\//);
    assert.ok(html.includes('name="robots" content="noindex,nofollow,noarchive,nosnippet"'));
    assert.ok(headers.includes('X-Robots-Tag: noindex'));
  }
  assert.ok(fs.existsSync(path.join(dir,'_headers')));
  assert.ok(fs.existsSync(path.join(dir,'_redirects')));
  assert.ok(!fs.existsSync(path.join(dir,'supabase')));
  assert.ok(!fs.existsSync(path.join(dir,'tests')));
  assert.ok(!fs.existsSync(path.join(dir,'scripts')));

  const runtime=fs.readFileSync(path.join(dir,'js','runtime-config.js'),'utf8');
  assert.ok(runtime.includes('globalThis.CHAMA_PORTAL_ROLE='+JSON.stringify(role)+';'));
  for(const origin of Object.values(origins))assert.ok(runtime.includes(origin));

  assert.ok(html.includes('data-chama-portal="'+role+'"'));

  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');

  const metadata=JSON.parse(fs.readFileSync(path.join(dir,'portal-build.json'),'utf8'));
  assert.equal(metadata.portalRole,role);
  assert.equal(metadata.sourceSha,'test-sha');
}

const cfRoot=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-cloudflare-portals-'));
for(const [projectName,cfg] of Object.entries(CLOUDFLARE_PROJECTS)){
  const outRoot=path.join(cfRoot,projectName,'build');
  const publishDir=path.join(cfRoot,projectName,'publish');
  const result=buildCloudflarePortal({
    CHAMA_CLOUDFLARE_PROJECT:projectName,
    CHAMA_SOURCE_SHA:'1234567890123456789012345678901234567890'
  },{outputRoot:outRoot,publishDir});
  assert.equal(result.role,cfg.role);
  assert.equal(result.projectName,projectName);
  const meta=JSON.parse(fs.readFileSync(path.join(publishDir,'portal-build.json'),'utf8'));
  assert.equal(meta.portalRole,cfg.role);
  assert.equal(meta.customerOrigin,CLOUDFLARE_PROJECTS['tamao-sg-cliente'].origin);
  assert.equal(meta.merchantOrigin,CLOUDFLARE_PROJECTS['tamao-sg-revenda'].origin);
  assert.equal(meta.adminOrigin,CLOUDFLARE_PROJECTS['tamao-sg-admin'].origin);
  const runtime=fs.readFileSync(path.join(publishDir,'js','runtime-config.js'),'utf8');
  assert.ok(runtime.includes(PUBLIC_TURNSTILE_SITE_KEY));
}
fs.rmSync(root,{recursive:true,force:true});
fs.rmSync(cfRoot,{recursive:true,force:true});
console.log('Live + Cloudflare portal bundles contract passou.');

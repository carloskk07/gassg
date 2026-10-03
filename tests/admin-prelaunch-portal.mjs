import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildAdminPrelaunchPortal} from '../scripts/build-admin-prelaunch.mjs';

const env={
  CHAMA_CUSTOMER_ORIGIN:'https://chama-sg-cliente.netlify.app',
  CHAMA_MERCHANT_ORIGIN:'https://chama-sg-revenda.netlify.app',
  CHAMA_ADMIN_ORIGIN:'https://chama-sg-admin.netlify.app',
  CHAMA_TURNSTILE_SITE_KEY:'',
  CHAMA_SOURCE_SHA:'prelaunch-admin-test'
};

const root=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-admin-prelaunch-'));
const result=buildAdminPrelaunchPortal(env,{outputDir:root});
assert.equal(result.role,'admin');

for(const file of ['index.html','manifest.webmanifest','sw.js','_headers','_redirects','portal-build.json','js/runtime-config.js']){
  assert.ok(fs.existsSync(path.join(root,file)),file+' ausente');
}
for(const forbidden of ['supabase','tests','scripts','.github']){
  assert.ok(!fs.existsSync(path.join(root,forbidden)),forbidden+' não pode sair no bundle');
}

const runtime=fs.readFileSync(path.join(root,'js','runtime-config.js'),'utf8');
assert.ok(runtime.includes('globalThis.CHAMA_PORTAL_ROLE="admin";'));
assert.ok(runtime.includes('globalThis.CHAMA_TURNSTILE_SITE_KEY="";'));
assert.ok(runtime.includes(env.CHAMA_ADMIN_ORIGIN));

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.ok(html.includes('data-chama-portal="admin"'));
assert.ok(html.includes('TAMÃO Admin — Controle'));

const metadata=JSON.parse(fs.readFileSync(path.join(root,'portal-build.json'),'utf8'));
assert.equal(metadata.schemaVersion,1);
assert.equal(metadata.portalRole,'admin');
assert.equal(metadata.deploymentProfile,'prelaunch-admin');
assert.equal(metadata.sourceSha,'prelaunch-admin-test');
assert.equal(metadata.turnstileConfigured,false);

fs.rmSync(root,{recursive:true,force:true});
console.log('Admin prelaunch portal contract passou.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import {buildLivePortals,assertProductionTurnstile,validateClassicScriptSyntax,splitAdminAcquisition,splitAdminOwnerFinanceCore,compactReleasedCssComments,compactReleasedGrowthComments} from '../scripts/build-live-portals.mjs';
import {buildCloudflarePortal,CLOUDFLARE_PROJECTS,PUBLIC_TURNSTILE_SITE_KEY} from '../scripts/build-cloudflare-portal.mjs';
import {stripAdminOnlyCss,publicAdminClassReferences} from '../scripts/strip-admin-css.mjs';

const origins={
  CHAMA_CUSTOMER_ORIGIN:'https://tamao.com.br',
  CHAMA_MERCHANT_ORIGIN:'https://parceiro.tamao.com.br',
  CHAMA_ADMIN_ORIGIN:'https://admin.tamao.com.br'
};
const testKey='1x00000000000000000000AA';
const originalComponents=fs.readFileSync(new URL('../css/components.css',import.meta.url),'utf8');
const originalAcquisition=fs.readFileSync(new URL('../js/admin-acquisition.js',import.meta.url),'utf8');
const splitAcquisition=splitAdminAcquisition(originalAcquisition);
const splitOwnerFinance=splitAdminOwnerFinanceCore(splitAcquisition.core);
assert.equal(splitOwnerFinance.prefix+splitOwnerFinance.ownerFinance+splitOwnerFinance.leads,splitAcquisition.core);
assert.ok(splitAcquisition.expansion.length>90000,'Expansion chunk size unexpectedly small');
assert.equal(splitAcquisition.core+splitAcquisition.expansion,originalAcquisition,'Byte-for-byte source parity');
const sharedAdminClasses=publicAdminClassReferences(new URL('../js',import.meta.url));
assert.ok(sharedAdminClasses.has('admin-entity-grid'),'Merchant shared class needs explicit preservation');
const optimizedComponents=stripAdminOnlyCss(originalComponents,{sharedAdminClasses});
assert.ok(optimizedComponents.removedRules>500,'Expected meaningful admin-only CSS isolation');
assert.ok(optimizedComponents.removedBytes>65000,'Expected at least 65KB of safe CSS removal');
assert.ok(optimizedComponents.css.includes('.admin-entity-grid{'),'Merchant shared admin component must survive');
assert.ok(!optimizedComponents.css.includes('.admin-sidebar{'),'Admin sidebar must be absent from public bundles');
assert.doesNotThrow(()=>validateClassicScriptSyntax('const valid = 1;','valid.js'));
assert.throws(()=>validateClassicScriptSyntax("const invalid = ;",'invalid.js'),SyntaxError,
  'Cloudflare bundle compilation must fail on an invalid public script');

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
  const expansionPath=path.join(dir,'js','admin-expansion.js');
  const ownerPath=path.join(dir,'js','admin-owner-finance.js');
  assert.equal(fs.existsSync(ownerPath),role==='admin',role+' must isolate privileged owner finance');
  assert.equal(fs.existsSync(expansionPath),role==='admin',role+' should isolate expansion chunk');
  if(role==='admin'){
    assert.equal(fs.readFileSync(path.join(dir,'js','admin-acquisition.js'),'utf8'),splitOwnerFinance.startup,
      'The admin core must be exactly the original prefix');
    assert.equal(fs.readFileSync(expansionPath,'utf8'),splitAcquisition.expansion,
      'The deferred expansion must be exactly the original suffix');
    assert.equal(fs.readFileSync(ownerPath,'utf8'),splitOwnerFinance.ownerFinance,
      'Owner finance must be exactly the canonical section, without forks');
  }
  const shippedComponents=fs.readFileSync(path.join(dir,'css','components.css'),'utf8');
  assert.equal(shippedComponents,compactReleasedCssComments(role==='admin'?originalComponents:optimizedComponents.css),
    role+' stylesheet must match the canonical role-specific CSS after release-only compaction');
  assert.equal(shippedComponents.includes('.admin-sidebar{'),role==='admin',
    role+' must isolate admin-only styles');
  const sw=fs.readFileSync(path.join(dir,'sw.js'),'utf8');
  assert.ok(!sw.includes("'./js/admin-expansion.js?v=test-sha'"),
    'Expansion is loaded lazily, not at install-time');
  assert.ok(!sw.includes("'./js/admin-owner-finance.js?v=test-sha'"),
    'Owner finance must not be cached before superadmin requests partner tools');
  assert.ok(sw.includes('tamao-sg-test-sha'),'service worker precisa versionar cache pelo sourceSha do bundle');
  assert.ok(fs.existsSync(path.join(dir,'robots.txt')));
  const robots=fs.readFileSync(path.join(dir,'robots.txt'),'utf8');
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const headers=fs.readFileSync(path.join(dir,'_headers'),'utf8');
  // A customer/merchant release must neither execute, precache nor ship
  // privileged administration UI modules. The admin release keeps them.
  // Only the revenda portal ships privileged merchant operations.
  // Admin and public visitors share the separate merchant acquisition landing.
  const merchantScript='<script defer src="./js/merchant.js?v=test-sha"></script>';
  const merchantCache="'./js/merchant.js?v=test-sha'";
  const hasPartnerOperations=role==='merchant';
  assert.equal(html.includes(merchantScript),hasPartnerOperations,role+' HTML: merchant.js');
  assert.equal(sw.includes(merchantCache),hasPartnerOperations,role+' PWA cache: merchant.js');
  assert.equal(fs.existsSync(path.join(dir,'js','merchant.js')),hasPartnerOperations,role+' shipped merchant.js');
  assert.equal(fs.existsSync(path.join(dir,'js','merchant-price-batch.js')),hasPartnerOperations,
    role+' must isolate deferred merchant price confirmation from other portals');
  assert.ok(!html.includes('src="./js/merchant-price-batch.js?v=test-sha"'),
    role+' must never load the optional batch confirmation on startup');
  assert.ok(html.includes('src="./js/growth.js?v=test-sha"'),role+' public merchant landing must remain available');
  assert.equal(
    fs.readFileSync(path.join(dir,'js','growth.js'),'utf8'),
    compactReleasedGrowthComments(fs.readFileSync(new URL('../js/growth.js',import.meta.url),'utf8')),
    role+' ships only validated growth source with comments omitted');

  for(const module of ['admin-acquisition','admin','admin-activations']){
    const script='<script defer src="./js/'+module+'.js?v=test-sha"></script>';
    const cacheAsset="'./js/"+module+".js?v=test-sha'";
    const available=role==='admin';
    const eager=available&&module!=='admin-activations';
    assert.equal(html.includes(script),eager,role+' HTML: admin script '+module);
    assert.equal(sw.includes(cacheAsset),eager,role+' PWA cache: admin script '+module);
    assert.equal(fs.existsSync(path.join(dir,'js',module+'.js')),available,role+' bundle: admin script '+module);
  }
  // Build-wide asset coherence: every CSS/JS reference carries the release
  // identity, and every versioned URL is precached under the exact same key.
  const shellAssets=[...html.matchAll(/(?:src|href)="(\.\/(?:js|css)\/[^"]+)"/g)].map(match=>match[1]);
  assert.ok(shellAssets.length>5,role+' requires explicit CSS/JS assets');
  assert.equal(new Set(shellAssets).size,shellAssets.length,role+' has duplicate entrypoints');
  for(const asset of shellAssets){
    assert.ok(asset.endsWith('?v=test-sha'),role+' asset missing release identity: '+asset);
    assert.ok(sw.includes("'"+asset+"'"),role+' PWA precache mismatch: '+asset);
  }
  assert.ok(!sw.includes("'./js/core.js'"),role+' must not cache unversioned core JS');
  assert.ok(!sw.includes("'./css/components.css'"),role+' must not cache unversioned CSS');
  // Preserve functional bootstrapping after excluding admin-only sources.
  const bootstrap=fs.readFileSync(path.join(dir,'js','bootstrap.js'),'utf8');
  assert.ok(bootstrap.includes("typeof adminPage==='function'"),'Bootstrap needs optional admin references');
  if(role==='admin'){
    // Execute the actual released bootstrap render against the dedicated
    // admin role. Missing customer-only route functions must never blank it.
    const renderCode=bootstrap.match(/let renderLock=false;[\s\S]*?(?=\nwindow\.addEventListener\('hashchange')/);
    assert.ok(renderCode,'Admin render function must exist in release');
    const app={innerHTML:''};
    const context={
      globalThis:{CHAMA_PORTAL_ROLE:'admin'},
      document:{querySelector(selector){assert.equal(selector,'#app');return app}},
      adminPage(){return '<section>Admin principal carregado</section>'},
      console:{error(error){throw new Error('Unexpected admin render error: '+error)}}
    };
    vm.runInNewContext(renderCode[0]+'\nrender();',context,{timeout:1000});
    assert.equal(app.innerHTML,'<section>Admin principal carregado</section>',
      'Admin must render even without customer, merchant or discovery functions');
    // Missing admin script is an explicit protected-module error, not a
    // fallback into an unrelated public page on the privileged hostname.
    delete context.adminPage;
    vm.runInNewContext(renderCode[0]+'\nrender();',context,{timeout:1000});
    assert.match(app.innerHTML,/Administração indisponível/);
    const adminSource=fs.readFileSync(path.join(dir,'js','admin.js'),'utf8');
    assert.match(adminSource,/adminActivationLoadOnDemand\(\)/);
    assert.match(adminSource,/adminActivationModuleUrl/);
  }
  assert.ok(bootstrap.includes("typeof merchantPage==='function'"),'Bootstrap needs optional merchant references');
  if(role==='customer')assert.match(bootstrap,/if\(typeof merchantPage==='function'\)Object\.assign/);
  if(role!=='admin'){
    const canonical=role==='customer'?'https://tamao.com.br/':'https://parceiro.tamao.com.br/';
    assert.match(robots,/Allow:\s*\//);
    assert.ok(robots.includes('Sitemap: '+canonical+'sitemap.xml'),
      'Public portal should advertise its own sitemap: '+role);
    assert.ok(!robots.includes('Disallow: /'),'Public acquisition must be crawlable: '+role);
    assert.ok(fs.existsSync(path.join(dir,'sitemap.xml')));
    const sitemap=fs.readFileSync(path.join(dir,'sitemap.xml'),'utf8');
    assert.ok(sitemap.includes('<loc>'+canonical+'</loc>'),'Sitemap must use the correct portal origin');
    const other=role==='customer'?'https://parceiro.tamao.com.br/':'https://tamao.com.br/';
    assert.ok(!sitemap.includes('<loc>'+other+'</loc>'),'Sitemap must not advertise the other portal');
    assert.ok(html.includes('name="robots" content="index,follow,max-image-preview:large"'));
    assert.ok(!headers.includes('X-Robots-Tag: noindex'),
      'Public lead acquisition cannot be blocked via HTTP headers');
  }else{
    assert.match(robots,/Disallow:\s*\//);
    assert.ok(!fs.existsSync(path.join(dir,'sitemap.xml')),
      'Administrative routes must never have a sitemap');
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

  const portalOrigin={
    customer:'https://tamao.com.br',
    merchant:'https://parceiro.tamao.com.br',
    admin:'https://admin.tamao.com.br'
  }[role];
  assert.ok(html.includes('<link rel="canonical" href="'+portalOrigin+'/" />'),
    'Wrong canonical origin for '+role);
  assert.ok(html.includes('<meta property="og:url" content="'+portalOrigin+'/" />'),
    'Wrong share URL for '+role);
  assert.ok(html.includes('<meta name="description" content="'),
    'Missing search description for '+role);
  if(role==='merchant'){
    assert.match(html,/TAMÃO para Revendas — Sua empresa, mais oportunidades/);
    assert.match(html,/Sua empresa pode alcançar mais clientes da região/);
  }
  if(role==='admin'){
    assert.match(html,/Acesso restrito à administração operacional do TAMÃO/);
  }

  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');

  const metadata=JSON.parse(fs.readFileSync(path.join(dir,'portal-build.json'),'utf8'));
  assert.equal(metadata.portalRole,role);
  assert.equal(metadata.sourceSha,'test-sha');
}

const cfRoot=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-cloudflare-portals-'));
assert.throws(
  ()=>buildCloudflarePortal({
    CHAMA_CLOUDFLARE_PROJECT:'tamao-sg-cliente',
    CHAMA_SOURCE_SHA:'1234567890123456789012345678901234567890',
    CHAMA_TURNSTILE_SITE_KEY:testKey,
    CHAMA_ALLOW_TEST_TURNSTILE:'1'
  },{outputRoot:path.join(cfRoot,'forbidden-test-key'),publishDir:path.join(cfRoot,'forbidden-publish')}),
  /test.*demo key/,
  'Production Cloudflare build cannot inherit a CI-only Turnstile exception'
);
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
  const cfHtml=fs.readFileSync(path.join(publishDir,'index.html'),'utf8');
  const cfSw=fs.readFileSync(path.join(publishDir,'sw.js'),'utf8');
  const cfAsset='./js/core.js?v=1234567890123456789012345678901234567890';
  const lazyActivation='./js/admin-activations.js?v=1234567890123456789012345678901234567890';
  assert.equal(fs.existsSync(path.join(publishDir,'js','admin-expansion.js')),cfg.role==='admin');
  assert.equal(fs.existsSync(path.join(publishDir,'js','admin-owner-finance.js')),cfg.role==='admin');
  if(cfg.role==='admin')assert.equal(fs.readFileSync(path.join(publishDir,'js','admin-owner-finance.js'),'utf8'),splitOwnerFinance.ownerFinance);
  if(cfg.role==='admin'){
    assert.equal(fs.readFileSync(path.join(publishDir,'js','admin-expansion.js'),'utf8'),splitAcquisition.expansion);
    assert.ok(!cfSw.includes("'./js/admin-expansion.js?v=1234567890123456789012345678901234567890'"));
  }
  assert.ok(!cfHtml.includes('src="'+lazyActivation+'"'));
  assert.ok(!cfSw.includes("'"+lazyActivation+"'"));
  assert.equal(fs.existsSync(path.join(publishDir,'js','admin-activations.js')),cfg.role==='admin');
  assert.ok(cfHtml.includes('src="'+cfAsset+'"'),projectName+' must pin actual Cloudflare scripts');
  const includesMerchant=cfg.role==='merchant';
  assert.equal(cfHtml.includes('src="./js/merchant.js?v=1234567890123456789012345678901234567890"'),includesMerchant);
  assert.equal(fs.existsSync(path.join(publishDir,'js','merchant.js')),includesMerchant);
  assert.equal(fs.existsSync(path.join(publishDir,'js','merchant-price-batch.js')),includesMerchant);
  assert.equal(cfSw.includes("'./js/merchant.js?v=1234567890123456789012345678901234567890'"),includesMerchant);
  assert.ok(cfSw.includes("'"+cfAsset+"'"),projectName+' must precache the same scripts');
  const runtime=fs.readFileSync(path.join(publishDir,'js','runtime-config.js'),'utf8');
  assert.ok(runtime.includes(PUBLIC_TURNSTILE_SITE_KEY));
}
fs.rmSync(root,{recursive:true,force:true});
fs.rmSync(cfRoot,{recursive:true,force:true});
console.log('Live + Cloudflare portal bundles contract passou.');

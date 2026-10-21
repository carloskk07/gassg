import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {buildRuntimeConfig,validatePortalRole} from './generate-runtime-config.mjs';
import {writePublicLandingPages,PUBLIC_LANDING_SLUGS} from './build-public-landing-pages.mjs';
import {writeDiscoveryLandingPages,DISCOVERY_LANDING_SLUGS} from './build-discovery-landings.mjs';
import {stripAdminOnlyCss,publicAdminClassReferences} from './strip-admin-css.mjs';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const STATIC_FILES=['index.html','manifest.webmanifest','sw.js','robots.txt'];
const STATIC_DIRS=['css','js','icons','assets'];
const PORTALS={
  customer:{name:'TAMÃO — Cliente',shortName:'TAMÃO',title:'TAMÃO — Pediu? Tá na mão.'},
  merchant:{name:'TAMÃO — Revenda',shortName:'TAMÃO Revenda',title:'TAMÃO Revenda — Operação'},
  admin:{name:'TAMÃO — Administração',shortName:'TAMÃO Admin',title:'TAMÃO Admin — Controle'}
};
const TEST_KEYS=new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '3x00000000000000000000FF',
  '0x4AAAAAAAAAA-demo-site-key'
]);

// Cloudflare may auto-deploy main; reject invalid public JavaScript BEFORE
// clearing the output directory or writing a publishable bundle.
export function validateClassicScriptSyntax(source,filename='public-script.js'){
  new vm.Script(source,{filename});
}
function validateAllPublicScripts(){
  const jsDir=path.join(ROOT,'js');
  for(const file of fs.readdirSync(jsDir)){
    if(!file.endsWith('.js'))continue;
    validateClassicScriptSyntax(fs.readFileSync(path.join(jsDir,file),'utf8'),'js/'+file);
  }
}
// Browser classic-script ABI is preserved: the two emitted files concatenate
// byte-for-byte to the canonical, single-source acquisition script. Only the
// expansion/prospect/enablement tail is deferred in the admin build.
export function splitAdminAcquisition(source){
  if(typeof source!=='string')throw new TypeError('Acquisition source must be a string');
  const sentinel='\nasync function adminLoadProspects(';
  const offset=source.indexOf(sentinel);
  if(offset<100000||source.indexOf(sentinel,offset+1)!==-1)
    throw new Error('Missing or duplicate acquisition expansion boundary');
  const cut=offset+1;
  const core=source.slice(0,cut),expansion=source.slice(cut);
  validateClassicScriptSyntax(core,'js/admin-acquisition.js (core)');
  validateClassicScriptSyntax(expansion,'js/admin-expansion.js (on demand)');
  if(core+expansion!==source)throw new Error('Acquisition source was not preserved');
  if(!expansion.includes('function adminProspectsSection(')
    ||!expansion.includes('function adminEnablementSection(')
    ||!expansion.includes('async function adminLoadEnablement('))
    throw new Error('Acquisition split moved critical workspace functions');
  return {core,expansion};
}

// Keep one canonical acquisition source. Preserve the exact byte sequence
// of all functions and lexical declarations, deferring owner-only financial
// tooling in the privileged partner work area.
export function splitAdminOwnerFinanceCore(core){
  if(typeof core!=='string')throw new TypeError('Admin core must be a string');
  const first='\nasync function adminOwnerFinanceLoadFromUi(';
  const last='\nfunction adminPrelaunchLeadsSection(';
  const beginning=core.indexOf(first),ending=core.indexOf(last);
  if(beginning<90000||ending<beginning+180000
    ||core.indexOf(first,beginning+1)!==-1||core.indexOf(last,ending+1)!==-1)
    throw new Error('Missing or ambiguous owner-finance boundary');
  const prefix=core.slice(0,beginning+1),ownerFinance=core.slice(beginning+1,ending+1),
    leads=core.slice(ending+1),startup=prefix+leads;
  validateClassicScriptSyntax(startup,'js/admin-acquisition.js (startup)');
  validateClassicScriptSyntax(ownerFinance,'js/admin-owner-finance.js (deferred)');
  if(prefix+ownerFinance+leads!==core)throw new Error('Canonical owner finance split lost bytes');
  if(!ownerFinance.includes('function adminOwnerFinanceWorkspaceSection(')
    ||!ownerFinance.includes('async function adminOwnerFinanceLoadFromUi(')
    ||!leads.includes('function adminPrelaunchLeadsSection('))
    throw new Error('Missing owner finance or partner workspace contract');
  return {startup,ownerFinance,prefix,leads};
}

function copyDir(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const entry of fs.readdirSync(src,{withFileTypes:true})){
    const from=path.join(src,entry.name);
    const to=path.join(dst,entry.name);
    if(entry.isDirectory())copyDir(from,to);
    else if(entry.isFile())fs.copyFileSync(from,to);
  }
}

export function assertProductionTurnstile(env=process.env){
  const key=String(env.CHAMA_TURNSTILE_SITE_KEY??'').trim();
  if(!key)throw new Error('CHAMA_TURNSTILE_SITE_KEY is required for live portal bundles');
  if(TEST_KEYS.has(key)&&env.CHAMA_ALLOW_TEST_TURNSTILE!=='1'){
    throw new Error('Cloudflare Turnstile test/demo key is forbidden in live portal bundles');
  }
  return key;
}

function headers(portal){
  const role=validatePortalRole(portal,{required:true});
  const lines=[
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation='+(
      role==='customer'?'(self)':'()'),
    '  Cross-Origin-Resource-Policy: same-origin',
    '',
    '/sw.js',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '',
    '/js/runtime-config.js',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    ''
  ];
  if(role==='admin'){
    lines.splice(7,0,'  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet');
  }
  return lines.join('\n');
}

function patchIndex(html,portal,sourceSha){
  const assetVersion=String(sourceSha||'').trim();
  if(!/^[A-Za-z0-9._-]{1,120}$/.test(assetVersion))throw new Error('Invalid version for portal asset URLs');
  const role=validatePortalRole(portal,{required:true});
  const meta=PORTALS[role];
  const robots=role!=='admin'
    ? 'index,follow,max-image-preview:large'
    : 'noindex,nofollow,noarchive,nosnippet';
  // Every portal has its own canonical/social identity. A partner sharing
  // parceiro.tamao.com.br must never produce a preview pointing at the shop.
  const identity={
    customer:{
      origin:'https://tamao.com.br',
      description:'Faltou em casa? Tá na mão. Consulte a disponibilidade de gás, água e essenciais no seu CEP e encontre as opções da sua região.',
      socialTitle:'TAMÃO — Pediu? Tá na mão.'
    },
    merchant:{
      origin:'https://parceiro.tamao.com.br',
      description:'Sua empresa pode alcançar mais clientes da região. Conheça o TAMÃO, cadastre sua revenda e configure sua operação para vender quando estiver habilitada.',
      socialTitle:'TAMÃO para Revendas — Sua empresa, mais oportunidades'
    },
    admin:{
      origin:'https://admin.tamao.com.br',
      description:'Acesso restrito à administração operacional do TAMÃO.',
      socialTitle:'TAMÃO — Administração'
    }
  }[role];
  const replaceMeta=(src,attr,key,value)=>{
    const rx=new RegExp('(<meta '+attr+'="'+key.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&')+'" content=")[^"]*(" \\/>)');
    return src.replace(rx,(_all,a,b)=>a+value+b);
  };
  let patched=html
    .replace(/<title>[^<]*<\/title>/,`<title>${meta.title}</title>`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/,`<link rel="canonical" href="${identity.origin}/" />`)
    .replace('<body>',`<body data-chama-portal="${role}">`);
  patched=replaceMeta(patched,'name','robots',robots);
  patched=replaceMeta(patched,'name','description',identity.description);
  patched=replaceMeta(patched,'property','og:url',identity.origin+'/');
  patched=replaceMeta(patched,'property','og:title',identity.socialTitle);
  patched=replaceMeta(patched,'property','og:description',identity.description);
  patched=replaceMeta(patched,'name','twitter:title',identity.socialTitle);
  patched=replaceMeta(patched,'name','twitter:description',identity.description);
  // Dedicated public/merchant bundles must not load admin code. The admin
  // portal keeps the full legacy dependency graph until it is split safely.
  if(role==='customer'){
    const merchantTag='<script defer src="./js/merchant.js"></script>';
    if(!patched.includes(merchantTag))throw new Error('Missing customer merchant script for isolation');
    patched=patched.replace(merchantTag,'');
  }
  if(role==='admin'){
    const lazyTag='<script defer src="./js/admin-activations.js"></script>';
    if(!patched.includes(lazyTag))throw new Error('Admin activation module missing');
    patched=patched.replace(lazyTag,'');
  }
  if(role!=='admin'){
    for(const module of ['admin-acquisition','admin','admin-activations']){
      const tag='<script defer src="./js/'+module+'.js"></script>';
      if(!patched.includes(tag))throw new Error('Missing expected admin script: '+module);
      patched=patched.replace(tag,'');
    }
  }
  // A single release identity for every script and stylesheet. This prevents
  // browser/CDN caches from mixing assets across successive deployments.
  // Only release bundles are rewritten; the source index remains convenient
  // for local development and static inspections.
  return patched.replace(/((?:src|href)=")(\.\/(?:js|css)\/[^"?#]+)(")/g,(_match,start,url,end)=>start+url+'?v='+encodeURIComponent(assetVersion)+end);
}

function writePortalRobots(target,role){
  if(role!=='admin'){
    const origin=role==='customer'?'https://tamao.com.br':'https://parceiro.tamao.com.br';
    fs.writeFileSync(
      path.join(target,'robots.txt'),
      'User-agent: *\nAllow: /\n\nSitemap: '+origin+'/sitemap.xml\n',
      'utf8'
    );
    const landingUrls=role==='customer'
      ?[...PUBLIC_LANDING_SLUGS,...DISCOVERY_LANDING_SLUGS].map(slug=>'  <url><loc>'+origin+'/'+slug+'/</loc></url>\n').join('')
      :'';
    fs.writeFileSync(
      path.join(target,'sitemap.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n'
        +'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        +'  <url><loc>'+origin+'/</loc></url>\n'
        +landingUrls
        +'</urlset>\n',
      'utf8'
    );
    return;
  }
  fs.writeFileSync(path.join(target,'robots.txt'),'User-agent: *\nDisallow: /\n','utf8');
}

function patchManifest(raw,portal){
  const role=validatePortalRole(portal,{required:true});
  const meta=PORTALS[role];
  const manifest=JSON.parse(raw);
  manifest.name=meta.name;
  manifest.short_name=meta.shortName;
  manifest.id='/';
  manifest.start_url='/';
  manifest.scope='/';
  return JSON.stringify(manifest,null,2)+'\n';
}

function patchServiceWorker(raw,sourceSha,role){
  const buildId=String(sourceSha||'unknown').trim()||'unknown';
  if(!/^[A-Za-z0-9._-]{1,120}$/.test(buildId))throw new Error('source SHA inválido para cache PWA');
  const next=raw.replace(
    /const CACHE=['"][^'"]+['"];/,
    'const CACHE='+JSON.stringify('tamao-sg-'+buildId)+';'
  );
  if(next===raw)throw new Error('constante CACHE do service worker não encontrada');
  if(!['customer','merchant','admin'].includes(role))throw new Error('Invalid portal cache role');
  let scoped=next;
  if(role==='customer'){
    const merchantEntry=",'./js/merchant.js'";
    if(!scoped.includes(merchantEntry))throw new Error('Missing customer merchant precache entry');
    scoped=scoped.replace(merchantEntry,'');
  }
  if(role==='admin'){
    const lazyEntry=",'./js/admin-activations.js'";
    if(!scoped.includes(lazyEntry))throw new Error('Missing admin activations precache entry');
    scoped=scoped.replace(lazyEntry,'');
  }
  if(role!=='admin'){
    // Only the administrative bundle may precache privileged UI modules.
    for(const module of ['admin-acquisition','admin','admin-activations']){
      const entry=",'./js/"+module+".js'";
      if(!scoped.includes(entry))throw new Error('Missing expected admin cache entry: '+module);
      scoped=scoped.replace(entry,'');
    }
  }
  // The precache keys must be identical to the versioned URLs in index.html.
  // A release cannot accidentally serve old CSS with new JavaScript offline.
  const assets=/const ASSETS=\[([\s\S]*?)\];/;
  if(!assets.test(scoped))throw new Error('Missing PWA ASSETS array');
  return scoped.replace(assets,(_match,items)=>
    'const ASSETS=['+items.replace(/'(\.\/(?:js|css)\/[^'?#]+)'/g,
      (_item,url)=>"'"+url+'?v='+encodeURIComponent(buildId)+"'")+'];'
  );
}


export function buildLivePortals(env=process.env,{outputRoot=env.PORTAL_BUILD_OUTPUT||path.join(ROOT,'dist','live-portals')}={}){
  assertProductionTurnstile(env);
  validateAllPublicScripts();
  const out=path.resolve(outputRoot);
  fs.rmSync(out,{recursive:true,force:true});
  fs.mkdirSync(out,{recursive:true});

  const indexRaw=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  if(/<\/script>\\n\s*<script/.test(indexRaw))throw new Error('index.html contém \\n literal entre scripts; use quebra de linha real');
  const manifestRaw=fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8');
  const serviceWorkerRaw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
  const sourceSha=String(env.CHAMA_SOURCE_SHA||'unknown').trim()||'unknown';
  const sharedAdminClasses=publicAdminClassReferences(path.join(ROOT,'js'));
  const built=[];

  for(const role of Object.keys(PORTALS)){
    const target=path.join(out,role);
    fs.mkdirSync(target,{recursive:true});
    for(const file of STATIC_FILES)fs.copyFileSync(path.join(ROOT,file),path.join(target,file));
    for(const dir of STATIC_DIRS)copyDir(path.join(ROOT,dir),path.join(target,dir));
    // The customer portal uses commercial merchant landings, but it must not
    // download, evaluate or cache the large partner operations interface.
    // The revenda and admin portals retain their existing dependency graph.
    if(role==='customer'){
      fs.rmSync(path.join(target,'js','merchant.js'));
    }
    // Discovery is customer-only and fetched on navigation, never in privileged bundles.
    if(role!=='customer'){
      fs.rmSync(path.join(target,'js','discovery.js'),{force:true});
      fs.rmSync(path.join(target,'js','discovery-owner.js'),{force:true});
      fs.rmSync(path.join(target,'css','discovery.css'),{force:true});
    }
    // Split only the released admin bundle; keep one canonical source file
    // for older static regressions and local development. No code is copied,
    // removed or re-implemented. On-demand expansion has the same source SHA.
    if(role==='admin'){
      const acquisitionFile=path.join(target,'js','admin-acquisition.js');
      const canonical=fs.readFileSync(acquisitionFile,'utf8');
      const parts=splitAdminAcquisition(canonical);
      const owner=splitAdminOwnerFinanceCore(parts.core);
      fs.writeFileSync(acquisitionFile,owner.startup,'utf8');
      fs.writeFileSync(path.join(target,'js','admin-owner-finance.js'),owner.ownerFinance,'utf8');
      fs.writeFileSync(path.join(target,'js','admin-expansion.js'),parts.expansion,'utf8');
    }
    // Admin implementation must not be distributed with customer/merchant
    // bundles. API authorization still remains strictly server-side.
    if(role!=='admin'){
      for(const module of ['admin-acquisition','admin','admin-activations']){
        fs.rmSync(path.join(target,'js',module+'.js'));
      }
      // Deliver only CSS needed by the public portals. Keep every shared
      // admin-named class used by non-admin modules (the merchant reconciliation
      // panel currently uses .admin-entity-grid), and preserve admin CSS fully.
      const cssPath=path.join(target,'css','components.css');
      const original=fs.readFileSync(cssPath,'utf8');
      const optimized=stripAdminOnlyCss(original,{sharedAdminClasses});
      fs.writeFileSync(cssPath,optimized.css,'utf8');
    }

    const runtimeEnv={...env,CHAMA_PORTAL_ROLE:role};
    fs.writeFileSync(
      path.join(target,'js','runtime-config.js'),
      buildRuntimeConfig(runtimeEnv,{requirePortalRole:true}),
      'utf8'
    );
    fs.writeFileSync(path.join(target,'index.html'),patchIndex(indexRaw,role,sourceSha),'utf8');
    fs.writeFileSync(path.join(target,'manifest.webmanifest'),patchManifest(manifestRaw,role),'utf8');
    fs.writeFileSync(path.join(target,'sw.js'),patchServiceWorker(serviceWorkerRaw,sourceSha,role),'utf8');
    writePortalRobots(target,role);
    if(role==='customer')writePublicLandingPages(target,{origin:'https://tamao.com.br',indexing:true});
    if(role==='customer')writeDiscoveryLandingPages(target,{origin:'https://tamao.com.br',indexing:true});
    fs.writeFileSync(path.join(target,'_headers'),headers(role),'utf8');
    fs.writeFileSync(path.join(target,'_redirects'),'/* /index.html 200\n','utf8');
    fs.writeFileSync(path.join(target,'portal-build.json'),JSON.stringify({
      schemaVersion:1,
      portalRole:role,
      sourceSha,
      customerOrigin:String(env.CHAMA_CUSTOMER_ORIGIN||''),
      merchantOrigin:String(env.CHAMA_MERCHANT_ORIGIN||''),
      adminOrigin:String(env.CHAMA_ADMIN_ORIGIN||'')
    },null,2)+'\n','utf8');

    for(const forbidden of ['supabase','tests','scripts','.github']){
      if(fs.existsSync(path.join(target,forbidden)))throw new Error('forbidden live portal path: '+forbidden);
    }
    built.push({role,path:target});
  }
  return built;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=buildLivePortals(process.env);
  for(const portal of result)console.log(portal.role+': '+portal.path);
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildRuntimeConfig,validatePortalRole} from './generate-runtime-config.mjs';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const STATIC_FILES=['index.html','manifest.webmanifest','sw.js','robots.txt'];
const STATIC_DIRS=['css','js','icons'];
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

function headers(){
  return [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Cross-Origin-Resource-Policy: same-origin',
    '',
    '/sw.js',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '',
    '/js/runtime-config.js',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    ''
  ].join('\n');
}

function patchIndex(html,portal){
  const role=validatePortalRole(portal,{required:true});
  const meta=PORTALS[role];
  return html
    .replace(/<title>[^<]*<\/title>/,`<title>${meta.title}</title>`)
    .replace('<body>',`<body data-chama-portal="${role}">`);
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

function patchServiceWorker(raw,sourceSha){
  const buildId=String(sourceSha||'unknown').trim()||'unknown';
  if(!/^[A-Za-z0-9._-]{1,120}$/.test(buildId))throw new Error('source SHA inválido para cache PWA');
  const next=raw.replace(
    /const CACHE=['"][^'"]+['"];/,
    'const CACHE='+JSON.stringify('tamao-sg-'+buildId)+';'
  );
  if(next===raw)throw new Error('constante CACHE do service worker não encontrada');
  return next;
}


export function buildLivePortals(env=process.env,{outputRoot=env.PORTAL_BUILD_OUTPUT||path.join(ROOT,'dist','live-portals')}={}){
  assertProductionTurnstile(env);
  const out=path.resolve(outputRoot);
  fs.rmSync(out,{recursive:true,force:true});
  fs.mkdirSync(out,{recursive:true});

  const indexRaw=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  if(/<\/script>\\n\s*<script/.test(indexRaw))throw new Error('index.html contém \\n literal entre scripts; use quebra de linha real');
  const manifestRaw=fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8');
  const serviceWorkerRaw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
  const sourceSha=String(env.CHAMA_SOURCE_SHA||'unknown').trim()||'unknown';
  const built=[];

  for(const role of Object.keys(PORTALS)){
    const target=path.join(out,role);
    fs.mkdirSync(target,{recursive:true});
    for(const file of STATIC_FILES)fs.copyFileSync(path.join(ROOT,file),path.join(target,file));
    for(const dir of STATIC_DIRS)copyDir(path.join(ROOT,dir),path.join(target,dir));

    const runtimeEnv={...env,CHAMA_PORTAL_ROLE:role};
    fs.writeFileSync(
      path.join(target,'js','runtime-config.js'),
      buildRuntimeConfig(runtimeEnv,{requirePortalRole:true}),
      'utf8'
    );
    fs.writeFileSync(path.join(target,'index.html'),patchIndex(indexRaw,role),'utf8');
    fs.writeFileSync(path.join(target,'manifest.webmanifest'),patchManifest(manifestRaw,role),'utf8');
    fs.writeFileSync(path.join(target,'sw.js'),patchServiceWorker(serviceWorkerRaw,sourceSha),'utf8');
    fs.writeFileSync(path.join(target,'_headers'),headers(),'utf8');
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

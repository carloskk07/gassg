import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {buildRuntimeConfig,validatePortalRole} from './generate-runtime-config.mjs';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const LIVE_TARGETS=JSON.parse(fs.readFileSync(path.join(ROOT,'config','live-targets.json'),'utf8'));
const STATIC_FILES=['index.html','manifest.webmanifest','sw.js'];
const STATIC_DIRS=['css','js','icons'];
const PORTALS={
  customer:{name:'Chama — Cliente',shortName:'Chama',title:'Chama — Gás e essenciais em São Gabriel'},
  merchant:{name:'Chama — Revenda',shortName:'Chama Revenda',title:'Chama Revenda — Operação'},
  admin:{name:'Chama — Administração',shortName:'Chama Admin',title:'Chama Admin — Controle'}
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

export function assertAuthRedirectsConfirmed(env=process.env){
  if(String(env.CHAMA_AUTH_REDIRECTS_CONFIRMED??'').trim()!=='1'){
    throw new Error(
      'CHAMA_AUTH_REDIRECTS_CONFIRMED=1 is required after verifying Supabase Auth Site URL and Redirect URLs'
    );
  }
  return true;
}

function portalOriginEnvKey(role){
  return 'CHAMA_'+role.toUpperCase()+'_ORIGIN';
}

function assertTargetsMatchEnv(env){
  for(const role of Object.keys(PORTALS)){
    const expected=String(LIVE_TARGETS?.portals?.[role]?.origin??'');
    const actual=String(env[portalOriginEnvKey(role)]??'').replace(/\/$/,'');
    if(!expected||actual!==expected){
      throw new Error(role+' origin does not match config/live-targets.json');
    }
  }
}

function recursiveFiles(root,dir=root){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...recursiveFiles(root,full));
    else if(entry.isFile())out.push(path.relative(root,full).split(path.sep).join('/'));
  }
  return out.sort();
}

function bundleDigest(dir){
  const files=recursiveFiles(dir);
  const hash=crypto.createHash('sha256');
  let bytes=0;
  for(const relative of files){
    const data=fs.readFileSync(path.join(dir,relative));
    bytes+=data.length;
    const fileHash=crypto.createHash('sha256').update(data).digest('hex');
    hash.update(relative+'\0'+fileHash+'\n');
  }
  return {sha256:hash.digest('hex'),fileCount:files.length,bytes};
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

export function buildLivePortals(env=process.env,{outputRoot=env.PORTAL_BUILD_OUTPUT||path.join(ROOT,'dist','live-portals')}={}){
  assertProductionTurnstile(env);
  assertAuthRedirectsConfirmed(env);
  assertTargetsMatchEnv(env);
  const out=path.resolve(outputRoot);
  fs.rmSync(out,{recursive:true,force:true});
  fs.mkdirSync(out,{recursive:true});

  const indexRaw=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const manifestRaw=fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8');
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
    fs.writeFileSync(path.join(target,'_headers'),headers(),'utf8');
    fs.writeFileSync(path.join(target,'_redirects'),'/* /index.html 200\n','utf8');
    fs.writeFileSync(path.join(target,'portal-build.json'),JSON.stringify({
      schemaVersion:1,
      portalRole:role,
      sourceSha:String(env.CHAMA_SOURCE_SHA||'unknown'),
      customerOrigin:String(env.CHAMA_CUSTOMER_ORIGIN||''),
      merchantOrigin:String(env.CHAMA_MERCHANT_ORIGIN||''),
      adminOrigin:String(env.CHAMA_ADMIN_ORIGIN||'')
    },null,2)+'\n','utf8');

    for(const forbidden of ['supabase','tests','scripts','.github']){
      if(fs.existsSync(path.join(target,forbidden)))throw new Error('forbidden live portal path: '+forbidden);
    }
    const digest=bundleDigest(target);
    built.push({
      role,
      path:target,
      origin:LIVE_TARGETS.portals[role].origin,
      netlifySiteId:LIVE_TARGETS.portals[role].netlifySiteId,
      ...digest
    });
  }

  const releaseManifest={
    schemaVersion:1,
    sourceSha:String(env.CHAMA_SOURCE_SHA||'unknown'),
    supabaseAuth:LIVE_TARGETS.supabaseAuth,
    portals:Object.fromEntries(built.map(item=>[item.role,{
      origin:item.origin,
      netlifySiteId:item.netlifySiteId,
      bundleSha256:item.sha256,
      fileCount:item.fileCount,
      bytes:item.bytes
    }]))
  };
  fs.writeFileSync(
    path.join(out,'release-manifest.json'),
    JSON.stringify(releaseManifest,null,2)+'\n',
    'utf8'
  );
  return built;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=buildLivePortals(process.env);
  for(const portal of result)console.log(portal.role+': '+portal.path);
}

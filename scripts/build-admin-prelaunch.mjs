import fs from 'node:fs';
import path from 'node:path';
import {buildRuntimeConfig,validatePortalOrigin} from './generate-runtime-config.mjs';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const STATIC_FILES=['index.html','manifest.webmanifest','sw.js'];
const STATIC_DIRS=['css','js','icons'];

function copyDir(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const entry of fs.readdirSync(src,{withFileTypes:true})){
    const from=path.join(src,entry.name);
    const to=path.join(dst,entry.name);
    if(entry.isDirectory())copyDir(from,to);
    else if(entry.isFile())fs.copyFileSync(from,to);
  }
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

export function buildAdminPrelaunchPortal(
  env=process.env,
  {outputDir=env.ADMIN_PORTAL_BUILD_OUTPUT||path.join(ROOT,'dist','admin-prelaunch')}={}
){
  for(const key of ['CHAMA_CUSTOMER_ORIGIN','CHAMA_MERCHANT_ORIGIN','CHAMA_ADMIN_ORIGIN']){
    validatePortalOrigin(key,env[key]);
  }

  const target=path.resolve(outputDir);
  fs.rmSync(target,{recursive:true,force:true});
  fs.mkdirSync(target,{recursive:true});

  for(const file of STATIC_FILES)fs.copyFileSync(path.join(ROOT,file),path.join(target,file));
  for(const dir of STATIC_DIRS)copyDir(path.join(ROOT,dir),path.join(target,dir));

  const runtimeEnv={
    ...env,
    CHAMA_PORTAL_ROLE:'admin',
    CHAMA_TURNSTILE_SITE_KEY:String(env.CHAMA_TURNSTILE_SITE_KEY||'').trim()
  };
  fs.writeFileSync(
    path.join(target,'js','runtime-config.js'),
    buildRuntimeConfig(runtimeEnv,{requirePortalRole:true,allowAdminWithoutTurnstile:true}),
    'utf8'
  );

  const indexPath=path.join(target,'index.html');
  const html=fs.readFileSync(indexPath,'utf8')
    .replace(/<title>[^<]*<\/title>/,'<title>TAMÃO Admin — Controle</title>')
    .replace('<body>','<body data-chama-portal="admin">');
  fs.writeFileSync(indexPath,html,'utf8');

  const manifestPath=path.join(target,'manifest.webmanifest');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  manifest.name='TAMÃO — Administração';
  manifest.short_name='TAMÃO Admin';
  manifest.id='/';
  manifest.start_url='/';
  manifest.scope='/';
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n','utf8');

  fs.writeFileSync(path.join(target,'_headers'),headers(),'utf8');
  fs.writeFileSync(path.join(target,'_redirects'),'/* /index.html 200\n','utf8');
  fs.writeFileSync(path.join(target,'portal-build.json'),JSON.stringify({
    schemaVersion:1,
    portalRole:'admin',
    deploymentProfile:'prelaunch-admin',
    sourceSha:String(env.CHAMA_SOURCE_SHA||'unknown'),
    customerOrigin:String(env.CHAMA_CUSTOMER_ORIGIN||''),
    merchantOrigin:String(env.CHAMA_MERCHANT_ORIGIN||''),
    adminOrigin:String(env.CHAMA_ADMIN_ORIGIN||''),
    turnstileConfigured:Boolean(String(env.CHAMA_TURNSTILE_SITE_KEY||'').trim())
  },null,2)+'\n','utf8');

  for(const forbidden of ['supabase','tests','scripts','.github']){
    if(fs.existsSync(path.join(target,forbidden)))throw new Error('forbidden admin portal path: '+forbidden);
  }

  return {role:'admin',path:target};
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=buildAdminPrelaunchPortal(process.env);
  console.log('admin: '+result.path);
}

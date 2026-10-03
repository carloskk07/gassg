import fs from 'node:fs';
import path from 'node:path';
import {buildRuntimeConfig} from './generate-runtime-config.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const outName=process.argv[2]||'dist';
const out=path.resolve(root,outName);
const deployTarget=String(process.env.TAMAO_DEPLOY_TARGET||'lab').trim().toLowerCase();
const cloudflare=deployTarget==='cloudflare';
const indexing=process.env.TAMAO_PUBLIC_INDEXING==='1';
const liveRuntime=process.env.TAMAO_LIVE_RUNTIME==='1';

function validatePublicOrigin(value){
  const raw=String(value||'https://tamao.com.br').trim().replace(/\/$/,'');
  let url;
  try{url=new URL(raw)}catch{throw new Error('TAMAO_PUBLIC_ORIGIN inválida')}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'){
    throw new Error('TAMAO_PUBLIC_ORIGIN deve ser uma origem HTTPS sem path');
  }
  if(url.hostname.toLowerCase().endsWith('.github.io'))throw new Error('domínio público não pode ser github.io');
  return url.origin;
}
const publicOrigin=validatePublicOrigin(process.env.TAMAO_PUBLIC_ORIGIN);

if(indexing&&!cloudflare)throw new Error('TAMAO_PUBLIC_INDEXING=1 só é permitido no build Cloudflare');
if(liveRuntime&&!cloudflare)throw new Error('TAMAO_LIVE_RUNTIME=1 só é permitido no build Cloudflare');

const files=['index.html','manifest.webmanifest','sw.js','robots.txt'];
const dirs=['css','js','icons'];

fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});

for(const file of files){
  const src=path.join(root,file);
  if(!fs.existsSync(src))throw new Error('Asset público ausente: '+file);
  fs.copyFileSync(src,path.join(out,file));
}
for(const dir of dirs){
  const src=path.join(root,dir);
  if(!fs.existsSync(src))throw new Error('Diretório público ausente: '+dir);
  fs.cpSync(src,path.join(out,dir),{recursive:true});
}

function patchCloudflareIndex(){
  const file=path.join(out,'index.html');
  let html=fs.readFileSync(file,'utf8');
  const robots=indexing?'index,follow':'noindex,nofollow,noarchive,nosnippet';
  html=html
    .replace(/<meta name="robots" content="[^"]*" \/>/,'<meta name="robots" content="'+robots+'" />')
    .replace(/<link rel="canonical" href="[^"]*" \/>/,'<link rel="canonical" href="'+publicOrigin+'/" />')
    .replace(/<meta property="og:url" content="[^"]*" \/>/,'<meta property="og:url" content="'+publicOrigin+'/" />');
  fs.writeFileSync(file,html,'utf8');
}

function patchCloudflareManifest(){
  const file=path.join(out,'manifest.webmanifest');
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  manifest.id='/';
  manifest.start_url='/#home';
  manifest.scope='/';
  for(const shortcut of manifest.shortcuts||[]){
    const raw=String(shortcut.url||'');
    if(raw.includes('#order'))shortcut.url='/#order';
    else if(raw.includes('#tracking'))shortcut.url='/#tracking';
  }
  fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n','utf8');
}

function cloudflareHeaders(){
  const lines=[
    '/*',
    "  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com; script-src-elem 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://lgugwujpunhslavewffd.supabase.co wss://lgugwujpunhslavewffd.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; media-src 'none'; upgrade-insecure-requests",
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Cross-Origin-Resource-Policy: same-origin'
  ];
  if(!indexing)lines.push('  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet');
  lines.push(
    '',
    '/index.html',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '',
    '/sw.js',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '',
    '/js/runtime-config.js',
    '  Cache-Control: no-cache, no-store, must-revalidate',
    ''
  );
  return lines.join('\n');
}

function writeSeoPolicy(){
  if(indexing){
    fs.writeFileSync(path.join(out,'robots.txt'),[
      'User-agent: *',
      'Allow: /',
      'Sitemap: '+publicOrigin+'/sitemap.xml',
      ''
    ].join('\n'),'utf8');
    fs.writeFileSync(path.join(out,'sitemap.xml'),[
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url><loc>'+publicOrigin+'/</loc></url>',
      '</urlset>',
      ''
    ].join('\n'),'utf8');
  }else{
    fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n','utf8');
    fs.rmSync(path.join(out,'sitemap.xml'),{force:true});
  }
}

if(cloudflare){
  patchCloudflareIndex();
  patchCloudflareManifest();
  writeSeoPolicy();
  fs.writeFileSync(path.join(out,'_headers'),cloudflareHeaders(),'utf8');

  if(liveRuntime){
    const runtimeEnv={...process.env,CHAMA_PORTAL_ROLE:'customer'};
    fs.writeFileSync(
      path.join(out,'js','runtime-config.js'),
      buildRuntimeConfig(runtimeEnv,{requirePortalRole:true}),
      'utf8'
    );
  }
}

for(const forbidden of ['supabase','tests','scripts','.github','.git']){
  if(fs.existsSync(path.join(out,forbidden)))throw new Error('Build público vazou diretório interno: '+forbidden);
}

const required=[
  'index.html','manifest.webmanifest','sw.js','robots.txt',
  'js/runtime-config.js','js/backend.js','js/core.js','js/acquisition.js','js/legal.js',
  'css/base.css','css/components.css','icons/icon.svg'
];
for(const item of required){
  if(!fs.existsSync(path.join(out,item)))throw new Error('Build público incompleto: '+item);
}

if(cloudflare){
  const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  const robots=fs.readFileSync(path.join(out,'robots.txt'),'utf8');
  const headers=fs.readFileSync(path.join(out,'_headers'),'utf8');
  if(!headers.includes('Content-Security-Policy:'))throw new Error('Cloudflare build sem CSP por header');
  if(!headers.includes('X-Frame-Options: DENY'))throw new Error('Cloudflare build sem proteção de frame');
  if(indexing){
    if(!html.includes('name="robots" content="index,follow"'))throw new Error('build indexável ainda contém noindex');
    if(!robots.includes('Allow: /')||!fs.existsSync(path.join(out,'sitemap.xml')))throw new Error('SEO público incompleto');
    if(headers.includes('X-Robots-Tag: noindex'))throw new Error('header noindex permaneceu no build público');
  }else{
    if(!html.includes('noindex,nofollow,noarchive,nosnippet'))throw new Error('pré-lançamento precisa manter noindex');
    if(!robots.includes('Disallow: /'))throw new Error('pré-lançamento precisa bloquear crawling');
    if(!headers.includes('X-Robots-Tag: noindex'))throw new Error('pré-lançamento Cloudflare precisa noindex também por header');
  }
}

console.log('Build público TAMÃO pronto em '+path.relative(root,out)+' ['+deployTarget+(indexing?', indexável':', noindex')+(liveRuntime?', live-runtime':'')+']');

import fs from 'node:fs';
import path from 'node:path';
import {buildLivePortals} from './build-live-portals.mjs';
import {validatePortalRole} from './generate-runtime-config.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const PROJECTS={
  'tamao-sg-cliente':{role:'customer',origin:'https://tamao-sg-cliente.pages.dev'},
  'tamao-sg-revenda':{role:'merchant',origin:'https://tamao-sg-revenda.pages.dev'},
  'tamao-sg-admin':{role:'admin',origin:'https://tamao-sg-admin.pages.dev'}
};
function inferProjectName(){
  const explicit=String(process.env.CHAMA_CLOUDFLARE_PROJECT||'').trim().toLowerCase();
  if(explicit&&PROJECTS[explicit])return explicit;
  const url=String(process.env.CF_PAGES_URL||'').trim();
  if(url){
    try{
      const host=new URL(url).hostname.toLowerCase();
      for(const name of Object.keys(PROJECTS)){
        if(host===name+'.pages.dev'||host.endsWith('.'+name+'.pages.dev'))return name;
      }
    }catch{}
  }
  const role=validatePortalRole(process.env.CHAMA_PORTAL_ROLE,{required:false});
  if(role){
    const match=Object.entries(PROJECTS).find(([,cfg])=>cfg.role===role);
    if(match)return match[0];
  }
  throw new Error('Não foi possível inferir o projeto Cloudflare Pages. Use CHAMA_CLOUDFLARE_PROJECT ou CHAMA_PORTAL_ROLE.');
}

const projectName=inferProjectName();
const role=PROJECTS[projectName].role;
const sourceSha=String(process.env.CHAMA_SOURCE_SHA||process.env.CF_PAGES_COMMIT_SHA||'unknown').trim();
const PUBLIC_TURNSTILE_SITE_KEY='0x4AAAAAAFNKDvnzxtYQ9WM2';
const outRoot=path.join(root,'dist','cloudflare-build');
const publish=path.join(root,'dist','cloudflare-portal');

const env={
  ...process.env,
  CHAMA_SOURCE_SHA:sourceSha,
  CHAMA_PORTAL_ROLE:role,
  CHAMA_TURNSTILE_SITE_KEY:process.env.CHAMA_TURNSTILE_SITE_KEY||PUBLIC_TURNSTILE_SITE_KEY,
  CHAMA_CUSTOMER_ORIGIN:process.env.CHAMA_CUSTOMER_ORIGIN||PROJECTS['tamao-sg-cliente'].origin,
  CHAMA_MERCHANT_ORIGIN:process.env.CHAMA_MERCHANT_ORIGIN||PROJECTS['tamao-sg-revenda'].origin,
  CHAMA_ADMIN_ORIGIN:process.env.CHAMA_ADMIN_ORIGIN||PROJECTS['tamao-sg-admin'].origin
};

buildLivePortals(env,{outputRoot:outRoot});
const source=path.join(outRoot,role);
if(!fs.existsSync(source))throw new Error('portal bundle ausente para role '+role);

fs.rmSync(publish,{recursive:true,force:true});
fs.mkdirSync(path.dirname(publish),{recursive:true});
fs.cpSync(source,publish,{recursive:true});

const buildMeta=JSON.parse(fs.readFileSync(path.join(publish,'portal-build.json'),'utf8'));
if(buildMeta.portalRole!==role)throw new Error('portal-build role mismatch');
if(sourceSha!=='unknown'&&buildMeta.sourceSha!==sourceSha)throw new Error('portal-build source SHA mismatch');
if(buildMeta.customerOrigin!==PROJECTS['tamao-sg-cliente'].origin&&process.env.CHAMA_CUSTOMER_ORIGIN==null){
  throw new Error('customer origin Cloudflare mismatch');
}
if(buildMeta.merchantOrigin!==PROJECTS['tamao-sg-revenda'].origin&&process.env.CHAMA_MERCHANT_ORIGIN==null){
  throw new Error('merchant origin Cloudflare mismatch');
}
if(buildMeta.adminOrigin!==PROJECTS['tamao-sg-admin'].origin&&process.env.CHAMA_ADMIN_ORIGIN==null){
  throw new Error('admin origin Cloudflare mismatch');
}

console.log('Cloudflare Pages portal pronto: '+projectName+' ['+role+'] -> '+path.relative(root,publish));

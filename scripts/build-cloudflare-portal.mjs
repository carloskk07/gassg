import fs from 'node:fs';
import path from 'node:path';
import {buildLivePortals} from './build-live-portals.mjs';
import {validatePortalRole} from './generate-runtime-config.mjs';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
export const CLOUDFLARE_PROJECTS={
  'tamao-sg-cliente':{role:'customer',origin:'https://tamao.com.br',pagesOrigin:'https://tamao-sg-cliente.pages.dev'},
  'tamao-sg-revenda':{role:'merchant',origin:'https://parceiro.tamao.com.br',pagesOrigin:'https://tamao-sg-revenda.pages.dev'},
  'tamao-sg-admin':{role:'admin',origin:'https://admin.tamao.com.br',pagesOrigin:'https://tamao-sg-admin.pages.dev'}
};
export const PUBLIC_TURNSTILE_SITE_KEY='0x4AAAAAAFNKDvnzxtYQ9WM2';

export function inferCloudflareProject(env=process.env){
  const explicit=String(env.CHAMA_CLOUDFLARE_PROJECT||'').trim().toLowerCase();
  if(explicit&&CLOUDFLARE_PROJECTS[explicit])return explicit;

  const url=String(env.CF_PAGES_URL||'').trim();
  if(url){
    try{
      const host=new URL(url).hostname.toLowerCase();
      for(const name of Object.keys(CLOUDFLARE_PROJECTS)){
        if(host===name+'.pages.dev'||host.endsWith('.'+name+'.pages.dev'))return name;
      }
    }catch{}
  }

  const role=validatePortalRole(env.CHAMA_PORTAL_ROLE,{required:false});
  if(role){
    const match=Object.entries(CLOUDFLARE_PROJECTS).find(([,cfg])=>cfg.role===role);
    if(match)return match[0];
  }
  throw new Error('Não foi possível inferir o projeto Cloudflare Pages. Use CHAMA_CLOUDFLARE_PROJECT ou CHAMA_PORTAL_ROLE.');
}

export function buildCloudflarePortal(
  env=process.env,
  {
    outputRoot=path.join(ROOT,'dist','cloudflare-build'),
    publishDir=path.join(ROOT,'dist','cloudflare-portal')
  }={}
){
  const projectName=inferCloudflareProject(env);
  const role=CLOUDFLARE_PROJECTS[projectName].role;
  const sourceSha=String(env.CHAMA_SOURCE_SHA||env.CF_PAGES_COMMIT_SHA||'unknown').trim();
  const buildEnv={
    ...env,
    CHAMA_SOURCE_SHA:sourceSha,
    CHAMA_PORTAL_ROLE:role,
    CHAMA_TURNSTILE_SITE_KEY:env.CHAMA_TURNSTILE_SITE_KEY||PUBLIC_TURNSTILE_SITE_KEY,
    CHAMA_CUSTOMER_ORIGIN:env.CHAMA_CUSTOMER_ORIGIN||CLOUDFLARE_PROJECTS['tamao-sg-cliente'].origin,
    CHAMA_MERCHANT_ORIGIN:env.CHAMA_MERCHANT_ORIGIN||CLOUDFLARE_PROJECTS['tamao-sg-revenda'].origin,
    CHAMA_ADMIN_ORIGIN:env.CHAMA_ADMIN_ORIGIN||CLOUDFLARE_PROJECTS['tamao-sg-admin'].origin
  };

  buildLivePortals(buildEnv,{outputRoot});
  const source=path.join(outputRoot,role);
  if(!fs.existsSync(source))throw new Error('portal bundle ausente para role '+role);

  fs.rmSync(publishDir,{recursive:true,force:true});
  fs.mkdirSync(path.dirname(publishDir),{recursive:true});
  fs.cpSync(source,publishDir,{recursive:true});

  const buildMeta=JSON.parse(fs.readFileSync(path.join(publishDir,'portal-build.json'),'utf8'));
  if(buildMeta.portalRole!==role)throw new Error('portal-build role mismatch');
  if(sourceSha!=='unknown'&&buildMeta.sourceSha!==sourceSha)throw new Error('portal-build source SHA mismatch');
  if(buildMeta.customerOrigin!==CLOUDFLARE_PROJECTS['tamao-sg-cliente'].origin&&env.CHAMA_CUSTOMER_ORIGIN==null){
    throw new Error('customer origin Cloudflare mismatch');
  }
  if(buildMeta.merchantOrigin!==CLOUDFLARE_PROJECTS['tamao-sg-revenda'].origin&&env.CHAMA_MERCHANT_ORIGIN==null){
    throw new Error('merchant origin Cloudflare mismatch');
  }
  if(buildMeta.adminOrigin!==CLOUDFLARE_PROJECTS['tamao-sg-admin'].origin&&env.CHAMA_ADMIN_ORIGIN==null){
    throw new Error('admin origin Cloudflare mismatch');
  }

  return {projectName,role,publishDir,sourceSha};
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=buildCloudflarePortal(process.env);
  console.log('Cloudflare Pages portal pronto: '+result.projectName+' ['+result.role+'] -> '+path.relative(ROOT,result.publishDir));
}

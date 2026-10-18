import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync} from 'node:zlib';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ROLES=['customer','merchant','admin'];
const LAZY_ADMIN=['admin-activations.js','admin-expansion.js','admin-owner-finance.js'];
const getAttribute=(tag,key)=>{
  const match=new RegExp('\\b'+key+'\\s*=\\s*"([^"]+)"','i').exec(tag);
  return match?.[1]||null;
};
function assetsFromHtml(html){
  const js=[...html.matchAll(/<script\b[^>]*>/gi)].map(x=>getAttribute(x[0],'src'))
    .filter(x=>x?.startsWith('./js/'));
  const css=[...html.matchAll(/<link\b[^>]*>/gi)].filter(x=>
    /\bstylesheet\b/i.test(getAttribute(x[0],'rel')||''))
    .map(x=>getAttribute(x[0],'href')).filter(x=>x?.startsWith('./css/'));
  return {js,css};
}
export function measurePortalBundle(dir,{limits,strict=true}={}){
  const meta=JSON.parse(fs.readFileSync(path.join(dir,'portal-build.json'),'utf8'));
  const role=String(meta.portalRole||''),sha=String(meta.sourceSha||'');
  if(!ROLES.includes(role)||!/^[A-Za-z0-9._-]{1,120}$/.test(sha))
    throw new Error('Invalid portal or source SHA');
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(dir,'sw.js'),'utf8');
  const source=assetsFromHtml(html),violations=[];
  const out={role,sourceSha:sha,
    js:{requests:source.js.length,rawBytes:0,gzipBytes:0,brotliBytes:0},
    css:{requests:source.css.length,rawBytes:0,gzipBytes:0,brotliBytes:0},
    deferredAdminBytes:0};
  for(const kind of ['js','css']){
    const urls=source[kind],m=out[kind];
    if(!urls.length)violations.push(role+' missing '+kind+' startup assets');
    if(new Set(urls).size!==urls.length)violations.push(role+' duplicate '+kind+' requests');
    for(const url of urls){
      if(!url.endsWith('?v='+sha))throw new Error('Release SHA missing from '+url);
      const name=url.slice(2,url.lastIndexOf('?'));
      if(!name.startsWith(kind+'/')||name.includes('..')||!/^[A-Za-z0-9._/-]+$/.test(name))
        throw new Error('Invalid local asset '+url);
      const filename=path.join(dir,name);
      if(!fs.existsSync(filename))throw new Error('Missing startup asset '+filename);
      if(!sw.includes("'"+url+"'"))throw new Error('PWA precache URL mismatch: '+url);
      const data=fs.readFileSync(filename);
      m.rawBytes+=data.length;
      m.gzipBytes+=gzipSync(data,{level:9}).length;
      m.brotliBytes+=brotliCompressSync(data).length;
    }
  }
  for(const name of LAZY_ADMIN){
    const file=path.join(dir,'js',name),url='./js/'+name+'?v='+sha;
    const exists=fs.existsSync(file);
    if(exists!==(role==='admin'))violations.push(role+' role leakage: '+name);
    if(source.js.includes(url)||sw.includes("'"+url+"'"))
      violations.push(role+' unexpectedly eager or precached: '+name);
    if(exists)out.deferredAdminBytes+=fs.statSync(file).size;
  }
  if(role==='customer'&&fs.existsSync(path.join(dir,'js','merchant.js')))
    violations.push('Customer contains merchant operations');
  if(role!=='admin'&&['admin.js','admin-acquisition.js'].some(name=>
    fs.existsSync(path.join(dir,'js',name))))violations.push(role+' contains admin code');
  const budget=limits?.[role];
  if(!budget)violations.push('Missing '+role+' performance budget');
  else{
    for(const [key,value] of [
      ['initialJsBytes',out.js.rawBytes],['initialCssBytes',out.css.rawBytes],
      ['initialJsRequests',out.js.requests],['initialCssRequests',out.css.requests]
    ]){
      if(!Number.isSafeInteger(budget[key])||budget[key]<1)
        violations.push(role+' invalid budget '+key);
      else if(value>budget[key])
        violations.push(role+' '+key+' exceeded: '+value+' > '+budget[key]);
    }
  }
  if(strict&&violations.length)throw new Error('TAMÃO performance gate: '+violations.join('; '));
  return {metrics:out,violations};
}
export function readBudgets(){
  const data=JSON.parse(fs.readFileSync(path.join(ROOT,'performance','portal-budgets.json'),'utf8'));
  if(data.schemaVersion!==1||ROLES.some(role=>!data.limits?.[role]))
    throw new Error('Invalid performance budget configuration');
  return data;
}
export function auditPortalBudgets(root,{limits=readBudgets().limits,strict=true}={}){
  const rows=ROLES.map(role=>measurePortalBundle(path.join(root,role),{limits,strict}));
  return {schemaVersion:1,portals:rows.map(r=>r.metrics),
    violations:rows.flatMap(r=>r.violations)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(process.argv[2]||path.join(ROOT,'dist','live-portals'));
  const result=auditPortalBudgets(root);
  const target=path.resolve(process.argv[3]||path.join(root,'..','portal-performance-report.json'));
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');
  for(const {role,js,css,deferredAdminBytes} of result.portals)
    console.log(role+': JS '+js.requests+' files / '+js.rawBytes+'B raw / '+
      js.gzipBytes+'B gzip / '+js.brotliBytes+'B brotli; CSS '+css.requests+
      ' files / '+css.rawBytes+'B raw / '+css.gzipBytes+'B gzip; deferred admin '+
      deferredAdminBytes+'B');
  console.log('Portal performance gates PASS; '+target);
}

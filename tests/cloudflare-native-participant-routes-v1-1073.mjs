import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TAMAO_CLOUDFLARE_NATIVE_ROUTES as redirects} from '../scripts/cloudflare-native-routes-v1-1073.mjs';

// Cloudflare Pages redirects are ordered. Simulate the production 302 fallback matcher
// to catch SPA fallback, CSS/JS interception and broken deep links.
const rules=redirects.trim().split(/\r?\n/).map(x=>{
 const m=x.trim().match(/^(\S+)\s+(\S+)\s+(200|301|302)$/);
 assert.ok(m,'Malformed Cloudflare rule '+x);
 return {from:m[1],to:m[2],status:Number(m[3])};
});
assert.ok(rules.length>=6);
assert.ok(!rules.some(x=>x.from==='/*'),'SPA fallback must not shadow participant links');
function match(route,template){
 const keys=[];
 const pattern='^'+template.replace(/:([A-Za-z_]+)/g,(_,name)=>{
   keys.push(name);return '([a-z0-9-]+)';
 }).replaceAll('/','\\/')+'$';
 const m=route.match(new RegExp(pattern));
 return m?Object.fromEntries(keys.map((k,i)=>[k,m[i+1]])):null;
}
function dispatch(url){
 const u=new URL(url,'https://tamao.com.br');
 for(const rule of rules){
  const params=match(u.pathname,rule.from);
  if(!params)continue;
  const target=rule.to.replace(/:([A-Za-z_]+)/g,(_,key)=>encodeURIComponent(params[key]||''));
  return {status:rule.status,path:target,query:u.search};
 }
 return {status:200,path:u.pathname,query:u.search};
}
for(const [input,expected] of [
 ['/p/minha-revenda-123/','/p/?slug=minha-revenda-123'],
 ['/p/meu-perfil-de-cliente-4/?ref=ABCDE1','/p/?slug=meu-perfil-de-cliente-4'],
 ['/agenda/profissional-x/','/agenda/?profissional=profissional-x'],
 ['/agenda/exemplo/','/agenda/?profissional=exemplo'],
 ['/convite/codigo/','/convite/?a=customer'],
 ['/p/page.js','/p/page.js'],
 ['/p/style.css','/p/style.css'],
 ['/agenda/agenda.js','/agenda/agenda.js'],
 ['/agenda/exemplo/style.css','/agenda/exemplo/style.css'],
 ['/','/']
]){
 const got=dispatch(input);
 assert.equal(got.path,expected,'Deep-link routing '+input+' -> '+got.path);
}
assert.equal(dispatch('/p/revenda-123/?ref=ABCDE1').query,'?ref=ABCDE1');
assert.equal(dispatch('/p/revenda-123/').status,302);
assert.equal(dispatch('/agenda/outro-profissional/').status,302);
assert.equal(dispatch('/agenda/exemplo/').status,302,
 'Without native Function the old fallback is temporary; native Function serves premium example');
assert.ok(!redirects.includes('/agenda/exemplo/ /agenda/exemplo/index.html 200'));

assert.equal(dispatch('/agenda/exemplo').status,301);
const liveBuild=fs.readFileSync(new URL('../scripts/build-live-portals.mjs',import.meta.url),'utf8');
const publicBuild=fs.readFileSync(new URL('../scripts/build-public-site.mjs',import.meta.url),'utf8');
assert.match(liveBuild,/role==='customer'\?TAMAO_CLOUDFLARE_NATIVE_ROUTES/);
assert.match(publicBuild,/fs\.writeFileSync\(path\.join\(out,'_redirects'\),TAMAO_CLOUDFLARE_NATIVE_ROUTES/);
for(const required of [
  '../p/index.html','../p/page.js','../p/style.css',
  '../agenda/index.html','../convite/index.html'
])assert.ok(fs.existsSync(new URL(required,import.meta.url)),required+' must exist');
assert.match(fs.readFileSync(new URL('../p/page.js',import.meta.url),'utf8'),
 /location\.pathname\.match\(/);
const participantBoot=fs.readFileSync(new URL('../p/page.js',import.meta.url),'utf8');
const agendaBoot=fs.readFileSync(new URL('../js/agenda-boot.js',import.meta.url),'utf8');
assert.match(participantBoot,/get\('slug'\)/);
assert.match(participantBoot,/url\.pathname='\/p\/'\+slug\+'\/'/);
assert.match(participantBoot,/history\.replaceState/);
assert.match(agendaBoot,/get\('profissional'\)/);
assert.match(agendaBoot,/url\.pathname='\/agenda\/'\+slug\+'\/'/);
assert.match(agendaBoot,/history\.replaceState/);

console.log('V1.1073 PASS: Cloudflare participant/Agenda deep links, static assets and first-touch query.');

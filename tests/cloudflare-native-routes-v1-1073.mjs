import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TAMAO_CLOUDFLARE_NATIVE_ROUTES as source} from '../scripts/cloudflare-native-routes-v1-1073.mjs';
const entries=source.trim().split('\n').map(line=>{
 const [from,to,code]=line.split(' ');
 assert.ok(/^\/[a-zA-Z0-9/.:_-]+$/.test(from),'Invalid Cloudflare source '+from);
 assert.ok(/^\/[a-zA-Z0-9/._-]+$/.test(to),'Invalid Cloudflare target '+to);
 assert.ok(['200','301'].includes(code),'Invalid status '+code);
 return {from,to,code};
});
assert.ok(!source.includes('/* /index.html 200'),'SPA catchall overrides static assets and native routing');
assert.ok(entries.length>=6,'Incomplete canonical participant route contract');
const matches=(pattern,path)=>new RegExp('^'+pattern.split('/').map(x=>
 x.startsWith(':')?'[^/]+':x.replaceAll('.','\\.')
).join('/')+'$').test(path);
const resolve=path=>entries.find(x=>matches(x.from,path));
for(const [path,expectedTarget,expectedStatus] of [
 ['/p/minha-revenda/','/p/index.html','200'],
 ['/p/meu-perfil/','/p/index.html','200'],
 ['/agenda/barbearia-das-flores/','/agenda/index.html','200'],
 ['/agenda/barbearia-das-flores','/agenda/barbearia-das-flores/','301'],
 ['/agenda/exemplo/','/agenda/exemplo/index.html','200'],
 ['/agenda/exemplo','/agenda/exemplo/','301'],
 ['/agenda/index.html','/agenda/','301'],
 ['/convite/minha-rede/','/convite/index.html','200']
]){
 const result=resolve(path);
 assert.equal(result?.to,expectedTarget,'Wrong target for '+path);
 assert.equal(result?.code,expectedStatus,'Wrong code for '+path);
}
for(const asset of ['/p/page.js','/p/style.css','/agenda/exemplo/style.css',
 '/js/agenda.js','/css/base.css','/assets/tamao-products-sprite.webp',
 '/icons/icon.svg','/sw.js','/','/index.html','/agenda/','/convite/']){
 assert.equal(resolve(asset),undefined,'Static asset or root must never become a deep link: '+asset);
}
for(const script of ['scripts/build-live-portals.mjs','scripts/build-public-site.mjs']){
 const src=fs.readFileSync(new URL('../'+script,import.meta.url),'utf8');
 assert.match(src,/TAMAO_CLOUDFLARE_NATIVE_ROUTES/,'Both builders must share the contract');
 assert.match(src,/writeFileSync\(path\.join\((?:target|out),'_redirects'\)/,'Missing generated _redirects file');
}
console.log('V1.1073 PASS — Cloudflare deep links work without rewriting JS/CSS, demo routes or unrelated SPA links.');

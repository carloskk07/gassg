import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {tamaoPagesFunctionsRouting,TAMAO_PAGES_FUNCTIONS_CUSTOMER,
 TAMAO_PAGES_FUNCTIONS_OTHER} from '../scripts/cloudflare-functions-routes-v1-1074.mjs';

const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');
const helper=read('functions/_shared/native-route.js');
const p=read('functions/p/[slug].js');
const agenda=read('functions/agenda/[slug].js');
const build=read('scripts/build-live-portals.mjs');
const publicBuild=read('scripts/build-public-site.mjs');
assert.match(p,/nativePageRoute\(context,'p'\)/);
assert.match(agenda,/nativePageRoute\(context,'agenda'\)/);
assert.match(helper,/env\.ASSETS\.fetch\(assetUrl\.toString\(\)\)/);
assert.match(helper,/new URL\('\/'\+kind\+'\/',url\)/);
assert.match(helper,/Content-Security-Policy/);
assert.match(helper,/X-Frame-Options/);
assert.match(helper,/no-store/);
assert.doesNotMatch(helper,/merchantId|referralCode|paymentIntent|commissionLedger|\.(?:from|rpc)\(/i);
const sandbox={URL,Headers,Response};
vm.runInNewContext(helper.replace('export async function nativePageRoute','async function nativePageRoute')+
 '\nthis.route=nativePageRoute;',sandbox);
const handler=sandbox.route;
const events=[];
const fakeHtml='<!doctype html><html lang="pt-BR"><title>Página real TAMÃO</title></html>';
const env={ASSETS:{fetch:async assetUrl=>{
 events.push(new URL(assetUrl).pathname);
 return new Response(fakeHtml,{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
}}};
async function call(path,kind,method='GET',stateEnv=env){
 let passed=false;
 const result=await handler({
  request:{url:'https://tamao.com.br'+path,method},
  env:stateEnv,
  next:()=>{passed=true;return new Response('NEXT',{status:299})}
 },kind);
 return {passed,response:result};
}
const deepLinks=[
 ['/p/revenda-da-rua-0123456789ab/','p','/p/'],
 ['/p/cliente-0123456789ab/?ref=ABCDE1','p','/p/'],
 ['/agenda/barbearia-do-joao/','agenda','/agenda/'],
 ['/agenda/barbearia-do-joao','agenda','/agenda/'],
 ['/agenda/exemplo/','agenda','/agenda/exemplo/']
];
for(const [path,kind,target] of deepLinks){
 const before=events.length;
 const {passed,response}=await call(path,kind);
 assert.equal(passed,false,kind+': '+path+' should reach a native HTML page');
 assert.equal(response.status,200);
 assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal(response.headers.get('x-frame-options'),'DENY');
 assert.match(response.headers.get('x-robots-tag'),/noindex/);
 assert.equal(await response.text(),fakeHtml);
 assert.equal(events.length,before+1);
 assert.equal(events.at(-1),target,'Must fetch directory root, not a canonicalized index.html');
}
const before=events.length;
for(const [path,kind,method] of [
 ['/p/index.html','p'],['/p/page.js','p'],['/p/style.css','p'],
 ['/p/','p'],['/p/abc/','p'],['/p/a%2Fb/','p'],
 ['/agenda/index.html','agenda'],
 ['/agenda/agenda.js','agenda'],
 ['/p/revenda-0123456789ab/','p','POST'],
 ['/agenda/joao-0123456789ab/','agenda','POST']
]){
 const {passed,response}=await call(path,kind,method||'GET');
 assert.equal(passed,true,'Static asset, example, invalid slug or non-GET must pass through: '+path);
 assert.equal(response.status,299);
}
assert.equal(events.length,before,'No static asset request must invoke native HTML asset lookup');
const head=await call('/p/revenda-0123456789ab/','p','HEAD');
assert.equal(head.response.status,200);
assert.equal((await head.response.text()).length,0);
const down=await call('/p/revenda-0123456789ab/','p','GET',{});
assert.equal(down.response.status,503,'Fail closed if Pages ASSETS binding is missing');
assert.ok(!down.response.headers.get('location'),'No external fallback or redirects');
assert.equal(JSON.parse(tamaoPagesFunctionsRouting('customer')).version,1);
assert.deepEqual(TAMAO_PAGES_FUNCTIONS_CUSTOMER.include,['/p/*','/agenda/*']);
assert.ok(TAMAO_PAGES_FUNCTIONS_CUSTOMER.exclude.includes('/p/page.js'));
assert.ok(TAMAO_PAGES_FUNCTIONS_CUSTOMER.exclude.includes('/p/style.css'));
assert.ok(!TAMAO_PAGES_FUNCTIONS_CUSTOMER.exclude.includes('/agenda/exemplo/*'));
assert.ok(TAMAO_PAGES_FUNCTIONS_CUSTOMER.exclude.includes('/agenda/exemplo/page.js'));
assert.ok(TAMAO_PAGES_FUNCTIONS_CUSTOMER.exclude.includes('/agenda/exemplo/style.css'));
assert.ok(!TAMAO_PAGES_FUNCTIONS_CUSTOMER.include.includes('/*'),'No homepage or financial operation may pay a Function invocation');
assert.ok(!TAMAO_PAGES_FUNCTIONS_OTHER.include.includes('/p/*'));
assert.match(build,/fs\.writeFileSync\(path\.join\(target,'_routes\.json'\),tamaoPagesFunctionsRouting\(role\)/);
assert.match(publicBuild,/fs\.writeFileSync\(path\.join\(out,'_routes\.json'\),tamaoPagesFunctionsRouting\('customer'\)/);
console.log('V1.1074 PASS — Cloudflare Pages Functions serve real participant and Agenda deep links, never swallow static assets, preserve CSP and keep marketplace checkout untouched.');

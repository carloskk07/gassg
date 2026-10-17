import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {writePublicLandingPages,PUBLIC_LANDING_SLUGS} from '../scripts/build-public-landing-pages.mjs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const handoff=read('js/landing-handoff.js');
const stylesheet=read('css/landing-editorial.css');
new vm.Script(handoff,{filename:'landing-handoff.js'});
const origin='https://tamao.com.br';
const run=(anchors=[],search='?utm_source=instagram&utm_campaign=lancamento&ref=ABCDE1')=>{
 const fake=anchors.map(href=>({
  url:href,
  getAttribute(name){return name==='href'?this.url:null},
  setAttribute(name,value){if(name==='href')this.url=value}
 }));
 const doc={readyState:'complete',querySelectorAll(selector){
  assert.equal(selector,'a[data-tamao-handoff]');
  return fake;
 }};
 const ctx=vm.createContext({document:doc,location:{origin,search},URL,URLSearchParams});
 vm.runInContext(handoff,ctx);
 return {ctx,urls:fake.map(x=>x.url)};
};
const {ctx,urls}=run(['/?entrada=revenda','/#merchants','/indicacoes/','/?entrada=marca','#conteudo']);
for(const url of urls.slice(0,4)){
 assert.ok(url.includes('utm_source=instagram'));
 assert.ok(url.includes('utm_campaign=lancamento'));
 assert.ok(url.includes('ref=ABCDE1'));
}
assert.equal(new URL(urls[0],origin).searchParams.get('entrada'),'revenda');
assert.match(urls[1],/^\/\?utm_source=.*#merchants$/);
assert.equal(urls[4],'#conteudo','local anchors must not be rewritten');
assert.equal(ctx.tamaoLandingHandoffUrl('https://evil.example/','?ref=ABCDE1',origin),null);
assert.equal(ctx.tamaoLandingHandoffUrl('/admin','?ref=ABCDE1',origin),null);
assert.equal(ctx.tamaoLandingHandoffUrl('/#order','?ref=ABCDE1',origin)?.endsWith('#order'),true);
assert.equal(ctx.tamaoLandingHandoffUrl('javascript:alert(1)','?ref=ABCDE1',origin),null);
assert.equal(ctx.tamaoLandingHandoffUrl('/?ref=ORIGINAL&entrada=marca','?ref=ABCDE1',origin),null,
 'explicit invitation must not be overwritten');
assert.equal(ctx.tamaoLandingHandoffUrl('/?entrada=revenda','?ref=ABC&gclid=sensitive',origin),null,
 'short malformed referral and tracking identifiers should not be copied');
assert.equal(ctx.tamaoLandingHandoffUrl('/','?ref=ABCDE1&ref=SECOND1',origin),null);
assert.equal(ctx.tamaoLandingHandoffUrl('/','?utm_source=%3Cscript%3E',origin),null);
assert.equal(ctx.tamaoLandingHandoffUrl('/','?utm_source='+('z'.repeat(81)),origin),null);
assert.equal(ctx.tamaoLandingHandoffUrl('/','?fbclid=123&gclid=123&email=test',origin),null);
assert.ok(!/fetch\s*\(|localStorage|sessionStorage|cookie|sendBeacon|XMLHttpRequest|location\.assign/.test(handoff),
 'client enhancement must not call backend, store data or silently redirect');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-visitor-v1378-'));
try{
 writePublicLandingPages(tmp,{origin,indexing:true});
 const audience={
  'como-funciona':{scene:'ed-product-scene',terms:['Gás • Água • Essenciais']},
  'para-revendas':{scene:'ed-audience-merchant',terms:['PAINEL • ILUSTRAÇÃO','Catálogo','Entregas']},
  'para-marcas':{scene:'ed-audience-brand',terms:['PROPOSTA • ILUSTRAÇÃO','Divulgação','Benefícios']},
  'indicacoes':{scene:'ed-audience-network',terms:['REDE • ILUSTRAÇÃO','Seu convite','Quem compra']}
 };
 for(const slug of PUBLIC_LANDING_SLUGS){
  const html=fs.readFileSync(path.join(tmp,slug,'index.html'),'utf8');
  assert.ok(html.includes(audience[slug].scene),'page-specific visual absent: '+slug);
  for(const term of audience[slug].terms)assert.ok(html.includes(term),slug+' missing '+term);
  assert.match(html,/<script src="\/js\/landing-handoff\.js" defer><\/script>/);
  assert.equal((html.match(/<script\b/g)||[]).length,1,'no inline third-party scripts');
  assert.ok((html.match(/data-tamao-handoff/g)||[]).length>=8,'cross-page and CTA links preserve allowed source parameters');
  assert.doesNotMatch(html,/dados reais de clientes|pedido em tempo real|mais de \d+ pedidos/i);
  assert.match(html,/href="\/#privacy"/);
 }
 const revendas=fs.readFileSync(path.join(tmp,'para-revendas','index.html'),'utf8');
 assert.ok(!revendas.includes('class="ed-product ed-product-gas"'),'merchant page must not reuse consumer artwork');
 const marcas=fs.readFileSync(path.join(tmp,'para-marcas','index.html'),'utf8');
 assert.ok(!marcas.includes('class="ed-product ed-product-water"'),'brands should show own editorial concept');
 for(const token of ['.ed-audience-scene','.ed-scene-primary','.ed-audience-brand','.ed-audience-network','@media(max-width:680px)','@media(prefers-reduced-motion:reduce)'])
  assert.ok(stylesheet.includes(token),'missing accessible mobile style '+token);
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
console.log('TAMÃO V1.378 PASS — referral/UTM handoff, safe same-origin allowlist, distinct marketing visuals and mobile layout.');

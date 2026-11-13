import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const script=read('js/ads-display.js');
const styles=read('css/public-ux.css');
const bootstrap=read('js/bootstrap.js');
assert.doesNotThrow(()=>new vm.Script(script,{filename:'js/ads-display.js'}));
assert.ok(bootstrap.includes("'home','order','tracking'"),'Home must load the public design layer');
assert.ok(bootstrap.includes("'sponsors'"),'Brand landing must load the same design layer');
assert.ok(bootstrap.includes("css/public-ux.css"),'Shared design CSS must be loaded by both destinations');
const target={innerHTML:'',textContent:'',querySelector:()=>null};
const doc={getElementById:id=>['tamao-ads-home-slot','sponsor-ad-live-slot'].includes(id)?target:null};
const ctx=vm.createContext({document:doc,URL,Math,Date,Number,String,
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
vm.runInContext(script+'\nthis.draw=tamaoAdsDraw;',ctx);
const base={campaignId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 challenge:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 title:'Conheça os benefícios do TAMÃO',description:'Cupons e novidades da cidade.',
 city:'São Gabriel',state:'RS'};
const institutional={...base,label:'Institucional',advertiser:'TAMÃO',url:'https://tamao.com.br/'};
const sponsored={...base,label:'Patrocinado',advertiser:'Empresa de exemplo',url:'https://example.org/'};
for(const [label,id,slot,text,rel] of [
 ['Institucional','tamao-ads-home-slot',institutional,'Conhecer o TAMÃO','nofollow noopener noreferrer'],
 ['Patrocinado','sponsor-ad-live-slot',sponsored,'Conhecer o anunciante','nofollow noopener noreferrer sponsored']
]){
 ctx.draw(id,slot);
 const html=target.innerHTML;
 assert.match(html,/<article class="card flat tamao-paid-placement"/,label+' card');
 assert.match(html,/class="tamao-ad-cta"/,label+' needs a styled CTA, not a default purple link');
 assert.ok(html.includes(text),label+' CTA text');
 assert.ok(html.includes('rel="'+rel+'"'),label+' still enforces link relationship');
 assert.match(html,/<span aria-hidden="true">↗<\/span><\/a>/,label+' icon is decorative');
 assert.doesNotMatch(html,/<a[^>]*>Conhecer o (?:TAMÃO|anunciante) ↗<\/a>/,
   label+' must not regress to an unstyled bare link');
}
ctx.draw('tamao-ads-home-slot',{...institutional,url:'javascript:alert(1)'});
assert.equal(target.textContent,'','unsafe creative link must never be shown');
for(const pattern of [
 /\.tamao-paid-placement \.tamao-ad-cta:link/,
 /\.tamao-paid-placement \.tamao-ad-cta:visited/,
 /background:linear-gradient\(135deg,#098559,#076b49\)/,
 /color:#fff;text-decoration:none/,
 /min-height:46px/,
 /\.tamao-paid-placement \.tamao-ad-cta:hover/,
 /\.tamao-paid-placement \.tamao-ad-cta:focus-visible/,
 /@media\(max-width:480px\)/,
 /@media\(prefers-reduced-motion:reduce\)/
])assert.match(styles,pattern,'CTA visual/style state or responsive rule missing');
assert.doesNotMatch(script,/tamaoAd[A-Za-z]*\s*=\s*new Payment/,
  'Visual change must not create paid transactions');
console.log('V1.984 PASS: institutional and sponsored ads have a real green CTA; visited, hover, keyboard, mobile and secure links remain consistent.');

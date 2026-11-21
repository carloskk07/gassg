import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js'),css=read('css/merchant-landing-executive.css'),sw=read('sw.js');
new vm.Script(growth,{filename:'growth.js'});
const start=growth.indexOf('function tamaoMerchantExecutiveStyles(){');
const end=growth.indexOf('\nfunction currentMerchantPilotInviteToken(){',start);
assert.ok(start>0&&end>start);
const source=growth.slice(start,end);
const context={
 globalThis:{merchantPortalRequested:()=>false,CHAMA_INTERNAL_PILOT:false},
 merchantPilotFeeRate:()=>0.075,
 MERCHANT_PUBLIC_BILLING_PLANS:[{key:'flex_daily',name:'Flex Diário',bps:900,cents:0},{key:'credit_01990',name:'Essencial',bps:800,cents:1990},{key:'credit_04990',name:'Popular',bps:750,cents:4990},{key:'credit_09990',name:'Profissional',bps:700,cents:9990},{key:'credit_19990',name:'Alto Volume',bps:650,cents:19990}],
 policyPercent:rate=>Number(rate*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%',merchantMarginExample:()=>({gross:6000,chamaFee:540}),
 prelaunchMerchantLeadSection:()=>'<form id="partner-interest"></form>',
 BRL:{format:value=>'R$ '+value},shell:html=>html
};
const html=vm.runInNewContext(source+'\nmerchantsLanding()',context);
const hero=html.slice(0,html.indexOf('merchant-v1112-trust'));
assert.match(hero,/class="page merchant-landing merchant-landing-v1112 merchant-landing-v1113 merchant-landing-v1114 merchant-landing-v1115 merchant-landing-v1117"/);
assert.match(hero,/Sua revenda mais visível/);
assert.match(hero,/merchant-v1113-products/);
assert.equal((hero.match(/class="tamao-product-photo product-/g)||[]).length,3);
for(const code of ['product-gas','product-water','product-charcoal'])assert.ok(hero.includes(code));
assert.match(hero,/Fotos de produtos; não representam ofertas ou revendas cadastradas/);
assert.match(hero,/Visão ilustrativa dos recursos/);
assert.match(hero,/FLEX DIÁRIO · SEM RECARGA<\/small><strong>9%/);
assert.match(hero,/Sem mensalidade no modelo atual/);
assert.match(hero,/Recebimento direto na sua revenda/);
assert.match(hero,/Sem exclusividade/);
assert.match(hero,/onclick="openMerchantPortal\(true\)">Quero cadastrar minha revenda/);
assert.match(hero,/onclick="openMerchantPortal\(\)">Já sou parceiro/);
assert.ok(hero.indexOf('merchant-v1112-primary')<hero.indexOf('merchant-v1112-promise'),
 'Primary signup must precede fine-print benefits');
assert.match(source,/link\.href='\.\/css\/merchant-landing-executive\.css\?v=1122'/);
assert.match(html,/id="merchant-margin" tabindex="-1"/);
assert.match(html,/id="merchant-how" tabindex="-1"/);
assert.match(html,/preload-none-expected-never-here|merchant-sim-product-cost/);
assert.match(html,/id="partner-interest"/);
assert.doesNotMatch(html,/Mais de 10.000|Pedidos garantidos|Renda garantida|Revenda Parceira A/);
const internal=vm.runInNewContext(source+'\nmerchantsLanding()',{
 ...context,globalThis:{merchantPortalRequested:()=>false,CHAMA_INTERNAL_PILOT:true}
});
assert.match(internal,/onclick="setMode\('merchant'\)">Abrir ambiente interno/);
assert.doesNotMatch(internal,/id="partner-interest"/);
for(const style of ['.merchant-landing-v1113','.merchant-v1113-products','.merchant-v1113-product-main',
 '.merchant-v1113-positioning','.merchant-v1113-controlbar','@media(max-width:520px)',
 'prefers-reduced-motion:reduce'])
 assert.ok(css.includes(style),'Missing V1.1113 style '+style);
assert.match(sw,/CACHE='tamao-sg-v1\.1122'/);
assert.match(sw,/\.\/assets\/tamao-products-sprite\.webp/);
console.log('V1.1113 PASS: visual catalogue, dynamic rate, real signup, accurate trust claims and responsive styles.');

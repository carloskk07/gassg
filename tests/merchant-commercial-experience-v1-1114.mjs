import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js'),css=read('css/merchant-landing-executive.css'),sw=read('sw.js');
new vm.Script(growth,{filename:'js/growth.js'});
const start=growth.indexOf('function tamaoMerchantExecutiveStyles(){');
const end=growth.indexOf('\nfunction currentMerchantPilotInviteToken(){',start);
assert.ok(start>=0&&end>start,'merchantsLanding was preserved');
const source=growth.slice(start,end);
const run=internal=>vm.runInNewContext(source+'\nmerchantsLanding()',{
 globalThis:{merchantPortalRequested:()=>false,CHAMA_INTERNAL_PILOT:internal},
 merchantPilotFeeRate:()=>0.075,policyPercent:rate=>Number(rate*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%',
 MERCHANT_PUBLIC_BILLING_PLANS:[{key:'flex_daily',name:'Flex Diário',bps:900,cents:0},{key:'credit_01990',name:'Essencial',bps:800,cents:1990},{key:'credit_04990',name:'Popular',bps:750,cents:4990},{key:'credit_09990',name:'Profissional',bps:700,cents:9990},{key:'credit_19990',name:'Alto Volume',bps:650,cents:19990}],
 merchantMarginExample:()=>({gross:6000,chamaFee:540}),
 prelaunchMerchantLeadSection:()=>'<form id="partner-interest"></form>',
 BRL:{format:amount=>'R$ '+Number(amount).toFixed(2).replace('.',',')},
 shell:html=>html
});
const html=run(false), internal=run(true);
assert.match(html,/merchant-landing-v1114/);
assert.match(html,/merchant-v1114-pricing-rate/);
assert.match(html,/FLEX DIÁRIO · SEM RECARGA<\/span><strong>9%/);
assert.match(html,/Taxa TAMÃO \(9%\)<\/span><strong>R\$ 10,80/);
assert.match(html,/Valor da venda<\/span><strong>R\$ 120,00/);
assert.match(html,/sem assinatura|Sem assinatura|Sem mensalidade/i);
assert.match(html,/A sua revenda/);
assert.match(html,/merchant-v1114-catalogue-grid/);
assert.equal((html.match(/merchant-v1114-catalogue-grid/g)||[]).length,1);
for(const code of ['product-gas','product-water','product-charcoal','product-wood','product-ice'])
 assert.match(html,new RegExp('tamao-product-photo '+code),'Category photo '+code);
for(const anchor of ['merchant-benefits','merchant-terms','merchant-plans','merchant-margin','merchant-how','merchant-faq']){
 assert.equal((html.match(new RegExp('id="'+anchor+'"','g'))||[]).length,1,'Exactly one anchor '+anchor);
 assert.match(html,new RegExp('id="'+anchor+'" tabindex="-1"'));
}
assert.equal((html.match(/class="merchant-v1114-index"/g)||[]).length,1);
assert.equal((html.match(/merchant-v1114-index[\s\S]*?<\/nav>/g)||[]).length,1);
for(const id of ['merchant-benefits','merchant-terms','merchant-plans','merchant-how','merchant-faq'])
 assert.ok(html.includes('publicLandingJump(\''+id+'\')'),'Jump target '+id);
assert.match(html,/<details class="merchant-v1114-simulator-details">/);
assert.match(html,/<details><summary><span><small>CRITÉRIOS DE OFERTA/);
assert.match(html,/id="merchant-sim-product-cost"/);
assert.match(html,/id="merchant-sim-plan"/);
assert.match(html,/merchant-v1115-plans-grid/);
for(const [plan,rate] of [['Essencial','8%'],['Popular','7,5%'],['Profissional','7%'],['Alto Volume','6,5%']]){
 assert.ok(html.includes(plan),'Missing prepaid plan '+plan);
 assert.ok(html.includes(rate),'Missing plan rate '+rate);
}
assert.match(html,/R\$ 19,90/);
assert.match(html,/R\$ 199,90/);
assert.match(html,/economia|Economia/);
assert.match(html,/Crédito antecipado/);
assert.match(html,/id="merchant-sim-fee"/);
assert.match(html,/id="partner-interest"/);
assert.match(html,/onclick="openMerchantPortal\(true\)">Quero cadastrar minha revenda/);
assert.doesNotMatch(html,/merchant-cro-steps|merchant-value-strip|founder-band/,'Repetitive sections should be consolidated');
assert.doesNotMatch(html,/10\.000 clientes|Pedidos garantidos|Renda garantida|revendas fictícias/i);
assert.match(internal,/onclick="setMode\('merchant'\)">Abrir ambiente interno/);
assert.doesNotMatch(internal,/id="partner-interest"/);
assert.match(source,/link\.href='\.\/css\/merchant-landing-executive\.css\?v=1123'/);
for(const klass of ['.merchant-v1114-index','.merchant-v1114-pricing','.merchant-v1114-pricing-grid',
 '.merchant-v1114-simulator-details','.merchant-v1114-distribution','.merchant-v1114-catalogue-grid',
 '.merchant-v1114-operations','.merchant-v1114-faq','.merchant-v1114-last-cta'])
 assert.ok(css.includes(klass),'Missing v1114 style '+klass);
assert.ok(css.includes('@media(max-width:760px)')&&css.includes('@media(max-width:520px)'));
assert.match(sw,/CACHE='tamao-sg-v1\.\d+'/);
assert.ok(css.includes('.merchant-v1115-plans-grid')&&css.includes('.merchant-v1115-plan-credit'));
assert.match(growth,/\['merchant-benefits','merchant-terms','merchant-plans','merchant-margin','merchant-how','merchant-faq'/);
console.log('V1.1115 PASS: Flex 9%, prepaid credit plans, simulator selector and navigation.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const growth=read('js/growth.js');
const styles=read('css/merchant-landing-executive.css');
const sw=read('sw.js');
new vm.Script(growth,{filename:'growth.js'});

const start=growth.indexOf('function tamaoMerchantExecutiveStyles(){');
const end=growth.indexOf('\nfunction currentMerchantPilotInviteToken(){',start);
assert.ok(start>0&&end>start,'merchant marketing route exists');
const merchants=growth.slice(start,end);
const context={
  globalThis:{merchantPortalRequested:()=>false,CHAMA_INTERNAL_PILOT:false},
  merchantPilotFeeRate:()=>0.075,
  policyPercent:()=> '7,5%',
  merchantMarginExample:()=>({gross:6000,chamaFee:450}),
  prelaunchMerchantLeadSection:()=>'<form id="partner-interest">Contato</form>',
  BRL:{format:value=>'R$ '+Number(value).toFixed(2)},
  shell:html=>html
};
const html=vm.runInNewContext(merchants+'\nmerchantsLanding()',context);
assert.match(html,/<h1[^>]*>Sua revenda mais visível/);
assert.match(html,/onclick="openMerchantPortal\(true\)">Quero cadastrar minha revenda/);
assert.match(html,/onclick="openMerchantPortal\(\)">Já sou parceiro/);
assert.match(html,/onclick="publicLandingJump\('merchant-margin'\)">Entender as taxas/);
assert.match(html,/TAXA POR PEDIDO CONCLUÍDO<\/small><strong>7,5%/);
assert.match(html,/Sem mensalidade no modelo atual/);
assert.match(html,/Recebimento direto na sua revenda/);
assert.match(html,/Sem exclusividade/);
assert.match(html,/A liberação das vendas depende da conferência/);
assert.match(html,/id="merchant-margin" tabindex="-1"/);
assert.match(html,/id="merchant-how" tabindex="-1"/);
assert.match(html,/id="partner-interest"/);
assert.match(html,/<details class="merchant-secondary-lead">/);
assert.doesNotMatch(html,/\\\$\{cta\}|\\\$\{merchantFeeLabel\}|Pedidos garantidos|10\.000 clientes/i);
const internal=vm.runInNewContext(merchants+'\nmerchantsLanding()',{
  ...context,
  globalThis:{merchantPortalRequested:()=>false,CHAMA_INTERNAL_PILOT:true}
});
assert.match(internal,/onclick="setMode\('merchant'\)">Abrir ambiente interno/);
assert.doesNotMatch(internal,/id="partner-interest"/);

for(const selector of [
  '.merchant-v1112-hero','.merchant-v1112-window','.merchant-v1112-trust',
  '.merchant-v1112-value-grid','.merchant-v1112-primary',
  '.merchant-landing-v1112 button:focus-visible',
  '@media(max-width:690px)','prefers-reduced-motion:reduce'
])assert.ok(styles.includes(selector),'responsive/commercial layout missing '+selector);
assert.ok(sw.includes("tamao-sg-v1.1112"),'updated JS and CSS must refresh service-worker cache');
console.log('V1.1112: premium merchant page, truthful commercial terms, real actions and mobile safety verified');

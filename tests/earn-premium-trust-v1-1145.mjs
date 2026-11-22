import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js'),boot=read('js/bootstrap.js'),html=read('index.html');
const pageJs=read('js/earn-premium.js'),css=read('css/earn-premium.css'),sw=read('sw.js');
new vm.Script(pageJs,{filename:'earn-premium.js'});
const ctx=vm.createContext({shell:markup=>markup});
vm.runInContext(pageJs+'\nthis.page=earnPremiumPage;',ctx);
const page=ctx.page({rateLabel:'2%',exampleAmount:'R$ 12,00'});
for(const id of ['earn-signature-title','earn-process','earn-process-title','earn-value-title','earn-clarity-title'])
 assert(page.includes(id),'Missing landmark '+id);
for(const label of ['Acessar minha Rede','COMISSÃO DE INDICAÇÃO DIRETA','Fundo de pacotes','Extrato por origem',
 'compras válidas','não saldo disponível','Apenas cadastrar alguém','Posso sacar imediatamente'])
 assert(page.includes(label),'Missing clear trust copy '+label);
assert.match(page,/R\$ 120/);
assert.match(page,/2%/);
assert.match(page,/R\$ 12,00/);
assert.equal((page.match(/<details>/g)||[]).length,6);
assert.match(page,/<details class="earn-simulator-settings">/);
assert.equal((page.match(/data-earn-scenario="/g)||[]).length,3);
assert.match(page,/Quanto suas indicações/);
assert.match(page,/SIMULADOR DE COMISSÕES/);
assert.match(page,/Não é só indicar/);
assert.match(page,/data-earn-ticket/);
assert.equal((page.match(/data-earn-ticket-preset="/g)||[]).length,3);
assert.match(page,/Personalizar valor de cada compra/);
assert.match(page,/5 compras válidas/);
assert.match(page,/data-earn-scenario="5" aria-pressed="true"/);
assert.ok(page.indexOf('earn-benefit-simulator')<page.indexOf('earn-benefit-board'));
assert.ok(page.indexOf('earn-benefit-board')<page.indexOf('earn-section earn-value'));
assert.ok(page.indexOf('earn-section earn-value')<page.indexOf('earn-section earn-process'));
assert.ok(page.indexOf('earn-hero')<page.indexOf('data-earn-scenario-total'));
assert.match(page,/10% <small>fundo coletivo<\/small>/);
assert.match(page,/não para cada participante/);
assert.match(page,/R\$ 100,00 líquidos/);
assert.match(page,/R\$ 10,00 irão para o fundo coletivo/);
assert.match(page,/data-earn-fund-total aria-live="polite">R\$ 10,00/);
assert.equal((page.match(/data-earn-fund-preset="/g)||[]).length,3);
assert.match(page,/data-earn-fund-preset="100" aria-pressed="true"/);
assert.match(page,/não para cada participante/);
assert.match(page,/A parcela de cada pessoa depende do rateio/);
assert.doesNotMatch(page,/<details class="earn-fund-clarity"/);
assert.match(pageJs,/function earnPremiumFundChoose\(netAmount\)/);
assert.match(pageJs,/BRL\.format\(value\/10\)/);
assert.match(css,/\.earn-fund-result/);

assert.match(page,/últimas 24 horas/);
assert.match(page,/Sete frentes com registros de conquistas/);
assert.match(page,/não saldo disponível nem renda prometida/);
assert.match(page,/Indique pessoas/);
assert.match(page,/INDICAÇÕES & BENEFÍCIOS/);
assert.match(page,/data-earn-scenario-total/);
for(const field of ['data-earn-count','data-earn-gross','data-earn-per-order','earn-simulator-breakdown','earn-fund-clarity'])assert(page.includes(field),'Missing transparent breakdown '+field);
assert.match(pageJs,/BRL\.format\(ticket\*n\)/);
assert.match(pageJs,/BRL\.format\(referralExample\(ticket,1\)\)/);
assert.match(pageJs,/function earnPremiumScenarioChoose\(quantity\)/);
assert.match(pageJs,/BRL\.format\(referralExample\(ticket,n\)\)/);
assert.match(pageJs,/function earnPremiumTicketPreset\(amount\)/);
assert.match(pageJs,/function earnPremiumUpdateEstimate\(\)/);
assert.match(pageJs,/earn-hero \.earn-v1146-preview/);
assert.doesNotMatch(page,/(?:ganhos reais|saldo verdadeiro|lucro garantido)/i);
assert.doesNotMatch(page,/R\$ 24,00 de ganhos garantidos/i);
for(const route of ["go('refer')","go('club')","go('merchants')","go('contact')"])
 assert(page.includes(route),'Missing real action '+route);
assert.doesNotMatch(page,/(?:5 estrelas|milhares de clientes|ganho garantido|saldo fictício|lucro certo)/i);
assert.doesNotMatch(page,/https?:\/\/images|<form|onclick="checkout\(/i);
assert.match(growth,/function earn\(\)\{\s*if\(typeof earnPremiumPage/);
assert.match(growth,/rateLabel:policyPercent\(referralPilotRate\(\)\)/);
assert.match(growth,/exampleAmount:BRL\.format\(referralExample\(120,5\)\)/);
assert.match(boot,/function tamaoEnsureEarnPremium\(page\)/);
assert.match(boot,/tamaoEnsureEarnPremium\(r\)/);
assert.match(boot,/css\/earn-premium\.css/);
assert.match(boot,/js\/earn-premium\.js/);
assert.doesNotMatch(html,/<script[^>]*src="\.\/js\/earn-premium\.js"/);
for(const term of ['.earn-signature','.earn-hero','.earn-stage','.earn-step-grid','.earn-faq','@media(max-width:540px)','@media(prefers-reduced-motion:reduce)',':focus-visible'])
 assert(css.includes(term),'Missing responsive design contract '+term);
assert.match(sw,/function networkFirst\(req/);

// V1.1153: recurring order reward MUST NOT be gated by the first qualifying order.
const recurringSql=read('supabase/migrations/20261122202350_recurring_referral_orders_v1_1153.sql');
assert.match(recurringSql,/create or replace function public\.grant_order_rewards/i);
assert.match(recurringSql,/where referred_user_id=v_order\.customer_id/);
assert.match(recurringSql,/and v_referral\.created_at<=v_order\.created_at/);
assert.doesNotMatch(recurringSql,/and \(v_referral\.qualified_order_id is null or v_referral\.qualified_order_id=v_order\.id\)/);
assert.match(recurringSql,/set qualified_order_id=v_order\.id/);
assert.match(recurringSql,/where order_id=v_order\.id/);
assert.match(recurringSql,/on conflict\(idempotency_key\) do nothing/);
assert.match(recurringSql,/v_order\.financial_reversed_at is not null/);
assert.match(recurringSql,/v_order\.payment_confirmed_at is null/);
assert.match(recurringSql,/v_platform_contribution<v_minimum_contribution/);
assert.match(recurringSql,/'purchaseType',case when v_referral\.qualified_order_id is null then 'first' else 'repeat' end/);
assert.match(recurringSql,/revoke all on function public\.grant_order_rewards\(uuid\) from public, anon, authenticated/);
for(const feeBps of [650,700,750,800,900]){
 const cents=12000,variable=75,minimum=250,cashback=100,referral=200;
 const platformFee=Math.floor(cents*feeBps/10000);
 const variableReserve=Math.min(platformFee,Math.ceil(cents*variable/10000));
 const minimumContribution=Math.min(platformFee-variableReserve,Math.ceil(cents*minimum/10000));
 const cashbackTarget=Math.floor(cents*cashback/10000);
 const referralTarget=Math.floor(cents*referral/10000);
 assert.ok(platformFee-variableReserve-minimumContribution-cashbackTarget>=referralTarget,
  'Plano comercial de '+feeBps+'bps precisa financiar os 2% nas compras de R$ 120');
}
assert.match(page,/inclusive recompras de um mesmo cliente indicado/);
assert.match(page,/cada compra qualificada/);
assert.doesNotMatch(page,/Compras posteriores não geram outra comissão/);

console.log('TAMÃO Rede premium PASS: financial clarity, honest example, valid routes, lazy assets and mobile styles.');

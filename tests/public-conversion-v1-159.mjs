import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(name)=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const customer=read('js/customer.js');
const growth=read('js/growth.js');
const acquisition=read('js/acquisition.js');
const css=read('css/components.css');
const html=read('index.html');

const checks=[
 [customer,'Faltou em casa?','hero orientado à necessidade'],
 [customer,'Tá na mão.','promessa central TAMÃO'],
 [customer,'hero-emotional-promise','ganho emocional sem dado inventado'],
 [customer,'startCustomerAvailability()','ação direta de consulta'],
 [customer,'outsideOriginalMarket','consulta de cobertura em outras cidades'],
 [customer,'Ainda não encontramos uma revenda que entregue neste CEP.','indisponibilidade real'],
 [customer,'publicP13PriceReference()','referência P13 com preço sem preferência de marca'],
 [customer,'EXEMPLO DE JORNADA','demonstração visual declarada como exemplo'],
 [customer,'Consultar meu CEP','intenção compra / cobertura'],
 [customer,'Entender como funciona','intenção confiança'],
 [customer,'Conhecer os benefícios','intenção benefícios'],
 [customer,'Cadastrar minha empresa','intenção revenda'],
 [growth,'Você cuida do seu negócio.','convite verdadeiro para revendas'],
 [growth,'O TAMÃO ajuda mais gente a encontrá-lo.','possibilidade de descoberta sem pedidos garantidos'],
 [growth,'Recebimento direto na revenda','fluxo financeiro sem repasse'],
 [growth,'merchantMarginExample','simulador preservado'],
 [growth,'FAÇA AS CONTAS DO SEU JEITO','CTA sobre custos claros'],
];
for(const [source,value,label] of checks.filter(x=>x[2]!=='DO_NOT_ASSERT')){
 assert.ok(source.includes(value),'Missing public conversion behavior: '+label);
}
for(const [src,fragment] of [
 [growth,'Não para receber na entrega.'],
 [growth,'não para prometer lucro'],
 [growth,'Sem exclusividade'],
 [growth,'A taxa do TAMÃO só é cobrada sobre pedidos concluídos'],
 [growth,'Quero levar minha empresa ao TAMÃO'],
 [acquisition,'AVISO DE DISPONIBILIDADE'],
 [acquisition,'Sem compromisso de compra'],
 [acquisition,'Me avise quando puder pedir'],
 [acquisition,'Autorizo o TAMÃO a entrar em contato'],
 [acquisition,'Quero apresentar minha empresa'],
 [html,'Faltou em casa? Tá na mão.'],
 [html,'Consulte disponibilidade, compare preço e prazo'],
 [css,'@media(prefers-reduced-motion:reduce)'],
 [css,':focus-visible'],
 [css,'.hero-emotional-promise'],
 [css,'.conversion-mini-proof'],
 [css,'.journey-invite']
]){
 assert.ok(src.includes(fragment),'Missing safe persuasive contract: '+fragment);
}
assert.ok(
 growth.includes("DEFAULT_MERCHANT_PILOT_FEE_RATE=0.075")
 &&growth.includes("currentCommercialRate('platformFeeBps'")
 &&growth.includes("merchant-sim-product-cost"),
 'Real commercial policy and product costs must govern simulator'
);
assert.ok(customer.includes("market?.realSupplyConfigured===false")
 &&customer.includes("hasConfirmedCityOffers")
 &&customer.includes("cityEvidence.postalCode===String(state.postalCode")
 &&customer.includes("rememberedMarketRegion"),
 'Home must not fabricate a live partner or hide geography'
);
assert.ok(growth.includes('O TAMÃO não recebe a venda para depois repassar.')
 &&growth.includes('O recebimento do cliente fica com a revenda.'),
 'No marketplace custody or seller transfer claims');
for(const fabricated of [
 'Mais de 10.000 clientes','Pedidos garantidos','Renda garantida',
 'Entrega garantida','Só hoje, 90% OFF','Avaliado por 5 estrelas'
]){
 assert.ok(!customer.includes(fabricated)&&!growth.includes(fabricated),
  'Fabricated claim must stay absent: '+fabricated);
}
console.log('V1.159 public conversion: benefit-led copy, honest CTA, PSP neutrality, geography and accessible mobile UI preserved.');

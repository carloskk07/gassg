import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(name)=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const customer=read('js/customer.js');
const acquisition=read('js/acquisition.js');
const growth=read('js/growth.js');
const merchant=read('js/merchant.js');

for(const [source,phrase,why] of [
 [customer,'Quer saber mais ou tem uma revenda?','acolhimento inicial para clientes e empresas'],
 [customer,'Você escolhe. A revenda confirma. Você acompanha.','aceite explícito'],
 [customer,'E se a revenda não puder entregar?','explicação simples de imprevistos'],
 [customer,'Ainda não encontramos uma revenda que entregue neste CEP.','falta de atendimento sem falsa oferta'],
 [acquisition,'Veja se já há entrega para o seu CEP.','consulta por região'],
 [acquisition,'Seu pedido de aviso para','confirmação do interesse sem simular atendimento'],
 [acquisition,'Esse contato não libera vendas.','entrada gradual da revenda'],
 [growth,'Escolha o que precisa. Confira a entrega. Acompanhe seu pedido.','página de explicação'],
 [growth,'A taxa do TAMÃO só é cobrada sobre pedidos concluídos.','política comercial sem engano'],
 [growth,'O cliente paga diretamente à sua revenda','dinheiro do cliente direto ao fornecedor'],
 [merchant,'Entrar no painel da revenda','login com destino claro'],
 [merchant,'O cadastro da empresa passa por conferência','liberação comercial controlada']
]){
 assert.ok(source.includes(phrase),'Texto essencial ausente: '+why);
}
for(const [source,phrase] of [
 [customer,'Seu próximo passo é simples.'],
 [customer,'Confiança não é promessa. É confirmação.'],
 [acquisition,'no nosso radar.'],
 [growth,'todos os gates.'],
 [growth,'Clube Plus'],
 [merchant,'A operação da revenda não possui modo fictício em produção.']
]){
 assert.ok(!source.includes(phrase),'Jargão ou promessa artificial reapareceu: '+phrase);
}
assert.ok(customer.includes('hasConfirmedCityOffers')&&customer.includes('outsideOriginalMarket'),
 'O texto não pode substituir a checagem real de CEP/disponibilidade');
assert.ok(acquisition.includes('prelaunchLeadSent(\'customer\')'),
 'O formulário de interesse mantém a deduplicação por cliente');
assert.ok(growth.includes("currentCommercialRate('platformFeeBps'"),
 'A taxa apresentada ainda deve vir da política comercial');
assert.ok(merchant.includes("rt.status==='no-access'"),
 'Copiar textos não pode substituir autorização de acesso à revenda');
console.log('TAMÃO linguagem natural: mensagens objetivas, ausência de promessa inventada e contratos de segurança preservados.');

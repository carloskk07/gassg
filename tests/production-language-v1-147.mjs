import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

const html=read('index.html');
const customer=read('js/customer.js');
const acquisition=read('js/acquisition.js');
const growth=read('js/growth.js');
const merchant=read('js/merchant.js');
const legal=read('js/legal.js');
const core=read('js/core.js');
const backend=read('js/backend.js');
const admin=read('js/admin.js');
const adminAcquisition=read('js/admin-acquisition.js');
const adminOps=read('supabase/functions/admin-ops/index.ts');
const checkout=read('supabase/functions/order-payment-checkout/index.ts');
const createOrder=read('supabase/functions/create-order/index.ts');
const merchantOrders=read('supabase/functions/merchant-orders/index.ts');
const merchantApplication=read('supabase/functions/submit-merchant-application/index.ts');

assert.ok(
  html.includes('content="index,follow,max-image-preview:large"')
  &&html.includes('Consulte disponibilidade, compare preço e prazo')
  &&html.includes('cadastre sua empresa para vender pelo TAMÃO'),
  'site público deve se apresentar como produto operacional e indexável'
);

for(const forbidden of [
  'PRÉ-LANÇAMENTO EM SÃO GABRIEL',
  'Pré-lançamento.',
  'Lista de abertura',
  'PRIMEIRO PARCEIRO PILOTO',
  'antes da abertura',
  'Parceiro Fundador',
  'PARCEIRO FUNDADOR',
  'ENTRADA NO PILOTO'
]){
  assert.equal(
    customer.includes(forbidden)||acquisition.includes(forbidden)||growth.includes(forbidden)
      ||merchant.includes(forbidden)||legal.includes(forbidden)||core.includes(forbidden),
    false,
    'linguagem pública de produto experimental não pode voltar: '+forbidden
  );
}

assert.ok(
  customer.includes("'Consultar disponibilidade'")
  &&customer.includes('confirmar disponibilidade, revenda e valor final')
  &&customer.includes('Nenhuma opção disponível para este CEP agora.')
  &&!customer.includes('DEMONSTRAÇÃO DO PRÉ-LANÇAMENTO'),
  'cliente deve receber preço de referência com disponibilidade real, não cards fictícios de pré-lançamento'
);

assert.ok(
  acquisition.includes('ATENDIMENTO POR REGIÃO')
  &&acquisition.includes('AVISO DE DISPONIBILIDADE')
  &&acquisition.includes('CADASTRO DE PARCEIRO')
  &&acquisition.includes('VENDA PELO TAMÃO'),
  'aquisição deve parecer fluxo normal de cobertura e cadastro'
);

assert.ok(
  core.includes('Disponibilidade</button>')
  &&core.includes("'Disponibilidade','lead'")
  &&core.includes('Pediu? Tá na mão. • São Gabriel/RS'),
  'navegação global não pode manter linguagem de abertura'
);

assert.ok(
  growth.includes('Venda, recebimento e taxa TAMÃO são separados.')
  &&growth.includes('O TAMÃO não recebe a venda para depois repassar.')
  &&growth.includes('O recebimento do cliente fica com a revenda.')
  &&growth.includes('Como recebo o dinheiro da venda?')
  &&growth.includes('Cadastrar minha empresa'),
  'página de revendas deve comunicar dinheiro direto e onboarding normal'
);

assert.ok(
  merchant.includes("pilotInvite||prospectInvite?'CONVITE DE PARCEIRO':'PAINEL DA REVENDA'")
  &&merchant.includes("directEnabled?'INTEGRAÇÃO VERIFICADA':'CONECTADO'")
  &&merchant.includes('Faixa automática de preço')
  &&!merchant.includes('Faixa automática do piloto'),
  'portal da revenda não pode expor fase experimental'
);

assert.ok(
  legal.includes("'PRIVACIDADE • TAMÃO'")
  &&legal.includes("'TERMOS • TAMÃO'")
  &&legal.includes('<h2>1. Disponibilidade do serviço</h2>')
  &&legal.includes('<h2>3. Empresas parceiras</h2>')
  &&!legal.includes('versão de pré-lançamento'),
  'documentos públicos devem refletir operação por disponibilidade'
);

assert.ok(
  backend.includes('A compra online exige o endereço oficial e seguro do TAMÃO.')
  &&backend.includes('Este convite de parceiro expirou.')
  &&!backend.includes('Este convite piloto expirou.'),
  'mensagens de runtime devem usar linguagem de produto'
);

assert.ok(
  admin.includes("PRELAUNCH:'CONFIGURAÇÃO'")
  &&admin.includes("PILOT:'OPERAÇÃO ATIVA'")
  &&admin.includes("LIVE:'OPERAÇÃO NORMAL'")
  &&admin.includes("PAUSED:'OPERAÇÃO PAUSADA'")
  &&admin.includes('Verificar ativação')
  &&admin.includes('Ativar confirmação automática')
  &&admin.includes("activationKind==='pilot'?'ATIVAR PAGAMENTOS':'REATIVAR'")
  &&admin.includes('INTEGRAÇÃO VERIFICADA')
  &&admin.includes('PAGAMENTOS AUTOMÁTICOS'),
  'Admin deve traduzir enums técnicos para linguagem operacional profissional'
);

for(const forbidden of [
  'ATIVAR OPERAÇÃO PILOTO',
  'Voltar a PRELAUNCH',
  'Pilotos vivos',
  'PILOTOS PSP',
  'Preflight V1.146 aprovado.',
  'Primeiro piloto real ativado',
  'Convite piloto criado'
]){
  assert.equal(admin.includes(forbidden),false,'jargão interno não pode reaparecer no Admin: '+forbidden);
}

assert.ok(
  adminAcquisition.includes('AQUISIÇÃO • CLIENTES E PARCEIROS')
  &&!adminAcquisition.includes('AQUISIÇÃO • PRÉ-LANÇAMENTO'),
  'funil administrativo deve representar aquisição contínua'
);

assert.ok(
  adminOps.includes('Controle global de pagamentos')
  &&adminOps.includes('A confirmação automática não pode ser ativada')
  &&checkout.includes('Pagamento online direto à revenda está temporariamente indisponível.')
  &&checkout.includes('Esta revenda possui uma transação automática em validação')
  &&createOrder.includes('Esta oferta não está mais disponível para esta operação.')
  &&merchantOrders.includes('Este papel não possui acesso ao painel operacional desta conta.')
  &&merchantApplication.includes('Convite de parceiro inválido.'),
  'erros server-side visíveis também precisam usar linguagem operacional'
);

assert.ok(
  admin.includes("adminSetOperationMode('PILOT')")
  &&admin.includes("adminSetOperationMode('LIVE')")
  &&admin.includes("action:'merchant-payment-preflight'")
  &&adminOps.includes('"merchant-payment-preflight"'),
  'V1.147 não pode renomear contratos internos e quebrar a autoridade existente'
);

console.log('V1.147 passou: linguagem comunica operação normal sem mascarar indisponibilidade real.');

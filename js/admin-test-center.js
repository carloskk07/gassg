/* TAMÃO V1.1055 — navigation-only QA hub.
   Only the server-authorized superadmin workspace invokes this view.
   No cross-origin token, impersonation, privileged iframe or database write. */
/* V1.1057 — test without a second account: isolated interactive demo FIRST.
   Production pages remain distinct, and no admin token crosses origins. */
function adminTestCenterView(){
  if(!adminReady()||adminCurrentRole()!=='superadmin')return '';
  const demoBase='https://carloskk07.github.io/gassg/?tamao_demo_role=';
  const demoChoices=[
    ['Cliente — compra e pedido','customer','Escolher produtos e montar pedidos fictícios'],
    ['Acompanhar pedido','tracking','Consultar pedidos criados neste navegador'],
    ['Revenda — atendimento','merchant','Aceitar e preparar pedidos simulados'],
    ['Entregador','driver','Chegada, PIN e conclusão fictícia'],
    ['Clube e benefícios','club','Explorar uma conta demonstrativa'],
    ['Rede e indicações','network','Ver benefícios fictícios e suas origens'],
    ['Agenda profissional','agenda','Criar e cancelar reservas fictícias'],
    ['Admin demonstrativo','admin','Ver os pedidos simulados sem sair do teste']
  ];
  const publicPages=[
    ['Home e produtos','https://tamao.com.br/#home','Vitrine e preços publicados'],
    ['Carrinho e pedido','https://tamao.com.br/#order','Fluxo comercial real'],
    ['Meus pedidos','https://tamao.com.br/#tracking','Conta do comprador quando necessária'],
    ['Minha conta e Clube','https://tamao.com.br/#club','Pode exigir autenticação'],
    ['Rede e indicações','https://tamao.com.br/#earn','Pode exigir autenticação'],
    ['Profissionais','https://tamao.com.br/#professionals','Diretório público'],
    ['Agenda','https://tamao.com.br/agenda/','Reservas reais exigem identificação'],
    ['Moto e carro','https://tamao.com.br/#mobility','Solicitações e cadastros reais'],
    ['Caronas','https://tamao.com.br/#rides','Anúncios reais e acesso da conta'],
    ['Para revendas','https://tamao.com.br/#merchants','Apresentação'],
    ['Para marcas','https://tamao.com.br/#sponsors','Apresentação'],
    ['Publicidade','https://tamao.com.br/#advertise','Acesso real de anúncios'],
    ['Como funciona','https://tamao.com.br/#learn','Orientações'],
    ['Contato e ajuda','https://tamao.com.br/#contact','Atendimento'],
    ['Hospedagens','https://tamao.com.br/#stays','Rota temporariamente suspensa'],
    ['Privacidade','https://tamao.com.br/#privacy','Política pública'],
    ['Termos','https://tamao.com.br/#terms','Condições públicas'],
    ['Cadastro de revenda','https://tamao.com.br/#merchant-join','Cadastro real'],
    ['Página de convite','https://tamao.com.br/#refer','Convite público'],
    ['Portal da revenda','https://parceiro.tamao.com.br/','Exige login da revenda']
  ];
  const checks=[
    ['Pedidos e entregas','orders','Fluxos e histórico no Admin'],
    ['Clientes','customers','Cadastros e atendimento'],
    ['Revendas e equipe','partners','Verificação e operações'],
    ['Catálogo','catalog','Produtos e disponibilidade'],
    ['Cupons e indicações','growth','Benefícios e Rede TAMÃO'],
    ['Financeiro e Pix','finance','Conciliação e homologação'],
    ['Publicidade','ads','Campanhas e diagnóstico'],
    ['Profissionais e anúncios','discovery','Moderação'],
    ['Alertas','alerts','Ocorrências'],
    ['Sistema','system','Saúde dos portais']
  ];
  const sims=demoChoices.map(([title,scenario,description])=>
    '<a class="card flat admin-test-page-link admin-test-simulation-link" href="'+demoBase+scenario+
    '" target="_blank" rel="noopener noreferrer" data-admin-demo="'+scenario+'">'+
    '<strong>'+esc(title)+' <span aria-hidden="true">↗</span></strong>'+
    '<small>'+esc(description)+'</small>'+
    '<span class="admin-test-safe-note">Sem outro login · Somente simulação</span></a>'
  ).join('');
  const pages=publicPages.map(([title,url,description])=>
    '<a class="card flat admin-test-page-link" href="'+url+'" target="_blank" rel="noopener noreferrer">'+
    '<strong>'+esc(title)+' <span aria-hidden="true">↗</span></strong><small>'+esc(description)+'</small></a>'
  ).join('');
  const tools=checks.filter(([,section])=>adminRoleCanSection(section)).map(([title,section,description])=>
    '<button class="card flat admin-test-page-link" type="button" data-admin-test-section="'+section+'">'+
    '<strong>'+esc(title)+'</strong><small>'+esc(description)+'</small></button>'
  ).join('');
  return '<section class="section admin-test-center" aria-label="Central de testes">'+
    '<h2>Testar sem fazer outro login</h2>'+
    '<p class="muted">Clique no que deseja experimentar. Você pode alternar entre Cliente, Revenda, Entregador e outras telas em um simulador interativo. Não é preciso cadastrar contas para esses testes.</p>'+
    '<div class="notice"><strong>Ambiente demonstrativo, separado da produção.</strong> Os pedidos, horários, valores e benefícios são fictícios, não mexem nos cadastros existentes e não movimentam dinheiro. Estes atalhos não concedem acesso às contas privadas dos participantes.</div>'+
    '<div class="admin-test-links admin-test-demo-links">'+sims+'</div>'+
    '<details class="admin-test-more"><summary>Conferir páginas reais do site <span class="muted tiny">(algumas exigem login)</span></summary>'+
    '<p class="muted tiny">Aqui você abre as páginas oficiais. Para dados privados e operações reais, o site continua solicitando a conta correspondente — isso não é uma falha do modo demonstrativo.</p>'+
    '<div class="admin-test-links">'+pages+'</div></details>'+
    '<h2>Verificações no próprio Admin</h2>'+
    '<p class="muted">Estas funções utilizam seu login atual e não exigem entrar novamente.</p>'+
    '<div class="admin-test-links">'+tools+'</div>'+
    '<p class="muted tiny">Simular telas é diferente de validar transações de produção. A homologação financeira continua nas verificações autenticadas do Admin.</p>'+
    '</section>';
}
if(typeof document!=='undefined')document.addEventListener('click',function(event){
  const el=event.target?.closest?.('[data-admin-test-section]');
  if(!el||!adminReady()||adminCurrentRole()!=='superadmin')return;
  const section=el.getAttribute('data-admin-test-section');
  if(!['orders','customers','partners','catalog','growth','finance','ads','discovery','alerts','system'].includes(section))return;
  if(!adminRoleCanSection(section))return;
  adminSetSection(section);
});

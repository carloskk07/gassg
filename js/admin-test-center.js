/* TAMÃO V1.1055 — navigation-only QA hub.
   Only the server-authorized superadmin workspace invokes this view.
   No cross-origin token, impersonation, privileged iframe or database write. */
/* V1.1057 — test without a second account: isolated interactive demo FIRST.
   Production pages remain distinct, and no admin token crosses origins. */
function adminTestCenterView(){
  if(!adminReady()||adminCurrentRole()!=='superadmin')return '';
  const demoBase='https://carloskk07.github.io/gassg/?tamao_demo_role=';
  const demoChoices=[
    ['Cliente · compras','customer','Escolher produtos e fazer pedidos'],
    ['Acompanhar pedido','tracking','Ver o andamento dos pedidos'],
    ['Revenda · pedidos','merchant','Aceitar e preparar pedidos'],
    ['Entregador','driver','Chegada, PIN e conclusão'],
    ['Clube e benefícios','club','Ver compras e vantagens'],
    ['Rede e indicações','network','Ver atividades e extratos'],
    ['Agenda profissional','agenda','Organizar, reservar e cancelar horários'],
    ['Painel de pedidos','admin','Ver os pedidos do ambiente']
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
    '</a>'
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
    '<h2>Testar páginas</h2>'+
    '<p class="muted">Escolha uma área e experimente os fluxos sem outro login.</p>'+
    '<p class="admin-test-context"><span aria-hidden="true">●</span> Modo teste · dados fictícios · sem cobranças</p>'+
    '<div class="admin-test-links admin-test-demo-links">'+sims+'</div>'+
    '<details class="admin-test-more"><summary>Abrir páginas oficiais <span class="muted tiny">(acesso autenticado quando necessário)</span></summary>'+
    '<p class="muted tiny">Para operações privadas, use a conta autorizada correspondente.</p>'+
    '<div class="admin-test-links">'+pages+'</div></details>'+
    '<h2>Verificações no próprio Admin</h2>'+
    '<p class="muted">Acesse as ferramentas com sua sessão administrativa atual.</p>'+
    '<div class="admin-test-links">'+tools+'</div>'+

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

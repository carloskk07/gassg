/* TAMÃO V1.1055 — navigation-only QA hub.
   Only the server-authorized superadmin workspace invokes this view.
   No cross-origin token, impersonation, privileged iframe or database write. */
/* V1.1060 — Official TAMÃO pages FIRST, genuine admin management next.
   Optional simulation is relegated to a collapsed diagnostics section.
   Never transfer admin tokens across origins or enter a participant account. */
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
  // Real official endpoints. These are navigation links, not impersonation.
  // Every private participant action still requires its own authorization.
  const publicPages=[
    ['Início e produtos','https://tamao.com.br/#home','Página principal e ofertas públicas'],
    ['Comprar','https://tamao.com.br/#order','Carrinho e pedidos no ambiente oficial'],
    ['Acompanhar pedido','https://tamao.com.br/#tracking','Pedidos vinculados à conta autorizada'],
    ['Clube TAMÃO','https://tamao.com.br/#club','Cupons, cashback e benefícios'],
    ['Rede e indicações','https://tamao.com.br/#earn','Convites e vantagens do TAMÃO'],
    ['Minha rede','https://tamao.com.br/#refer','Links e extratos da conta autorizada'],
    ['Profissionais','https://tamao.com.br/#professionals','Diretório de profissionais reais'],
    ['Agenda profissional','https://tamao.com.br/agenda/','Página oficial de agendamentos'],
    ['Moto e carro','https://tamao.com.br/#mobility','Serviços e solicitações'],
    ['Caronas','https://tamao.com.br/#rides','Anúncios e viagens'],
    ['Publicidade','https://tamao.com.br/#advertise','Cadastro de anúncios e serviços'],
    ['Marcas e anunciantes','https://tamao.com.br/#sponsors','Apresentação comercial'],
    ['Revendas','https://tamao.com.br/#merchants','Conheça o canal das revendas'],
    ['Cadastro de revenda','https://tamao.com.br/#merchant-join','Inscrição real de empresas'],
    ['Portal de revendas','https://parceiro.tamao.com.br/','Área particular de cada revenda'],
    ['Como funciona','https://tamao.com.br/#learn','Ajuda para comprar e participar'],
    ['Ajuda e contato','https://tamao.com.br/#contact','Atendimento e suporte'],
    ['Privacidade e dados','https://tamao.com.br/#privacy','Política de privacidade'],
    ['Termos','https://tamao.com.br/#terms','Regras da plataforma']
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
  const pages=publicPages.map(([title,url,description])=>
    '<a class="card flat admin-test-page-link" href="'+url+'" target="_blank" rel="noopener noreferrer" data-admin-official-page>'+
    '<strong>'+esc(title)+' <span aria-hidden="true">↗</span></strong><small>'+esc(description)+'</small></a>'
  ).join('');
  const tools=checks.filter(([,section])=>adminRoleCanSection(section)).map(([title,section,description])=>
    '<button class="card flat admin-test-page-link" type="button" data-admin-test-section="'+section+'">'+
    '<strong>'+esc(title)+'</strong><small>'+esc(description)+'</small></button>'
  ).join('');
  const sims=demoChoices.map(([title,scenario,description])=>
    '<a class="card flat admin-test-page-link admin-test-simulation-link" href="'+demoBase+scenario+
    '" target="_blank" rel="noopener noreferrer" data-admin-demo="'+scenario+'">'+
    '<strong>'+esc(title)+' <span aria-hidden="true">↗</span></strong><small>'+esc(description)+'</small></a>'
  ).join('');
  return '<section class="section admin-test-center" aria-label="Acessar áreas oficiais">'+
    '<h2>Áreas oficiais do TAMÃO</h2>'+
    '<p class="muted">Abra as páginas reais para verificar a aparência, o conteúdo e a navegação. Não é uma simulação.</p>'+
    '<div class="admin-test-links admin-official-links">'+pages+'</div>'+
    '<h2>Gerenciar e ajudar participantes</h2>'+
    '<p class="muted">Use a busca na parte superior do Admin para localizar um cliente, pedido ou revenda e abrir seu histórico 360°. Para cadastros, ofertas, benefícios ou anúncios, entre nas ferramentas correspondentes abaixo.</p>'+
    '<div class="admin-test-links admin-official-management">'+tools+'</div>'+
    '<p class="admin-support-scope">O Admin consulta e gerencia os registros dentro das permissões de cada operação. Abrir o portal privado de uma revenda ou a conta de um profissional não substitui a autenticação desse participante. Alterações feitas em seu nome precisam de uma ferramenta administrativa autorizada e registro de auditoria.</p>'+
    '<details class="admin-test-more"><summary>Testes isolados (opcional)</summary>'+
    '<p class="admin-test-context"><span aria-hidden="true">●</span> Modo teste · dados fictícios · sem cobranças</p>'+
    '<p class="muted tiny">Para ensaiar pedidos, entregas ou horários sem usar dados reais.</p>'+
    '<div class="admin-test-links admin-test-demo-links">'+sims+'</div></details>'+
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

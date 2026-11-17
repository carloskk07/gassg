/* TAMÃO V1.1055 — navigation-only QA hub.
   Only the server-authorized superadmin workspace invokes this view.
   No cross-origin token, impersonation, privileged iframe or database write. */
function adminTestCenterView(){
  if(!adminReady()||adminCurrentRole()!=='superadmin')return '';
  const publicPages=[
    ['Home e produtos','https://tamao.com.br/#home','Vitrine, CEP e vantagens'],
    ['Carrinho e pedido','https://tamao.com.br/#order','Fluxo público de compra'],
    ['Meus pedidos','https://tamao.com.br/#tracking','Status e acesso do comprador'],
    ['Minha conta e Clube','https://tamao.com.br/#club','Entrada, cupons e cashback'],
    ['Rede e indicações','https://tamao.com.br/#earn','Convites e extrato'],
    ['Profissionais','https://tamao.com.br/#professionals','Encontrar prestadores'],
    ['Agenda','https://tamao.com.br/agenda/','Reservar ou administrar horários'],
    ['Moto e carro','https://tamao.com.br/#mobility','Viagens e fretes'],
    ['Caronas','https://tamao.com.br/#rides','Ofertas e solicitações'],
    ['Para revendas','https://tamao.com.br/#merchants','Apresentação e inscrição'],
    ['Para marcas','https://tamao.com.br/#sponsors','Apresentação institucional'],
    ['Publicidade','https://tamao.com.br/#advertise','Anunciar e acompanhar'],
    ['Como funciona','https://tamao.com.br/#learn','Orientações para visitantes'],
    ['Contato e ajuda','https://tamao.com.br/#contact','Atendimento e relatos'],
    ['Hospedagens','https://tamao.com.br/#stays','Rota suspensa: conferir aviso'],
    ['Privacidade e termos','https://tamao.com.br/#privacy','Informações legais']
  ];
  const checks=[
    ['Pedidos e entregas','orders','Histórico, etapas e testes internos'],
    ['Clientes','customers','Visão administrativa autorizada'],
    ['Revendas e equipe','partners','Cadastros, catálogos e operação'],
    ['Catálogo','catalog','Produtos e disponibilidade'],
    ['Cupons e indicações','growth','Benefícios e Rede TAMÃO'],
    ['Financeiro e Pix','finance','Homologação e conciliação'],
    ['Publicidade','ads','Campanhas, pagamento e diagnóstico'],
    ['Profissionais e anúncios','discovery','Moderação de anúncios'],
    ['Alertas','alerts','Ocorrências e prevenção'],
    ['Sistema','system','Situação e segurança dos portais']
  ];
  const links=publicPages.map(([name,url,description])=>
    '<a class="card flat admin-test-page-link" href="'+url+'" target="_blank" rel="noopener noreferrer">'+
    '<strong>'+esc(name)+' <span aria-hidden="true">↗</span></strong><small>'+esc(description)+'</small></a>'
  ).join('');
  const tools=checks.filter(([,section])=>adminRoleCanSection(section)).map(([name,section,description])=>
    '<button class="card flat admin-test-page-link" type="button" data-admin-test-section="'+section+'">'+
    '<strong>'+esc(name)+'</strong><small>'+esc(description)+'</small></button>'
  ).join('');
  return '<section class="section admin-test-center" aria-label="Central de testes">'+
    '<div class="notice"><strong>Seu login administrativo já está ativo.</strong> Abra páginas públicas sem outro login e consulte as verificações internas usando a mesma sessão. Estes atalhos não criam pedidos ou cobranças.</div>'+
    '<h2>Páginas da plataforma</h2>'+
    '<p>Abra a tela real em uma nova aba para conferir seu funcionamento, inclusive no celular.</p>'+
    '<div class="admin-test-links">'+links+'</div>'+
    '<h2>Conferir dentro do Admin</h2>'+
    '<p>Todos estes controles já usam as permissões conferidas na sua conta administrativa.</p>'+
    '<div class="admin-test-links">'+tools+'</div>'+
    '<h2>Áreas protegidas</h2>'+
    '<p>Para consultar a operação de uma revenda, use a área Revendas acima. O portal do parceiro continua exigindo uma identidade autorizada para operar.</p>'+
    '<div class="admin-test-links">'+
    '<a class="card flat admin-test-page-link" href="https://parceiro.tamao.com.br/" target="_blank" rel="noopener noreferrer"><strong>Painel da revenda ↗</strong><small>Acesso específico para ações como parceiro ou entregador.</small></a>'+
    '<a class="card flat admin-test-page-link" href="https://admin.tamao.com.br/" target="_blank" rel="noopener noreferrer"><strong>Admin ↗</strong><small>Seu próprio painel autenticado.</small></a>'+
    '</div>'+
    '<p class="muted tiny">Testar como outra pessoa sem novo login exige futura autorização delegada do servidor, com escopo e auditoria. Abrir uma tela não dá ao Admin permissão de criar operações em nome de terceiros.</p>'+
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

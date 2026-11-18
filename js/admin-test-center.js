/* TAMÃO V1.1055 — navigation-only QA hub.
   Only the server-authorized superadmin workspace invokes this view.
   No cross-origin token, impersonation, privileged iframe or database write. */
/* V1.1060 — Official TAMÃO pages FIRST, genuine admin management next.
   Optional simulation is relegated to a collapsed diagnostics section.
   Never transfer admin tokens across origins or enter a participant account. */
/* V1.1061 — one lookup, verified real participants, and direct audited Admin tools.
   This hub never creates a participant session or transfers the Admin's token. */
function adminSupportHubSearch(event){
  event?.preventDefault?.();
  if(!adminReady()||adminCurrentRole()!=='superadmin')return false;
  const field=document.getElementById('admin-support-search');
  const value=String(field?.value||'').trim().slice(0,120);
  const feedback=document.getElementById('admin-support-hub-feedback');
  if(value.length<2){
    if(feedback)feedback.textContent='Digite pelo menos dois caracteres para buscar.';
    field?.focus();
    return false;
  }
  if(typeof adminRunSearch==='function')void adminRunSearch(value);
  return false;
}
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

  const rt=typeof adminRuntime==='object'&&adminRuntime?adminRuntime:null;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const merchants=Array.isArray(rt?.data?.merchants)
    ?rt.data.merchants.filter(m=>m&&uuid.test(String(m.id||''))).slice(0,5):[];
  const recentCustomers=typeof adminRecentCustomers==='function'&&rt?.data
    ?adminRecentCustomers(rt.data).filter(c=>uuid.test(String(c.id||''))).slice(0,5):[];
  const query=String(rt?.searchQuery||'').slice(0,120);
  const pending=rt?.searchPending===true;
  const results=Array.isArray(rt?.searchResults)?rt.searchResults.slice(0,10):[];
  const resultCards=results.map(r=>{
    const type=String(r?.type||''),id=String(r?.id||'');
    if(!['order','merchant','customer'].includes(type)||!id||id.length>120)return '';
    return '<button type="button" class="admin-support-result" data-admin-support-entity="'+esc(type)+
      '" data-admin-support-id="'+esc(id)+'"><strong>'+esc(r.title||r.id)+
      '</strong><span>'+esc(r.subtitle||({merchant:'Revenda',customer:'Cliente',order:'Pedido'})[type])+
      '</span><span aria-hidden="true">Ver 360° →</span></button>';
  }).join('');
  const contactCards=[
    ...merchants.map(m=>'<article class="admin-support-person"><div class="admin-support-person-head">'+
      '<strong>'+esc(m.name||'Revenda')+'</strong>'+
      '<small>Revenda • '+esc(m.status||'Cadastro')+'</small></div>'+
      '<div class="admin-support-person-actions"><button type="button" data-admin-support-entity="merchant" data-admin-support-id="'+esc(m.id)+'">Ver 360°</button>'+
      '<button type="button" data-admin-support-merchant-controls="'+esc(m.id)+'">Configurar revenda</button></div></article>'),
    ...recentCustomers.map(c=>{
      const digits=String(c.phone||'').replace(/\D/g,'');
      return '<article class="admin-support-person"><div class="admin-support-person-head"><strong>Cliente'+(digits?' · final '+esc(digits.slice(-4)):'')+'</strong>'+
        '<small>'+esc(c.lastOrder||'Pedido recente')+' • '+Number(c.orders||0)+' pedido(s)</small></div>'+
        '<div class="admin-support-person-actions"><button type="button" data-admin-support-entity="customer" data-admin-support-id="'+esc(c.id)+'">Ver histórico 360°</button></div></article>';
    })
  ].join('');
  const checksPrimary=checks.slice(0,8),checksMore=checks.slice(8);
  const toolCards=items=>items.filter(([,section])=>adminRoleCanSection(section)).map(([title,section,description])=>
    '<button class="card flat admin-test-page-link" type="button" data-admin-test-section="'+section+'">'+
    '<strong>'+esc(title)+'</strong><small>'+esc(description)+'</small></button>'
  ).join('');
  const officialGroups=[
    {title:'Compras e benefícios',items:publicPages.slice(0,6)},
    {title:'Serviços e agendamentos',items:publicPages.slice(6,11)},
    {title:'Negócios e parceiros',items:publicPages.slice(11,15)},
    {title:'Ajuda e informações',items:publicPages.slice(15)}
  ];
  const officialLink=([title,url,description])=>
    '<a class="card flat admin-test-page-link" href="'+url+'" target="_blank" rel="noopener noreferrer" data-admin-official-page>'+
    '<strong>'+esc(title)+' <span aria-hidden="true">↗</span></strong><small>'+esc(description)+'</small></a>';
  const officialBlocks=officialGroups.map((g,i)=>
    (i===0?'<section class="admin-official-group"><h3>'+esc(g.title)+'</h3>':
      '<details class="admin-official-group admin-test-more"><summary>'+esc(g.title)+' <span class="muted tiny">('+g.items.length+' páginas)</span></summary>')+
    '<div class="admin-test-links admin-official-links">'+g.items.map(officialLink).join('')+'</div>'+
    (i===0?'</section>':'</details>')
  ).join('');
  const sims=demoChoices.map(([title,scenario,description])=>
    '<a class="card flat admin-test-page-link admin-test-simulation-link" href="'+demoBase+scenario+
    '" target="_blank" rel="noopener noreferrer" data-admin-demo="'+scenario+'">'+
    '<strong>'+esc(title)+' <span aria-hidden="true">↗</span></strong><small>'+esc(description)+'</small></a>'
  ).join('');
  return '<section class="section admin-test-center" aria-label="Acessar áreas oficiais">'+
    '<h2>Áreas oficiais do TAMÃO</h2>'+
    '<p class="muted">Encontre participantes, confira a operação real e ajude a configurar cada área usando sua conta de administrador.</p>'+
    '<section class="admin-support-hub" aria-label="Atendimento administrativo">'+
    '<div class="admin-support-hub-heading"><h3>Localizar e ajudar alguém</h3><small>Consulta ao TAMÃO real</small></div>'+
    '<form class="admin-support-hub-search" onsubmit="return adminSupportHubSearch(event)">'+
    '<label for="admin-support-search">Cliente, revenda, número do pedido, telefone ou CNPJ</label>'+
    '<div class="admin-support-hub-search-row"><input class="input" type="search" id="admin-support-search" minlength="2" maxlength="120" autocomplete="off" placeholder="Quem você precisa ajudar?" value="'+esc(query)+'" required>'+
    '<button class="primary" type="submit"'+(pending?' disabled aria-busy="true"':'')+'>'+(pending?'Buscando…':'Encontrar')+'</button></div></form>'+
    '<div id="admin-support-hub-feedback" role="status" aria-live="polite">'+
    (pending?'Consultando os registros oficiais…':query?(results.length?results.length+' registro(s) encontrados.':'Nenhum registro encontrado nesta busca.'):'Busque acima ou abra um cadastro recente abaixo.')+
    '</div>'+
    (query&&!pending&&results.length?'<div class="admin-support-results" aria-label="Resultados oficiais">'+
      (resultCards||'<p class="muted">Os resultados encontrados não podem ser abertos nesta visão.</p>')+'</div>':'')+
    '<div class="admin-support-hub-recent"><h4>Participantes com atividade recente</h4>'+
    (contactCards?'<div class="admin-support-person-grid">'+contactCards+'</div>':
      '<p class="muted">Sem participantes recentes nesta consulta. Você pode pesquisar acima.</p>')+
    '</div></section>'+
    '<h2>Configurações e suporte</h2>'+
    '<p class="muted">Abra o controle oficial de cada módulo. Na ficha 360° de uma revenda, a opção de revisão leva diretamente aos documentos e ajustes permitidos.</p>'+
    '<div class="admin-test-links admin-official-management">'+toolCards(checksPrimary)+'</div>'+
    (checksMore.length?'<details class="admin-test-more"><summary>Outras ferramentas administrativas</summary>'+
    '<div class="admin-test-links admin-official-management">'+toolCards(checksMore)+'</div></details>':'')+
    '<h2>Visitar as páginas oficiais</h2>'+
    '<p class="muted">São as páginas publicadas que clientes e parceiros visitam. Páginas privadas continuam exigindo a conta do titular.</p>'+
    officialBlocks+
    '<p class="admin-support-scope">As consultas e configurações administrativas seguem as permissões e registros de auditoria próprios de cada módulo. O Admin não entra na conta do participante nem confirma pagamentos ou reservas em nome dele apenas por abrir um link.</p>'+
    '<details class="admin-test-more"><summary>Testes isolados (opcional)</summary>'+
    '<p class="admin-test-context"><span aria-hidden="true">●</span> Modo teste · dados fictícios · sem cobranças</p>'+
    '<div class="admin-test-links admin-test-demo-links">'+sims+'</div></details>'+
    '</section>';

}
if(typeof document!=='undefined')document.addEventListener('click',function(event){
  if(!adminReady()||adminCurrentRole()!=='superadmin')return;
  const entity=event.target?.closest?.('[data-admin-support-entity]');
  if(entity){
    const type=entity.getAttribute('data-admin-support-entity');
    const id=entity.getAttribute('data-admin-support-id');
    if(['order','customer','merchant'].includes(type)&&id&&id.length<=120&&
      typeof adminOpenEntity==='function')void adminOpenEntity(type,id);
    return;
  }
  const controls=event.target?.closest?.('[data-admin-support-merchant-controls]');
  if(controls){
    const id=controls.getAttribute('data-admin-support-merchant-controls');
    if(id&&typeof adminMerchantReturnToControls==='function')adminMerchantReturnToControls(id);
    return;
  }
  const el=event.target?.closest?.('[data-admin-test-section]');
  if(!el)return;
  const section=el.getAttribute('data-admin-test-section');
  if(!['orders','customers','partners','catalog','growth','finance','ads','discovery','alerts','system'].includes(section))return;
  if(!adminRoleCanSection(section))return;
  adminSetSection(section);
});

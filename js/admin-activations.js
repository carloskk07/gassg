// TAMÃO V1.307 — only read protected evidence; never issue activation commands.
const adminActivationDesk={data:null,actor:null,role:null,checkedAt:null,loading:false,error:null};
async function adminActivationLoad({force=false}={}){
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  if(!adminReady()||!actor||!['superadmin','operations','readonly'].includes(role))return null;
  if(adminActivationDesk.loading)return null;
  if(!force&&adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
     Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000)return adminActivationDesk.data;
  adminActivationDesk.loading=true;adminActivationDesk.error=null;render();
  try{
    const specs=[
      ['ads','ads-placement-readiness','admin_ads_placement_readiness_v1_236'],
      ['adsQueue','ads-campaign-queue','admin_ads_campaign_queue_v1_233'],
      ['clube','clube-campaign-queue','admin_clube_campaign_queue_v1_241'],
      ['terms','clube-terms-queue','admin_clube_terms_queue_v1_242']
    ];
    const values=await Promise.allSettled([
      ...specs.map(([,action])=>adminInvoke({action})),
      adminLoadGovernanceGates({force:true}),
      adminPushReliabilityLoadFromUi()
    ]);
    if(!adminReady()||actor!==String(adminRuntime.session?.user?.id||'')||role!==adminCurrentRole())return null;
    const evidence={};
    specs.forEach(([key,,source],i)=>{
      const d=values[i].status==='fulfilled'?values[i].value:null;
      const safe=d?.source===source&&(
        key==='ads'?d.readOnly===true&&d.publicEnabled===false&&d.billingEnabled===false&&d.readyToSell===false:
        key==='adsQueue'?d.noCharge===true&&d.adsLive===false:
        key==='clube'?d.readOnly===true&&d.couponSalesEnabled===false&&d.campaignsActive===0:
        d.readOnly===true&&d.couponSalesEnabled===false&&d.noContractsSigned===true);
      evidence[key]=safe?d:null;
    });
    const governance=values[4].status==='fulfilled'?values[4].value:null;
    evidence.governance=governance?.source==='admin_governance_gates_v1_304'&&governance.readOnly===true&&
      adminRuntime.governance?.loadedFor===actor&&adminRuntime.governance?.role===role?governance:null;
    const push=adminRuntime.pushReliability||{};
    evidence.push=push.loadedFor===actor&&push.data?.source==='admin_push_reliability_v1_294'&&
      push.data.readOnly===true&&push.data.gates?.automaticDeliveryVerified===false&&
      Date.now()-Date.parse(push.checkedAt||'')<120000?push.data:null;
    adminActivationDesk.data=evidence;adminActivationDesk.actor=actor;
    adminActivationDesk.role=role;adminActivationDesk.checkedAt=new Date().toISOString();
    return evidence;
  }catch(error){
    if(actor===String(adminRuntime.session?.user?.id||'')){
      adminActivationDesk.data=null;adminActivationDesk.error='Não foi possível conferir as ativações.';
    }
    return null;
  }finally{adminActivationDesk.loading=false;render();}
}

// Navigate only to the existing guarded workflows; never perform a mutation.
function adminActivationGo(key){
  const routes={
    ads:['partners','.admin-ads-campaigns'],
    clube:['partners','.admin-clube-campaign'],
    benefits:['finance','.admin-finance-workspace-panel'],
    payments:['finance','.admin-finance-workspace-panel'],
    push:['system','.admin-governance'],
    cities:['system','.admin-governance-city-block']
  };
  const target=routes[key];
  if(!adminReady()||!adminRoleCanSection('activations')||!target||
     !adminRoleCanSection(target[0]))return;
  adminSetSection(target[0]);
  requestAnimationFrame(()=>document.querySelector(target[1])?.scrollIntoView({block:'start'}));
}
function adminActivationDeskView(d){
  if(!adminRoleCanSection('activations'))return '';
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  const current=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    adminActivationDesk.data&&Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<600000;
  const e=current?adminActivationDesk.data:{};
  const fmt=n=>Number.isSafeInteger(n)&&n>=0?n.toLocaleString('pt-BR'):'—';
  const card=(key,title,status,detail,evidence,section)=>{
    const action=adminRoleCanSection(section)
      ?'<button type="button" class="secondary small" onclick="adminActivationGo(\''+key+'\')">Abrir fluxo oficial →</button>'
      :'<small>Este perfil não pode alterar esta área.</small>';
    return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
      esc(title)+'</strong><span class="status-pill">'+esc(status)+'</span></div>'+
      '<p>'+esc(detail)+'</p><small>'+esc(evidence)+'</small>'+action+'</article>';
  };
  const cards=[
    card('ads','Publicidade TAMÃO',e.ads?'Exibição bloqueada':'Não confirmado',
      'Revisar criativos não publica campanhas nem gera cobranças.',
      e.ads?fmt(e.ads.approvedCreatives)+' criativos revisados • '+
        (e.adsQueue?fmt(e.adsQueue.submittedCount)+' pendentes':'fila sem confirmação'):'Sem evidência atual',
      'partners'),
    card('clube','Clube e patrocínios',e.clube?'Vendas bloqueadas':'Não confirmado',
      'Negociações, condições e orçamento devem ser aprovados nos fluxos protegidos.',
      e.clube?fmt(e.clube.activeInterests)+' interesses • '+
        (e.terms?fmt(e.terms.totalReviews)+' revisões de termos':'termos sem confirmação'):'Sem evidência atual',
      'partners'),
    card('benefits','Benefícios e comissões',
      Number.isSafeInteger(d?.commercialPolicy?.policy_version)?'Política registrada':'Conferir política',
      'Taxas, cashback e indicações usam regras próprias; configuração não comprova pagamento.',
      Number.isSafeInteger(d?.commercialPolicy?.policy_version)?
        'Política versão '+d.commercialPolicy.policy_version:'Sem versão financeira confirmada','finance'),
    card('push','Avisos às revendas',!e.push?'Não confirmado':
      (e.push.gates.senderEnabled||e.push.gates.cronEnabled)?'Configuração em revisão':'Automação desligada',
      'Inscrição e teste aceito pelo provedor não comprovam aviso visto no aparelho.',
      e.push?fmt(e.push.summary?.registeredDevices)+' aparelhos • '+
        fmt(e.push.summary?.reportedWarning7d)+' alertas de possível spam em 7 dias':'Sem evidência atual','system'),
    card('payments','Pagamentos',!e.governance?'Não confirmado':
      e.governance.runtime?.merchantDirectPaymentsEnabled===true?'Modo global habilitado':'Modo global desligado',
      'A configuração do ambiente não comprova homologação, cobrança nem repasse.',
      e.governance?'Verifique provedores e revendas individualmente.':'Sem evidência atual','finance'),
    card('cities','Cidades e autorização',e.governance?'Autorização por cidade':'Não confirmado',
      'Só o administrador principal autoriza o comércio. Operação global e revenda apta continuam obrigatórias.',
      e.governance?fmt(e.governance.cities?.filter(x=>x.commerceEnabled).length)+
        ' cidades autorizadas no cadastro; vendas ainda dependem de outros requisitos':'Sem evidência atual','system')
  ].join('');
  return '<section class="section admin-activation-desk" aria-label="Central de ativações estratégicas">'+
    '<div class="section-head"><div><span class="section-kicker">V1.307 • DECISÕES E EVIDÊNCIAS</span>'+
    '<h2>Ativações estratégicas</h2>'+
    '<p>Central de consulta e acesso aos controles reais. Esta tela nunca executa liberações automaticamente.</p></div>'+
    '<button type="button" class="primary small" '+(adminActivationDesk.loading?'disabled':'')+
    ' onclick="adminActivationLoad({force:true})">'+(adminActivationDesk.loading?'Conferindo…':'Atualizar tudo')+
    '</button></div>'+
    (adminActivationDesk.error?'<p class="notice danger">'+esc(adminActivationDesk.error)+'</p>':'')+
    '<p class="tiny muted">Última consulta: '+
    esc(current?formatDateTime(adminActivationDesk.checkedAt):'não confirmada')+
    '. Uma falha na consulta é mostrada como “Não confirmado”, nunca como recurso desligado.</p>'+
    '<div class="admin-activation-grid">'+cards+'</div>'+
    '<p class="tiny muted">Publicidade pública, vendas de cupons e automação de avisos exigem homologação e gates reais no servidor. Nenhum controle desta página contorna esses requisitos.</p></section>';
}

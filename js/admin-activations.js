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
      ['terms','clube-terms-queue','admin_clube_terms_queue_v1_242'],
      ['intake','commercial-intake-read','admin_marketing_intake_v1_308'],
      ['adsSalesPlans','ads-sales-plans','admin_ads_sales_plans_v1_309']
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
        key==='adsSalesPlans'?d.readOnly===true&&d.noCharge===true&&d.adsLive===false&&
          d.revenueCents===0&&d.contractsSigned===0&&
          Number.isSafeInteger(d.totalPlans)&&Number.isSafeInteger(d.approvedCreatives)&&
          Array.isArray(d.rows)&&d.rows.length<=50&&d.rows.every(x=>
            /^[0-9a-f-]{36}$/i.test(String(x.merchantId))&&typeof x.creativeEligible==='boolean'&&
            Number.isSafeInteger(x.version)&&x.version>=0):
        key==='clube'?d.readOnly===true&&d.couponSalesEnabled===false&&d.campaignsActive===0:
        key==='intake'?d.readOnly===true&&d.noMoneyMovement===true&&
          d.adsPublicationEnabled===false&&d.couponSalesEnabled===false&&
          Array.isArray(d.controls)&&d.controls.length===2&&
          new Set(d.controls.map(x=>x.moduleKey)).size===2&&
          d.controls.every(x=>['ads_proposals','clube_proposals'].includes(x.moduleKey)&&
            typeof x.enabled==='boolean'&&Number.isSafeInteger(x.version)&&x.version>0):
        d.readOnly===true&&d.couponSalesEnabled===false&&d.noContractsSigned===true);
      evidence[key]=safe?d:null;
    });
    const governance=values[6].status==='fulfilled'?values[6].value:null;
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
    '<div class="admin-activation-grid">'+cards+'</div>'+adminMarketingIntakeView()+adminAdsSalesPlansView()+
    '<p class="tiny muted">Publicidade pública, vendas de cupons e automação de avisos exigem homologação e gates reais no servidor. Nenhum controle desta página contorna esses requisitos.</p></section>';
}

// V1.308 — founder-only intake decisions; no external publication/payment.
async function adminMarketingIntakeSet(moduleKey){
  if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading)return false;
  const actor=String(adminRuntime.session?.user?.id||'');
  const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role==='superadmin'&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
  const item=fresh?adminActivationDesk.data?.intake?.controls?.find(x=>x.moduleKey===moduleKey):null;
  if(!item||!Number.isSafeInteger(item.version)||item.version<1)return false;
  const enabled=!item.enabled;
  const label=moduleKey==='ads_proposals'?'propostas de anúncios':'interesses no Clube';
  if(!confirm((enabled?'REABRIR':'SUSPENDER')+' novas '+label+
    '? Anúncios e cupons não serão publicados nem cobrados.'))return false;
  const reason=String(prompt('Justificativa obrigatória (8 a 240 caracteres):')||'').trim();
  if(reason.length<8||reason.length>240){
    toast('Informe uma justificativa de 8 a 240 caracteres.');return false;
  }
  try{
    const out=await adminPerform('commercial-intake-set',{
      moduleKey,enabled,reason,expectedVersion:item.version
    });
    if(out?.source!=='admin_marketing_intake_set_v1_308'||
       out.moduleKey!==moduleKey||out.enabled!==enabled||
       !Number.isSafeInteger(out.version)||out.adsPublicationEnabled!==false||
       out.couponSalesEnabled!==false||out.noMoneyMovement!==true)
      throw new Error('A decisão ainda não foi comprovada. Atualize o painel.');
    adminActivationDesk.data=null;
    const checked=await adminActivationLoad({force:true});
    if(checked?.intake?.controls?.find(c=>c.moduleKey===moduleKey)?.enabled!==enabled)
      throw new Error('Alteração registrada, mas leitura final não confirmada. Atualize o painel.');
    toast(enabled?'Novas propostas liberadas para cadastro.':'Novas propostas suspensas.');
    return true;
  }catch(error){
    adminActivationDesk.data=null;
    await adminActivationLoad({force:true});
    toast(String(error?.message||error));return false;
  }
}
function adminMarketingIntakeView(){
  if(!adminRoleCanSection('activations'))return '';
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
  const data=fresh?adminActivationDesk.data?.intake:null;
  const modules=[
    {key:'ads_proposals',title:'Propostas de anúncios',hint:'Recebimento de interesses e peças para análise. Não libera exibição ou cobrança.'},
    {key:'clube_proposals',title:'Interesses no Clube',hint:'Novas propostas de participação das revendas. Não vende cupons ou reserva dinheiro.'}
  ];
  const cards=modules.map(m=>{
    const item=data?.controls?.find(x=>x.moduleKey===m.key);
    const status=item?(item.enabled?'Recebendo propostas':'Novas propostas suspensas'):'Não confirmado';
    const canEdit=role==='superadmin'&&item&&!adminActivationDesk.loading;
    const button=canEdit?'<button type="button" class="secondary small" onclick="adminMarketingIntakeSet(\''+
      m.key+'\')">'+(item.enabled?'Suspender novas propostas':'Reabrir propostas')+'</button>':
      '<small class="muted">Alteração indisponível para este perfil ou esta consulta.</small>';
    return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
      esc(m.title)+'</strong><span class="status-pill">'+esc(status)+'</span></div>'+
      '<p>'+esc(m.hint)+'</p>'+
      '<small>'+(item?'Versão '+Number(item.version)+' • última justificativa: '+esc(item.reason||'—'):
        'Sem leitura recente confirmada pelo banco.')+'</small>'+button+'</article>';
  }).join('');
  return '<section class="section admin-marketing-controls" aria-label="Recebimento de propostas comerciais">'+
    '<div class="section-head"><div><span class="section-kicker">V1.308 • DECISÃO DO ADMINISTRADOR PRINCIPAL</span>'+
    '<h2>Recebimento de propostas comerciais</h2>'+
    '<p>Controle efetivo e auditado no banco. Propostas antigas podem ser consultadas e retiradas mesmo com novas inscrições suspensas.</p></div></div>'+
    '<div class="admin-activation-grid">'+cards+'</div>'+
    '<p class="tiny muted">Somente o administrador principal altera estes estados, com confirmação, motivo e versão. Nenhuma opção ativa publicidade, cobrança, benefícios ou cidades.</p></section>';
}


// TAMÃO V1.309 — internal advertising sales planning only.
// "Ready for contact" means an internal worklist, never merchant approval or publication.
function adminAdsSalesPlansView(){
  if(!adminRoleCanSection('activations'))return '';
  const actor=String(adminRuntime.session?.user?.id||''),role=adminCurrentRole();
  const fresh=adminActivationDesk.actor===actor&&adminActivationDesk.role===role&&
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')<120000;
  const data=fresh?adminActivationDesk.data?.adsSalesPlans:null;
  const money=c=>Number.isSafeInteger(c)?(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
  const stages={draft:'Em elaboração',ready_for_contact:'Pronto para contato',paused:'Pausado',closed_lost:'Encerrado sem venda'};
  const rows=(data?.rows||[]).map(p=>{
    const merchantId=String(p.merchantId||'');
    if(!/^[0-9a-f-]{36}$/i.test(merchantId))return '';
    const editable=role==='superadmin'&&p.creativeEligible===true&&
      Number.isSafeInteger(p.creativeVersion)&&p.creativeVersion>0&&
      (p.version===0||p.creativeVersion===p.planCreativeVersion);
    const id='ads-plan-'+merchantId;
    const fields=editable?'<div class="admin-ads-plan-fields">'+
      '<label>Valor planejado em R$ (não faturado)<input id="'+id+'-price" type="number" min="10" max="50000" step="1" inputmode="numeric" value="'+
        (Number.isSafeInteger(p.priceCents)?p.priceCents/100:99)+'"></label>'+
      '<label>Duração proposta em dias<input id="'+id+'-days" type="number" min="7" max="90" step="1" value="'+
        (Number.isSafeInteger(p.durationDays)?p.durationDays:7)+'"></label>'+
      '<label>Etapa comercial<select id="'+id+'-stage">'+
        Object.entries(stages).map(([key,label])=>'<option value="'+key+'" '+
          (p.stage===key?'selected':'')+'>'+label+'</option>').join('')+
      '</select></label>'+
      '<label class="admin-ads-plan-note">Observação interna<textarea id="'+id+'-note" rows="2" minlength="12" maxlength="500" placeholder="Anote o próximo passo, sem registrar contrato ou pagamento fictício">'+
        esc(p.note||'Planejar abordagem comercial com a revenda')+'</textarea></label>'+
      '<button type="button" class="primary small" onclick="adminAdsSalesPlanSave(\''+
        merchantId+'\')">Salvar planejamento</button></div>':
      '<p class="tiny muted">'+(role==='superadmin'?'Peça alterada ou retirada. Solicite nova aprovação antes de editar o plano.':
        'Somente o administrador principal pode alterar estes planos.')+'</p>';
    return '<article class="admin-activation-card"><div class="admin-activation-card-head"><strong>'+
      esc(p.companyName||'Revenda')+'</strong><span class="status-pill">'+
      esc(p.version>0?(stages[p.stage]||'Plano registrado'):'Sem plano')+'</span></div>'+
      '<p><strong>'+esc(p.title||'Peça não disponível')+'</strong></p>'+
      '<p class="tiny muted">'+esc([p.city,p.state].filter(Boolean).join('/')||'Cidade não confirmada')+
      ' • Criativo v'+esc(String(p.creativeVersion||'—'))+
      ' • Plano v'+esc(String(p.version))+'</p>'+
      (p.version>0?'<p class="tiny muted">Orçamento planejado: '+money(p.priceCents)+
        ' • '+esc(String(p.durationDays))+' dias • Nenhuma cobrança</p>':'')+
      fields+'</article>';
  }).join('');
  return '<section class="section admin-ads-commercial-plans" aria-label="Planos comerciais de publicidade">'+
    '<div class="section-head"><div><span class="section-kicker">V1.309 • PUBLICIDADE E RECEITA POTENCIAL</span>'+
    '<h2>Planejamento comercial de anúncios</h2>'+
    '<p>Crie condições e acompanhe negociações sobre peças já aprovadas. Não há aceite do anunciante, publicação ou faturamento nesta etapa.</p></div></div>'+
    (data?'<p class="tiny muted">Peças aprovadas: <strong>'+data.approvedCreatives+
      '</strong> • Planos internos: <strong>'+data.totalPlans+
      '</strong> • Receita comprovada por este módulo: R$ 0,00.</p>':
      '<p class="muted">Não foi possível confirmar os planos no servidor. Atualize a central.</p>')+
    '<div class="admin-activation-grid">'+(rows||'<p class="muted">Nenhuma peça publicitária aprovada ainda. Use a área Parceiros → Propostas publicitárias para analisar os primeiros criativos.</p>')+
    '</div></section>';
}
async function adminAdsSalesPlanSave(merchantId){
  if(!adminReady()||adminCurrentRole()!=='superadmin'||adminActivationDesk.loading)return false;
  const actor=String(adminRuntime.session?.user?.id||'');
  if(adminActivationDesk.actor!==actor||adminActivationDesk.role!=='superadmin'||
    Date.now()-Date.parse(adminActivationDesk.checkedAt||'')>=120000)return false;
  const plan=adminActivationDesk.data?.adsSalesPlans?.rows?.find(x=>x.merchantId===merchantId);
  if(!plan||!plan.creativeEligible||!Number.isSafeInteger(plan.creativeVersion)||
    (plan.version>0&&plan.creativeVersion!==plan.planCreativeVersion))return false;
  const id='ads-plan-'+merchantId;
  const priceText=String(document.getElementById(id+'-price')?.value||'');
  const daysText=String(document.getElementById(id+'-days')?.value||'');
  const priceReais=/^\d+$/.test(priceText)?Number(priceText):NaN;
  const days=/^\d+$/.test(daysText)?Number(daysText):NaN;
  const stage=String(document.getElementById(id+'-stage')?.value||'');
  const note=String(document.getElementById(id+'-note')?.value||'').trim();
  if(!Number.isSafeInteger(priceReais)||priceReais<10||priceReais>50000||
    !Number.isSafeInteger(days)||days<7||days>90||
    !['draft','ready_for_contact','paused','closed_lost'].includes(stage)||
    note.length<12||note.length>500){
    toast('Revise valor (R$ 10 a R$ 50 mil), prazo (7 a 90 dias), etapa e nota (12 a 500 caracteres).');
    return false;
  }
  if(!confirm('Registrar planejamento interno de '+priceReais.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
    ' por '+days+' dias? Isto NÃO cobra, publica, notifica ou firma contrato.'))return false;
  try{
    const result=await adminPerform('ads-sales-plan-save',{
      merchantId,creativeVersion:plan.creativeVersion,expectedVersion:plan.version,
      priceCents:priceReais*100,durationDays:days,stage,note,requestId:crypto.randomUUID()
    });
    if(result?.source!=='admin_ads_sales_plan_save_v1_309'||
      result.merchantId!==merchantId||!Number.isSafeInteger(result.version)||
      result.noCharge!==true||result.adsLive!==false||result.contractSigned!==false||
      result.paymentCreated!==false||result.merchantNotified!==false)
      throw new Error('Registro não comprovado pelo serviço.');
    adminActivationDesk.data=null;
    const confirmed=await adminActivationLoad({force:true});
    const saved=confirmed?.adsSalesPlans?.rows?.find(x=>x.merchantId===merchantId);
    if(!saved||saved.version!==result.version||saved.stage!==stage||
      saved.priceCents!==priceReais*100||saved.durationDays!==days)
      throw new Error('Plano registrado, mas leitura final não confirmada. Atualize a central.');
    toast('Plano registrado com auditoria. Nenhuma cobrança ou publicação foi realizada.');
    return true;
  }catch(e){
    adminActivationDesk.data=null;await adminActivationLoad({force:true});
    toast(String(e?.message||e));return false;
  }
}

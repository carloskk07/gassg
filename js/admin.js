const adminRuntime={
  requested:new URLSearchParams(location.search).get('admin')==='1',
  status:'disabled',
  client:null,
  session:null,
  data:null,
  actionPending:false,
  error:null,
  notice:null,
  lastSyncAt:null
};

function adminOriginSafe(){
  if(['localhost','127.0.0.1'].includes(location.hostname))return true;
  const configured=String(globalThis.CHAMA_ADMIN_ORIGIN||'').trim();
  return configured.length>0&&location.origin===configured;
}
function adminPortalRequested(){return adminRuntime.requested}
function adminReady(){return adminRuntime.requested&&adminOriginSafe()&&adminRuntime.status==='ready'}

async function adminBackendInit(){
  if(!adminRuntime.requested){
    adminRuntime.status='disabled';
    return false;
  }
  if(!adminOriginSafe()){
    adminRuntime.status='unsafe-origin';
    adminRuntime.error='O painel administrativo exige uma origem dedicada e isolada.';
    return false;
  }
  if(['ready','no-access','unauthenticated'].includes(adminRuntime.status)&&adminRuntime.client){
    return adminRuntime.status==='ready';
  }

  adminRuntime.status='loading';
  adminRuntime.error=null;
  try{
    const lib=await loadSupabaseBrowser();
    const client=lib.createClient(CHAMA_BACKEND.url,CHAMA_BACKEND.publishableKey,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        storage:sessionStorage,
        storageKey:'chama-sg-admin-auth-v1'
      },
      global:{fetch:globalThis.chamaFetch}
    });
    adminRuntime.client=client;

    const {data:{session},error}=await client.auth.getSession();
    if(error)throw error;
    adminRuntime.session=session??null;

    if(!session?.access_token){
      adminRuntime.status='unauthenticated';
      return false;
    }
    if(session.user?.is_anonymous===true){
      await client.auth.signOut().catch(()=>{});
      adminRuntime.session=null;
      adminRuntime.status='unauthenticated';
      adminRuntime.error='A administração exige uma conta permanente.';
      return false;
    }

    await adminRefresh({silent:true});
    return adminRuntime.status==='ready';
  }catch(error){
    adminRuntime.status='unavailable';
    adminRuntime.error=String(error?.message||error||'Administração indisponível');
    return false;
  }
}

async function adminAccessToken(){
  if(!adminRuntime.client)throw new Error('Cliente administrativo indisponível');
  const {data:{session},error}=await adminRuntime.client.auth.getSession();
  if(error||!session?.access_token)throw error||new Error('Sessão administrativa expirada');
  if(session.user?.is_anonymous===true)throw new Error('Conta permanente obrigatória');
  adminRuntime.session=session;
  return session.access_token;
}

function adminIdempotency(prefix='admin'){
  const uuid=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36);
  return prefix+':'+uuid;
}

async function adminInvoke(body={},options={}){
  const token=await adminAccessToken();
  const headers={
    'Content-Type':'application/json',
    'apikey':CHAMA_BACKEND.publishableKey,
    'Authorization':'Bearer '+token
  };
  if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
  const response=await globalThis.chamaFetch(CHAMA_BACKEND.url+'/functions/v1/admin-ops',{
    method:'POST',
    headers,
    body:JSON.stringify(body),
    cache:'no-store'
  });
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok){
    const err=new Error(data?.message||data?.error||('HTTP '+response.status));
    err.code=data?.error||'HTTP_'+response.status;
    err.status=response.status;
    err.data=data;
    throw err;
  }
  return data;
}

async function adminSendLogin(email){
  if(!adminRuntime.client)await adminBackendInit();
  const value=String(email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('Informe um e-mail válido');
  const redirect=new URL(location.origin+location.pathname);
  redirect.searchParams.set('admin','1');
  redirect.hash='admin';
  if(!globalThis.chamaTurnstile?.challenge)throw new Error('Proteção anti-bot indisponível');
  const captchaToken=await globalThis.chamaTurnstile.challenge('admin_login');
  const {error}=await adminRuntime.client.auth.signInWithOtp({
    email:value,
    options:{emailRedirectTo:redirect.toString(),shouldCreateUser:false,captchaToken}
  });
  if(error)throw error;
  adminRuntime.notice='Enviamos um link de acesso para '+value+'.';
  adminRuntime.status='unauthenticated';
  render();
}

async function adminSignOut(){
  if(adminRuntime.client)await adminRuntime.client.auth.signOut().catch(()=>{});
  adminRuntime.session=null;
  adminRuntime.data=null;
  adminRuntime.status='unauthenticated';
  adminRuntime.error=null;
  adminRuntime.notice=null;
  render();
}

async function adminRefresh({silent=false}={}){
  if(!adminRuntime.client)return null;
  if(!silent)render();
  try{
    const data=await adminInvoke({action:'summary'});
    adminRuntime.data=data;
    adminRuntime.status='ready';
    adminRuntime.error=null;
    adminRuntime.lastSyncAt=new Date().toISOString();
    return data;
  }catch(error){
    if(error?.code==='ADMIN_ACCESS_DENIED'||error?.status===403&&error?.code==='ADMIN_ACCESS_DENIED'){
      adminRuntime.status='no-access';
      adminRuntime.data=null;
      adminRuntime.error=null;
      return null;
    }
    if(error?.status===401){
      adminRuntime.status='unauthenticated';
      adminRuntime.session=null;
      adminRuntime.data=null;
      adminRuntime.error='Sua sessão expirou. Entre novamente.';
      return null;
    }
    adminRuntime.status='unavailable';
    adminRuntime.error=String(error?.message||error);
    throw error;
  }finally{
    if(!silent)render();
  }
}

async function adminPerform(action,payload={}){
  if(adminRuntime.actionPending)return null;
  adminRuntime.actionPending=true;
  adminRuntime.error=null;
  render();
  try{
    const result=await adminInvoke(
      {action,...payload},
      {idempotencyKey:adminIdempotency('admin-'+action)}
    );
    await adminRefresh({silent:true});
    return result;
  }catch(error){
    adminRuntime.error=String(error?.message||error);
    try{await adminRefresh({silent:true})}catch{}
    throw error;
  }finally{
    adminRuntime.actionPending=false;
    render();
  }
}

async function adminPoll(){
  if(!adminReady()||adminRuntime.actionPending||document.visibilityState==='hidden')return;
  try{
    await adminRefresh({silent:true});
    render();
  }catch{}
}

function openAdminPortal(){
  const href=globalThis.buildPortalHref?.(globalThis.CHAMA_ADMIN_ORIGIN,'admin');
  if(!href){
    toast('A administração ainda não possui uma origem dedicada configurada');
    return;
  }
  location.href=href;
}

function adminLoginFromUi(){
  const email=document.querySelector('#admin-email')?.value.trim()||'';
  adminSendLogin(email).catch(e=>toast(String(e?.message||e)));
}

function adminMoney(cents){
  return BRL.format(Math.max(0,Number(cents||0))/100);
}
function adminMerchantName(id){
  const m=(adminRuntime.data?.merchants||[]).find(x=>x.id===id);
  return m?.name||String(id||'Revenda');
}
function adminStatusPill(status){
  const good=['active','verified','paid'].includes(status);
  const bad=['rejected','suspended','reversed'].includes(status);
  return '<span class="status-pill '+(good?'online':bad?'offline':'')+'">'+esc(String(status||'—').toUpperCase())+'</span>';
}

function adminLoginView(){
  return shell(`<section class="page">
    <span class="eyebrow">CONTROL PLANE</span>
    <h1 class="page-title">Administração protegida</h1>
    <p class="muted">Acesso exclusivo para contas permanentes previamente autorizadas no banco.</p>
    ${adminRuntime.notice?`<div class="notice success" style="margin-top:14px">${esc(adminRuntime.notice)}</div>`:''}
    ${adminRuntime.error?`<div class="notice danger" style="margin-top:14px">${esc(adminRuntime.error)}</div>`:''}
    <div class="card flat form-stack" style="margin-top:16px">
      <div class="input-wrap"><label for="admin-email">E-mail administrativo</label><input id="admin-email" type="email" autocomplete="email" maxlength="160" class="input" placeholder="voce@email.com"></div>
      <button class="primary" onclick="adminLoginFromUi()">Enviar link de acesso</button>
    </div>
    <div class="notice" style="margin-top:14px">O login não cria permissão administrativa. A conta precisa existir e estar na allowlist server-side.</div>
  </section>`);
}

function adminNoAccessView(){
  const email=adminRuntime.session?.user?.email||'conta autenticada';
  return shell(`<section class="page">
    <span class="eyebrow">ACESSO NEGADO</span>
    <h1 class="page-title">Conta não autorizada</h1>
    <p class="muted">${esc(email)} está autenticada, mas não pertence à allowlist de administradores.</p>
    <div class="notice danger" style="margin-top:14px">Não existe autoelevação de privilégio. O primeiro admin precisa ser incluído diretamente no banco por uma autoridade já autenticada no projeto.</div>
    <button class="ghost full" style="margin-top:12px" onclick="adminSignOut()">Sair desta conta</button>
  </section>`);
}

function adminApplicationCard(a){
  const pending=a.status==='pending';
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(a.company_name)}</div><div class="tiny muted">${esc(a.cnpj)}</div></div>${adminStatusPill(a.status)}</div>
    <div class="order-line"><strong>Responsável:</strong> ${esc(a.responsible_name)}</div>
    <div class="order-line"><strong>WhatsApp:</strong> ${esc(a.phone)}</div>
    <div class="order-line"><strong>Endereço:</strong> ${esc(a.address_text)}</div>
    <div class="tiny muted">Recebido em ${new Date(a.created_at).toLocaleString('pt-BR')}</div>
    ${pending?`<div class="order-actions"><button class="primary small" onclick="adminApproveApplication('${a.id}')">Aprovar cadastro</button><button class="danger-btn small" onclick="adminRejectApplication('${a.id}')">Rejeitar</button></div>`:''}
  </article>`;
}


function adminPilotPartnerCard(p){
  const statusLabel={
    awaiting_legal_data:'AGUARDANDO DADOS REAIS',
    ready_for_review:'PRONTO PARA REVISÃO',
    converted:'CONVERTIDO',
    cancelled:'CANCELADO'
  }[p.onboarding_status]||String(p.onboarding_status||'—').toUpperCase();
  const statusClass=p.onboarding_status==='converted'?'online':p.onboarding_status==='cancelled'?'offline':'risk';
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(p.display_name)}</div><div class="tiny muted">Parceiro piloto • ${esc(p.proposed_product_code)}</div></div><span class="status-pill ${statusClass}">${esc(statusLabel)}</span></div>
    <div class="order-line"><strong>Preço comercial informado:</strong> ${adminMoney(p.proposed_delivered_price_cents)} ${p.delivery_included?'com entrega incluída':'antes da entrega'}</div>
    <div class="order-line"><strong>Status do preço:</strong> ${p.price_status==='confirmed'?'confirmado':'proposto — ainda não publicar como oferta real'}</div>
    ${p.notes?`<div class="tiny muted">${esc(p.notes)}</div>`:''}
    <div class="notice" style="margin-top:10px"><strong>Gate de ativação preservado.</strong><br>CNPJ, responsável, endereço, conta owner e validação regulatória aplicável ainda precisam ser cadastrados antes de criar uma revenda ativa.</div>
  </article>`;
}

function adminMerchantCard(m){
  const c=m.compliance||{};
  const active=m.status==='active';
  const cnpjId='cnpj-'+m.id;
  const anpId='anp-'+m.id;
  const refId='anpref-'+m.id;
  const notesId='notes-'+m.id;
  const mixed=(m.deliveryCapabilities||[]).find(x=>x.capability_code==='regulated_glp_mixed_load_verified');
  const mixedId='mixed-'+m.id;
  const mixedNotesId='mixednotes-'+m.id;
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(m.name)}</div><div class="tiny muted">${esc(m.cnpj)}</div></div>${adminStatusPill(m.status)}</div>
    <div class="order-line">Online: <strong>${m.online?'sim':'não'}</strong> • Trust: ${Number(m.trust_score||0)}/100</div>
    <div class="field-row" style="margin-top:12px">
      <div class="input-wrap"><label for="${cnpjId}">CNPJ</label><select id="${cnpjId}" class="input"><option value="pending" ${c.cnpj_status==='pending'?'selected':''}>Pendente</option><option value="verified" ${c.cnpj_status==='verified'?'selected':''}>Verificado</option><option value="rejected" ${c.cnpj_status==='rejected'?'selected':''}>Rejeitado</option></select><small>Última verificação: ${c.cnpj_verified_at?esc(formatDateTime(c.cnpj_verified_at)):'nunca'}</small></div>
      <div class="input-wrap"><label for="${anpId}">ANP</label><select id="${anpId}" class="input"><option value="pending" ${c.anp_status==='pending'?'selected':''}>Pendente</option><option value="verified" ${c.anp_status==='verified'?'selected':''}>Verificada</option><option value="not_required" ${c.anp_status==='not_required'?'selected':''}>Não se aplica</option><option value="rejected" ${c.anp_status==='rejected'?'selected':''}>Rejeitada</option></select><small>Última verificação: ${c.anp_verified_at?esc(formatDateTime(c.anp_verified_at)):c.anp_status==='not_required'?'não se aplica':'nunca'}</small></div>
    </div>
    <div class="input-wrap"><label for="${refId}">Referência ANP</label><input id="${refId}" class="input" maxlength="240" value="${esc(c.anp_reference||'')}" placeholder="Número/consulta/evidência"></div>
    <div class="input-wrap"><label for="${notesId}">Observações</label><input id="${notesId}" class="input" maxlength="1000" value="${esc(c.notes||'')}" placeholder="Observações de validação"></div>
    <div class="divider"></div>
    <label class="check-row"><input id="${mixedId}" type="checkbox" ${mixed?.active?'checked':''}><span><strong>Capacidade logística verificada para cesta mista com GLP</strong><small>Ative somente após validação operacional específica. CNPJ e ANP precisam estar verificados.</small></span></label>
    <div class="input-wrap"><label for="${mixedNotesId}">Evidência / observação logística</label><input id="${mixedNotesId}" class="input" maxlength="1000" value="${esc(mixed?.notes||'')}" placeholder="Veículo, procedimento, evidência ou referência da validação"></div>
    <div class="order-actions"><button class="secondary small" onclick="adminSaveCompliance('${m.id}')">Salvar validação</button><button class="secondary small" onclick="adminSaveDeliveryCapability('${m.id}')">Salvar capacidade logística</button>${active?`<button class="danger-btn small" onclick="adminSetMerchantStatus('${m.id}','suspend-merchant')">Suspender</button>`:`<button class="primary small" onclick="adminSetMerchantStatus('${m.id}','activate-merchant')">Ativar</button>`}</div>
  </article>`;
}

function adminReferralReasonLabel(code){
  const map={
    same_delivery_address_as_referrer:'Mesmo endereço de entrega do indicador',
    high_referral_velocity_24h:'Volume alto de indicações em 24h',
    multiple_referred_accounts_same_address:'Múltiplas contas indicadas no mesmo endereço'
  };
  return map[String(code||'')]||String(code||'Sinal de risco');
}
function adminReferralReviewCard(x){
  const financiallyReversed=x.financialState==='reversed'||!!x.financialReversedAt;
  const pending=x.risk_status==='review_required'&&!financiallyReversed;
  const reasons=Array.isArray(x.risk_reasons)?x.risk_reasons:[];
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">Pedido ${esc(x.order_id)}</div><div class="tiny muted">Indicador ${esc(x.referrer_user_id)} • comprador ${esc(x.referred_user_id)}</div></div>${adminStatusPill(x.risk_status)}</div>
    <div class="order-line"><strong>Sinais:</strong> ${reasons.length?reasons.map(r=>esc(adminReferralReasonLabel(r))).join(' • '):'Nenhum sinal automático'}</div>
    <div class="tiny muted">Criado em ${new Date(x.created_at).toLocaleString('pt-BR')}</div>
    ${x.review_notes?`<div class="order-line"><strong>Revisão:</strong> ${esc(x.review_notes)}</div>`:''}
    ${financiallyReversed?'<div class="notice danger" style="margin-top:10px"><strong>Pedido financeiramente revertido.</strong><br>A comissão já foi estornada; nenhuma nova ação financeira deve ser aplicada.</div>':''}
    ${pending?`<div class="order-actions"><button class="primary small" onclick="adminReviewReferral('${x.order_id}','approved')">Aprovar comissão</button><button class="danger-btn small" onclick="adminReviewReferral('${x.order_id}','rejected')">Rejeitar comissão</button></div>`:''}
  </article>`;
}
function adminReceivableRow(x){
  return `<div class="list-row"><div><strong>${esc(adminMerchantName(x.merchant_id))}</strong><br><small>Taxa da plataforma • pedido ${esc(x.order_id)}</small></div><div style="text-align:right"><strong>${adminMoney(x.platform_fee_cents)}</strong><div class="order-actions"><button class="secondary small" onclick="adminFinancial('platform_receivable','${x.order_id}','paid')">Pago</button><button class="ghost small" onclick="adminFinancial('platform_receivable','${x.order_id}','waived')">Abonar</button></div></div></div>`;
}
function adminReimbursementRow(x){
  return `<div class="list-row"><div><strong>${esc(adminMerchantName(x.merchant_id))}</strong><br><small>Reembolso de cashback • pedido ${esc(x.order_id)}</small></div><div style="text-align:right"><strong>${adminMoney(x.cashback_cents)}</strong><div class="order-actions"><button class="secondary small" onclick="adminFinancial('cashback_reimbursement','${x.order_id}','paid')">Pago</button></div></div></div>`;
}
function adminAdjustmentRow(x){
  const direction=x.direction==='merchant_owes_platform'?'Revenda → plataforma':'Plataforma → revenda';
  return `<div class="list-row"><div><strong>${esc(adminMerchantName(x.merchant_id))}</strong><br><small>${esc(direction)} • ${esc(x.adjustment_type)} • pedido ${esc(x.order_id)}</small></div><div style="text-align:right"><strong>${adminMoney(x.amount_cents)}</strong><div class="order-actions"><button class="secondary small" onclick="adminFinancial('settlement_adjustment','${x.id}','paid')">Liquidado</button><button class="ghost small" onclick="adminFinancial('settlement_adjustment','${x.id}','waived')">Abonar</button></div></div></div>`;
}

function adminRewardFailureCard(x){
  const dead=!!x.dead_lettered_at;
  const next=x.next_retry_at?new Date(x.next_retry_at).toLocaleString('pt-BR'):'—';
  const last=x.last_attempt_at?new Date(x.last_attempt_at).toLocaleString('pt-BR'):new Date(x.updated_at||x.created_at).toLocaleString('pt-BR');
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">Pedido ${esc(x.order_id)}</div><div class="tiny muted">Tentativas: ${Number(x.attempts||0)} • última: ${esc(last)}</div></div><span class="status-pill ${dead?'offline':''}">${dead?'DEAD LETTER':'RETRY'}</span></div>
    <div class="order-line"><strong>Último erro:</strong> ${esc(x.last_error||'Falha de processamento')}</div>
    ${x.last_sqlstate?`<div class="tiny muted">SQLSTATE: ${esc(x.last_sqlstate)}</div>`:''}
    <div class="tiny muted">${dead?'Retry automático interrompido para evitar loop infinito.':'Próxima tentativa automática: '+esc(next)}</div>
    <div class="order-actions"><button class="${dead?'primary':'secondary'} small" onclick="adminRetryReward('${x.order_id}')">Reprocessar agora</button></div>
  </article>`;
}

function adminAccountingFailureCard(x){
  const dead=!!x.dead_lettered_at;
  const next=x.next_retry_at?new Date(x.next_retry_at).toLocaleString('pt-BR'):'—';
  const last=x.last_attempt_at?new Date(x.last_attempt_at).toLocaleString('pt-BR'):new Date(x.updated_at||x.created_at).toLocaleString('pt-BR');
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">Pedido ${esc(x.order_id)}</div><div class="tiny muted">Tentativas: ${Number(x.attempts||0)} • última: ${esc(last)}</div></div><span class="status-pill ${dead?'offline':''}">${dead?'DEAD LETTER':'RETRY'}</span></div>
    <div class="order-line"><strong>Falha contábil:</strong> ${esc(x.last_error||'Falha ao registrar settlement')}</div>
    ${x.last_sqlstate?`<div class="tiny muted">SQLSTATE: ${esc(x.last_sqlstate)}</div>`:''}
    <div class="tiny muted">${dead?'Retry automático interrompido; exige revisão administrativa.':'Próxima tentativa automática: '+esc(next)}</div>
    <div class="order-actions"><button class="${dead?'primary':'secondary'} small" onclick="adminRetryAccounting('${x.order_id}')">Reprocessar contabilidade</button></div>
  </article>`;
}

function adminPage(){
  if(!adminPortalRequested()){
    return shell('<section class="page"><div class="notice danger">Administração só está disponível no portal protegido.</div></section>');
  }
  if(['disabled','loading'].includes(adminRuntime.status)){
    return shell('<section class="page"><h1 class="page-title">Administração</h1><div class="empty card">Conectando ao control plane…</div></section>');
  }
  if(adminRuntime.status==='unsafe-origin'){
    return shell('<section class="page"><span class="eyebrow">CONTROL PLANE BLOQUEADO</span><h1 class="page-title">Origem administrativa não isolada</h1><div class="notice danger">Por segurança, o painel admin não autentica em uma origem compartilhada como GitHub Pages. Use localhost para desenvolvimento ou configure uma origem dedicada para administração.</div></section>');
  }
  if(adminRuntime.status==='unauthenticated')return adminLoginView();
  if(adminRuntime.status==='no-access')return adminNoAccessView();
  if(adminRuntime.status!=='ready'||!adminRuntime.data){
    return shell(`<section class="page"><h1 class="page-title">Administração</h1><div class="notice danger"><strong>Não foi possível carregar o painel.</strong><br>${esc(adminRuntime.error||'Tente novamente.')}</div><button class="secondary full" style="margin-top:12px" onclick="adminRefresh()">Tentar novamente</button></section>`);
  }

  const d=adminRuntime.data;
  const pending=(d.applications||[]).filter(x=>x.status==='pending');
  const pilotPartners=d.pilotPartners||[];
  const active=(d.merchants||[]).filter(x=>x.status==='active');
  const referralReviews=d.referralReviews||[];
  const pendingReferralReviews=referralReviews.filter(x=>x.risk_status==='review_required'&&x.financialState!=='reversed'&&!x.financialReversedAt);
  const rewardFailures=d.rewardFailures||[];
  const deadRewardFailures=rewardFailures.filter(x=>!!x.dead_lettered_at);
  const accountingFailures=d.accountingFailures||[];
  const deadAccountingFailures=accountingFailures.filter(x=>!!x.dead_lettered_at);
  const receivables=d.finance?.receivables||[];
  const reimbursements=d.finance?.cashbackReimbursements||[];
  const adjustments=d.finance?.adjustments||[];
  const platformAdmins=d.platformAdmins||[];
  const openFees=receivables.reduce((s,x)=>s+Number(x.platform_fee_cents||0),0);
  const openCashback=reimbursements.reduce((s,x)=>s+Number(x.cashback_cents||0),0);
  const openAdjustments=adjustments.reduce((s,x)=>s+Number(x.amount_cents||0),0);

  return shell(`<section class="page">
    <div class="status-bar"><div><div class="tiny muted">CONTROL PLANE REAL</div><h1 class="page-title" style="margin-bottom:2px">Administração Chama</h1></div><div class="order-actions"><button class="secondary small" onclick="adminRefresh()">Atualizar</button><button class="ghost small" onclick="adminSignOut()">Sair</button></div></div>
    ${adminRuntime.error?`<div class="notice danger" style="margin-top:12px">${esc(adminRuntime.error)}</div>`:''}

    <section class="section"><div class="merchant-kpis">
      <div class="kpi"><span class="label">Cadastros pendentes</span><strong>${pending.length}</strong></div>
      <div class="kpi"><span class="label">Parceiros piloto</span><strong>${pilotPartners.filter(x=>x.onboarding_status!=='cancelled').length}</strong></div>
      <div class="kpi"><span class="label">Revendas ativas</span><strong>${active.length}</strong></div>
      <div class="kpi"><span class="label">Taxas a receber</span><strong>${adminMoney(openFees)}</strong></div>
      <div class="kpi"><span class="label">Cashback a reembolsar</span><strong>${adminMoney(openCashback)}</strong></div>
    </div></section>

    <section class="section"><div class="section-head"><div><h2>Administradores da plataforma</h2><p>O primeiro admin é criado somente por bootstrap server-side. Depois disso, esta tela mantém redundância operacional sem permitir remover o último admin ativo.</p></div><span class="status-pill online">${platformAdmins.filter(x=>x.active).length} ativo(s)</span></div>
      <div class="card flat form-stack">
        <div class="list">${platformAdmins.length?platformAdmins.map(x=>`<div class="list-row"><div><strong>${esc(x.user_id)}</strong><br><small>${x.active?'Administrador ativo':'Acesso administrativo suspenso'}</small></div><div class="order-actions"><span class="status-pill ${x.active?'online':'offline'}">${x.active?'ATIVO':'INATIVO'}</span><button class="${x.active?'danger-btn':'secondary'} small" onclick="adminSetPlatformAdmin('${x.user_id}',${x.active?'false':'true'})">${x.active?'Desativar':'Ativar'}</button></div></div>`).join(''):'<div class="tiny muted">Nenhum administrador bootstrapado ainda.</div>'}</div>
        <div class="divider"></div>
        <div class="input-wrap"><label for="admin-new-user-id">UUID de uma conta permanente</label><input id="admin-new-user-id" class="input" maxlength="36" placeholder="00000000-0000-0000-0000-000000000000"></div>
        <button class="secondary" onclick="adminAddPlatformAdmin()">Adicionar administrador</button>
      </div>
    </section>

    <section class="section"><div class="section-head"><div><h2>Parceiros piloto em preparação</h2><p>Interesse comercial registrado antes do cadastro jurídico. Esses registros não participam das ofertas e não contam como revenda ativa.</p></div></div>${pilotPartners.length?pilotPartners.map(adminPilotPartnerCard).join(''):'<div class="empty card">Nenhum parceiro piloto em preparação.</div>'}</section>

    <section class="section"><div class="section-head"><div><h2>Cadastros de parceiros</h2><p>Aprovação cria a revenda como pendente e vincula o solicitante como owner. Não coloca a operação online.</p></div></div>${(d.applications||[]).length?(d.applications||[]).map(adminApplicationCard).join(''):'<div class="empty card">Nenhum cadastro recebido.</div>'}</section>

    <section class="section"><div class="section-head"><div><h2>Validação e ativação</h2><p>CNPJ é obrigatório para toda revenda ativa. Qualquer produto GLP ativo exige também validação ANP.</p></div></div>${(d.merchants||[]).length?(d.merchants||[]).map(adminMerchantCard).join(''):'<div class="empty card">Nenhuma revenda criada.</div>'}</section>

    <section class="section"><div class="section-head"><div><h2>Revisão de indicações</h2><p>Comissões suspeitas não amadurecem automaticamente. Aprovação ainda exige identidades permanentes e fim da quarentena.</p></div><span class="status-pill ${pendingReferralReviews.length?'offline':'online'}">${pendingReferralReviews.length} pendente(s)</span></div>${referralReviews.length?referralReviews.map(adminReferralReviewCard).join(''):'<div class="empty card">Nenhuma indicação exige revisão.</div>'}</section>

    <section class="section"><div class="section-head"><div><h2>Fila de benefícios</h2><p>Falhas transitórias usam backoff. Dead-letter exige revisão manual; a entrega do pedido permanece concluída.</p></div><span class="status-pill ${deadRewardFailures.length?'offline':'online'}">${deadRewardFailures.length} dead-letter</span></div>${rewardFailures.length?rewardFailures.map(adminRewardFailureCard).join(''):'<div class="empty card">Nenhuma dívida de processamento de benefícios.</div>'}</section>

    <section class="section"><div class="section-head"><div><h2>Fila contábil de settlement</h2><p>Taxa da plataforma e reembolso de cashback são processados independentemente dos benefícios.</p></div><span class="status-pill ${deadAccountingFailures.length?'offline':'online'}">${deadAccountingFailures.length} dead-letter</span></div>${accountingFailures.length?accountingFailures.map(adminAccountingFailureCard).join(''):'<div class="empty card">Nenhuma dívida contábil de settlement.</div>'}</section>

    <section class="section"><div class="section-head"><div><h2>Conciliação financeira</h2><p>Taxa da plataforma, cashback usado e ajustes são contas separadas.</p></div></div>
      <div class="card flat"><h3>Taxas da plataforma</h3><div class="list">${receivables.length?receivables.map(adminReceivableRow).join(''):'<div class="tiny muted">Nenhuma taxa em aberto.</div>'}</div></div>
      <div class="card flat" style="margin-top:12px"><h3>Cashback a reembolsar</h3><div class="list">${reimbursements.length?reimbursements.map(adminReimbursementRow).join(''):'<div class="tiny muted">Nenhum reembolso em aberto.</div>'}</div></div>
      <div class="card flat" style="margin-top:12px"><h3>Ajustes de reversão • ${adminMoney(openAdjustments)}</h3><div class="list">${adjustments.length?adjustments.map(adminAdjustmentRow).join(''):'<div class="tiny muted">Nenhum ajuste em aberto.</div>'}</div></div>
    </section>

    <section class="section"><div class="card flat form-stack"><h3>Reversão financeira auditada</h3><p class="muted tiny">Somente para um pedido já liquidado que teve estorno/refund confirmado. O histórico operacional de entrega permanece.</p><div class="input-wrap"><label for="admin-reverse-order">ID do pedido</label><input id="admin-reverse-order" class="input" placeholder="UUID do pedido"></div><div class="input-wrap"><label for="admin-reverse-reason">Motivo</label><input id="admin-reverse-reason" class="input" maxlength="240" placeholder="Motivo confirmado"></div><div class="input-wrap"><label for="admin-reverse-ref">Referência</label><input id="admin-reverse-ref" class="input" maxlength="120" placeholder="ID do estorno/comprovante"></div><button class="danger-btn" onclick="adminReverseOrder()">Executar reversão</button></div></section>

    <section class="section"><div class="section-head"><div><h2>Auditoria recente</h2></div></div><div class="list">${(d.recentAudit||[]).length?(d.recentAudit||[]).map(x=>`<div class="list-row"><div><strong>${esc(x.action)}</strong><br><small>${esc(x.target_type)} • ${esc(x.target_id||'—')}</small></div><small>${new Date(x.created_at).toLocaleString('pt-BR')}</small></div>`).join(''):'<div class="empty card">Nenhuma ação administrativa registrada.</div>'}</div></section>
  </section>`);
}

async function adminApproveApplication(id){
  try{await adminPerform('approve-application',{applicationId:id});toast('Cadastro aprovado para validação')}catch(e){toast(String(e?.message||e))}
}
async function adminRejectApplication(id){
  const reason=prompt('Motivo da rejeição:');
  if(!reason)return;
  try{await adminPerform('reject-application',{applicationId:id,reason});toast('Cadastro rejeitado')}catch(e){toast(String(e?.message||e))}
}
async function adminSaveCompliance(id){
  const cnpjStatus=document.getElementById('cnpj-'+id)?.value||'pending';
  const anpStatus=document.getElementById('anp-'+id)?.value||'pending';
  const anpReference=document.getElementById('anpref-'+id)?.value.trim()||'';
  const notes=document.getElementById('notes-'+id)?.value.trim()||'';
  try{
    await adminPerform('verify-merchant',{merchantId:id,cnpjStatus,anpStatus,anpReference,notes});
    toast('Validação salva');
  }catch(e){toast(String(e?.message||e))}
}
async function adminSaveDeliveryCapability(id){
  const active=document.getElementById('mixed-'+id)?.checked===true;
  const notes=document.getElementById('mixednotes-'+id)?.value.trim()||'';
  if(active&&!confirm('Confirma que esta revenda foi validada operacionalmente para cesta mista com GLP?'))return;
  try{
    await adminPerform('set-delivery-capability',{merchantId:id,active,notes});
    toast(active?'Capacidade logística verificada':'Capacidade logística revogada');
  }catch(e){toast(String(e?.message||e))}
}
async function adminSetMerchantStatus(id,action){
  const label=action==='activate-merchant'?'ativar':'suspender';
  if(!confirm('Confirma '+label+' esta revenda?'))return;
  try{await adminPerform(action,{merchantId:id});toast('Status atualizado')}catch(e){toast(String(e?.message||e))}
}
async function adminReviewReferral(orderId,decision){
  const notes=prompt(decision==='approved'?'Observação da aprovação (opcional):':'Motivo da rejeição / evidência:')||'';
  if(decision==='rejected'&&!notes.trim())return toast('Informe o motivo da rejeição');
  if(!confirm(decision==='approved'?'Aprovar esta comissão após a revisão de risco?':'Rejeitar esta comissão? O pedido e cashback do comprador continuarão válidos.'))return;
  try{
    await adminPerform('review-referral',{orderId,decision,notes});
    toast(decision==='approved'?'Comissão aprovada para continuar na validação':'Comissão rejeitada e saldo pendente ajustado');
  }catch(e){toast(String(e?.message||e))}
}
async function adminRetryReward(orderId){
  if(!confirm('Reprocessar os benefícios deste pedido agora? A entrega não será alterada.'))return;
  try{
    const result=await adminPerform('retry-reward',{orderId});
    if(result?.ok){
      toast(result?.alreadyResolved?'A dívida já estava resolvida':'Benefícios reprocessados com sucesso');
    }else{
      toast('O reprocessamento falhou e permaneceu registrado para revisão');
    }
  }catch(e){toast(String(e?.message||e))}
}

async function adminRetryAccounting(orderId){
  if(!confirm('Reprocessar a contabilidade deste pedido agora? A entrega e os benefícios não serão alterados.'))return;
  try{
    const result=await adminPerform('retry-accounting',{orderId});
    if(result?.ok){
      toast(result?.alreadyResolved?'A dívida contábil já estava resolvida':'Contabilidade reprocessada com sucesso');
    }else{
      toast('A contabilidade continuou em falha e permaneceu registrada');
    }
  }catch(e){toast(String(e?.message||e))}
}

async function adminSetPlatformAdmin(targetUserId,active){
  if(active!==true&&!confirm('Desativar este administrador? O último admin ativo nunca pode ser removido.'))return;
  try{
    await adminPerform('set-platform-admin',{targetUserId,active:active===true});
    toast(active?'Administrador ativado':'Administrador desativado');
  }catch(e){toast(String(e?.message||e))}
}
async function adminAddPlatformAdmin(){
  const targetUserId=document.querySelector('#admin-new-user-id')?.value.trim()||'';
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)){
    return toast('Informe um UUID válido de conta permanente');
  }
  await adminSetPlatformAdmin(targetUserId,true);
}

async function adminFinancial(kind,targetId,financialAction){
  const reference=prompt('Referência da conciliação (opcional):')||'';
  try{
    await adminPerform('financial-action',{kind,targetId,financialAction,reference});
    toast('Conciliação registrada');
  }catch(e){toast(String(e?.message||e))}
}
async function adminReverseOrder(){
  const orderId=document.querySelector('#admin-reverse-order')?.value.trim()||'';
  const reason=document.querySelector('#admin-reverse-reason')?.value.trim()||'';
  const reference=document.querySelector('#admin-reverse-ref')?.value.trim()||'';
  if(!orderId||reason.length<3)return toast('Informe pedido e motivo');
  if(!confirm('Esta ação estornará benefícios e recebíveis do pedido. Confirmar?'))return;
  try{
    await adminPerform('reverse-order',{orderId,reason,reference});
    toast('Reversão financeira registrada');
  }catch(e){toast(String(e?.message||e))}
}

globalThis.adminRuntime=adminRuntime;
globalThis.adminPortalRequested=adminPortalRequested;
globalThis.adminReady=adminReady;
globalThis.adminBackendInit=adminBackendInit;
globalThis.adminSendLogin=adminSendLogin;
globalThis.adminSignOut=adminSignOut;
globalThis.adminRefresh=adminRefresh;
globalThis.adminPoll=adminPoll;
globalThis.adminPage=adminPage;
globalThis.adminRetryReward=adminRetryReward;
globalThis.adminRetryAccounting=adminRetryAccounting;
globalThis.adminSetPlatformAdmin=adminSetPlatformAdmin;
globalThis.adminAddPlatformAdmin=adminAddPlatformAdmin;
globalThis.openAdminPortal=openAdminPortal;

const adminRuntime={
  requested:String(globalThis.CHAMA_PORTAL_ROLE||'').trim().toLowerCase()
    ? String(globalThis.CHAMA_PORTAL_ROLE||'').trim().toLowerCase()==='admin'
    : new URLSearchParams(location.search).get('admin')==='1',
  status:'disabled',
  client:null,
  session:null,
  data:null,
  actionPending:false,
  error:null,
  notice:null,
  bootstrapStatus:null,
  bootstrapError:null,
  lastSyncAt:null,
  refreshSeq:0,
  pollPending:false,
  lastPollAt:0
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

    let bootstrapFailure=null;
    try{
      await adminClaimBootstrap();
    }catch(error){
      bootstrapFailure=error;
      adminRuntime.bootstrapError=String(error?.message||error||'Falha ao validar o primeiro acesso.');
    }
    await adminRefresh({silent:true});
    if(adminRuntime.status==='ready'){
      adminRuntime.bootstrapError=null;
      return true;
    }
    if(adminRuntime.status==='no-access'&&bootstrapFailure){
      adminRuntime.status='bootstrap-error';
      adminRuntime.error='Não foi possível confirmar a autorização administrativa. Tente validar o acesso novamente.';
    }
    return false;
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

async function adminAuthInvoke(body={},options={}){
  const headers={
    'Content-Type':'application/json',
    'apikey':CHAMA_BACKEND.publishableKey
  };
  if(options.withSession===true){
    headers.Authorization='Bearer '+await adminAccessToken();
  }
  const response=await globalThis.chamaFetch(CHAMA_BACKEND.url+'/functions/v1/admin-auth',{
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

async function adminClaimBootstrap(){
  if(!adminRuntime.session?.access_token)return null;
  const result=await adminAuthInvoke({action:'claim'},{withSession:true});
  adminRuntime.bootstrapStatus=String(result?.status||'unknown');
  adminRuntime.bootstrapError=null;
  if(adminRuntime.bootstrapStatus==='claimed'){
    adminRuntime.notice='Primeiro acesso confirmado. A administração foi ativada com segurança.';
  }
  return result;
}

function adminBootstrapAccessMessage(){
  if(adminRuntime.bootstrapStatus==='not_reserved'){
    return 'Esta conta permanente foi autenticada, mas não corresponde à reserva administrativa inicial.';
  }
  if(adminRuntime.bootstrapStatus==='bootstrap_closed'){
    return 'O bootstrap inicial já foi encerrado porque existe outro administrador ativo. Esta conta só pode ser adicionada por um administrador existente.';
  }
  if(adminRuntime.bootstrapStatus==='unknown'){
    return 'A identidade foi autenticada, mas o servidor não confirmou uma condição válida de bootstrap.';
  }
  return 'Esta conta está autenticada, mas não possui autorização administrativa ativa.';
}

async function adminRetryBootstrapFromUi(){
  if(adminRuntime.actionPending)return;
  adminRuntime.actionPending=true;
  adminRuntime.status='loading';
  adminRuntime.error=null;
  adminRuntime.bootstrapError=null;
  render();
  try{
    await adminClaimBootstrap();
    await adminRefresh({silent:true});
    if(adminRuntime.status==='no-access'&&adminRuntime.bootstrapStatus==='claimed'){
      adminRuntime.status='bootstrap-error';
      adminRuntime.error='O primeiro acesso foi reivindicado, mas o control plane ainda não confirmou a permissão. Tente novamente.';
    }
  }catch(error){
    adminRuntime.status='bootstrap-error';
    adminRuntime.bootstrapError=String(error?.message||error||'Falha ao validar o acesso.');
    adminRuntime.error='A validação administrativa falhou antes de qualquer elevação de privilégio.';
  }finally{
    adminRuntime.actionPending=false;
    render();
  }
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
  const result=await adminAuthInvoke({
    action:'request-link',
    email:value,
    captchaToken,
    redirectTo:redirect.toString()
  });
  adminRuntime.notice=String(result?.message||'Se este e-mail estiver autorizado, o link de acesso será enviado.');
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
  adminRuntime.bootstrapStatus=null;
  adminRuntime.bootstrapError=null;
  render();
}

async function adminRefresh({silent=false}={}){
  if(!adminRuntime.client)return null;
  const seq=++adminRuntime.refreshSeq;
  if(!silent)render();
  try{
    const data=await adminInvoke({action:'summary'});
    if(seq!==adminRuntime.refreshSeq)return data;
    adminRuntime.data=data;
    adminRuntime.status='ready';
    adminRuntime.error=null;
    adminRuntime.lastSyncAt=new Date().toISOString();
    return data;
  }catch(error){
    if(seq!==adminRuntime.refreshSeq)return null;
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
    const idempotencyKey=adminIdempotency('admin-'+action);
    const result=await globalThis.retryAmbiguousOnce(
      ()=>adminInvoke(
        {action,...payload},
        {idempotencyKey}
      )
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
  if(!adminReady()||adminRuntime.actionPending||adminRuntime.pollPending||document.visibilityState==='hidden')return;
  const now=Date.now();
  if(adminRuntime.lastPollAt&&now-adminRuntime.lastPollAt<15000)return;
  adminRuntime.lastPollAt=now;
  adminRuntime.pollPending=true;
  try{
    await adminRefresh({silent:true});
    render();
  }catch{
    render();
  }
  finally{adminRuntime.pollPending=false}
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
    <div class="notice" style="margin-top:14px">O portal nunca concede permissão pelo navegador. Um admin existente recebe o link normalmente; no primeiro acesso, somente o e-mail previamente reservado no servidor pode criar e reclamar a conta inicial.</div>
  </section>`);
}

function adminNoAccessView(){
  const email=adminRuntime.session?.user?.email||'conta autenticada';
  return shell(`<section class="page">
    <span class="eyebrow">ACESSO NEGADO</span>
    <h1 class="page-title">Conta não autorizada</h1>
    <p class="muted">${esc(email)} está autenticada, mas o servidor não concedeu acesso ao control plane.</p>
    <div class="notice danger" style="margin-top:14px">${esc(adminBootstrapAccessMessage())}</div>
    <div class="notice" style="margin-top:10px">Não existe autoelevação de privilégio. O primeiro admin só pode nascer da reserva criptográfica server-side; depois disso, novos administradores dependem de um admin já ativo.</div>
    <button class="secondary full" style="margin-top:12px" onclick="adminRetryBootstrapFromUi()">Validar acesso novamente</button>
    <button class="ghost full" style="margin-top:8px" onclick="adminSignOut()">Sair desta conta</button>
  </section>`);
}

function adminBootstrapErrorView(){
  return shell(`<section class="page">
    <span class="eyebrow">VALIDAÇÃO ADMINISTRATIVA</span>
    <h1 class="page-title">Não foi possível concluir a validação</h1>
    <p class="muted">Sua sessão foi autenticada, mas a autoridade de bootstrap não respondeu de forma conclusiva.</p>
    <div class="notice danger" style="margin-top:14px">${esc(adminRuntime.bootstrapError||adminRuntime.error||'Falha temporária na validação administrativa.')}</div>
    <div class="notice" style="margin-top:10px">Nenhuma permissão foi concedida por fallback. O acesso permanece fechado até o servidor confirmar a autorização.</div>
    <button class="primary full" style="margin-top:12px" onclick="adminRetryBootstrapFromUi()">Tentar validação novamente</button>
    <button class="ghost full" style="margin-top:8px" onclick="adminSignOut()">Sair desta conta</button>
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


function adminProductName(code){
  const value=String(code||'').toUpperCase();
  if(/^P([1-9]|[1-8][0-9]|90)$/.test(value))return 'Gás GLP '+value;
  return ({WATER20:'Água 20 L',CHARCOAL4:'Carvão 4 kg',WOOD:'Lenha',ICE5:'Gelo 5 kg'})[value]||value;
}
function adminPilotInviteControls(p,id){
  const convertible=!['converted','cancelled'].includes(String(p?.onboarding_status||''));
  if(!convertible)return '';
  const invite=p?.activeInvite||null;
  const expiresAt=invite?.expiresAt?Date.parse(invite.expiresAt):NaN;
  const active=Boolean(invite&&Number.isFinite(expiresAt)&&expiresAt>Date.now());
  const label=active?'ativo até '+new Date(invite.expiresAt).toLocaleString('pt-BR'):invite?'expirado':'nenhum convite ativo';
  return '<div class="order-line"><strong>Convite do parceiro:</strong> '+esc(label)+'</div>'+
    '<div class="order-actions"><button class="secondary small" onclick="adminIssuePilotInvite(\''+esc(id)+'\')">'+(active?'Rotacionar convite':'Gerar convite')+'</button>'+
    (active?'<button class="danger-btn small" onclick="adminRevokePilotInvite(\''+esc(id)+'\')">Revogar convite</button>':'')+'</div>';
}

function adminPilotPartnerCard(p){
  const statusLabel={
    awaiting_legal_data:'AGUARDANDO DADOS REAIS',
    ready_for_review:'PRONTO PARA REVISÃO',
    converted:'CONVERTIDO',
    cancelled:'CANCELADO'
  }[p.onboarding_status]||String(p.onboarding_status||'—').toUpperCase();
  const statusClass=p.onboarding_status==='converted'?'online':p.onboarding_status==='cancelled'?'offline':'risk';
  const id=String(p.id);
  const prefix='pilot-'+id;
  const convertible=!['converted','cancelled'].includes(p.onboarding_status);
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(p.display_name)}</div><div class="tiny muted">Parceiro piloto • ${esc(p.proposed_product_code)}</div></div><span class="status-pill ${statusClass}">${esc(statusLabel)}</span></div>
    <div class="order-line"><strong>${p.pricing_mode==='range'?'Faixa comercial confirmada':'Preço comercial informado'}:</strong> ${p.pricing_mode==='range'?adminMoney(p.min_delivered_price_cents)+' mínimo • '+adminMoney(p.preferred_delivered_price_cents)+' normal • '+adminMoney(p.max_delivered_price_cents)+' máximo':adminMoney(p.proposed_delivered_price_cents)} ${p.delivery_included?'com entrega incluída':'antes da entrega'}</div>
    ${p.pricing_mode==='range'?`<div class="order-line"><strong>Estratégia inicial:</strong> ${esc(({volume:'Priorizar volume',balanced:'Equilibrado',margin:'Priorizar margem'})[p.pricing_strategy]||p.pricing_strategy||'—')}</div>`:''}
    <div class="order-line"><strong>Status do preço:</strong> ${p.price_status==='confirmed'?'confirmado':'proposto — ainda não publicar como oferta real'}</div>
    ${p.notes?`<div class="tiny muted">${esc(p.notes)}</div>`:''}
    ${adminPilotInviteControls(p,id)}
    ${p.onboarding_status==='converted'?`<div class="notice success" style="margin-top:10px"><strong>Revenda criada.</strong><br>ID: ${esc(p.merchant_id||'—')}. Compliance e ativação continuam separados.</div>`:''}
    ${convertible?`<div class="divider"></div>
      <div class="notice"><strong>Converter parceiro piloto em revenda</strong><br>Cria cadastro, dados comerciais, catálogo, estoque inicial e pagamentos selecionados. Compliance permanece <strong>pendente</strong>.</div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-legal">Razão social</label><input id="${prefix}-legal" class="input" maxlength="180" placeholder="Razão social real"></div>
        <div class="input-wrap"><label for="${prefix}-cnpj">CNPJ</label><input id="${prefix}-cnpj" class="input" maxlength="24" placeholder="CNPJ real"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-responsible">Responsável</label><input id="${prefix}-responsible" class="input" maxlength="120" placeholder="Nome do responsável"></div>
        <div class="input-wrap"><label for="${prefix}-owner-name">Nome no portal</label><input id="${prefix}-owner-name" class="input" maxlength="60" placeholder="Opcional"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-phone">Telefone</label><input id="${prefix}-phone" class="input" maxlength="24" placeholder="55..."></div>
        <div class="input-wrap"><label for="${prefix}-whatsapp">WhatsApp</label><input id="${prefix}-whatsapp" class="input" maxlength="24" placeholder="55..."></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-postal">CEP</label><input id="${prefix}-postal" class="input" maxlength="12" placeholder="97300000"></div>
        <div class="input-wrap"><label for="${prefix}-city">Cidade</label><input id="${prefix}-city" class="input" maxlength="120" value="São Gabriel"></div>
      </div>
      <div class="input-wrap"><label for="${prefix}-address">Endereço</label><input id="${prefix}-address" class="input" maxlength="240" placeholder="Rua, número e complemento"></div>
      <div class="notice"><strong>Owner automático pelo convite.</strong><br>O responsável operacional será vinculado à conta permanente que reivindicou este parceiro e concluiu o cadastro. Se o convite ainda não foi reivindicado, a conversão será bloqueada sem criar revenda órfã.</div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-stock">Estoque inicial</label><input id="${prefix}-stock" class="input" type="number" min="0" max="1000000" step="1" value="0"></div>
        <div class="input-wrap"><label for="${prefix}-fee">Taxa de entrega</label><input id="${prefix}-fee" class="input" type="number" min="0" max="1000" step="0.01" value="0.00"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="${prefix}-eta">ETA base (min)</label><input id="${prefix}-eta" class="input" type="number" min="5" max="180" step="1" value="30"></div>
        <div class="input-wrap"><label for="${prefix}-radius">Raio km</label><input id="${prefix}-radius" class="input" type="number" min="0" max="100" step="0.5" placeholder="Opcional"></div>
      </div>
      <label class="check-row"><input id="${prefix}-citywide" type="checkbox"><span><strong>Atende toda São Gabriel</strong><small>Marque apenas se a cobertura foi confirmada.</small></span></label>
      <div class="card flat"><strong>Formas de pagamento confirmadas</strong>
        <label class="check-row"><input id="${prefix}-pay-pix" type="checkbox"><span>Pix</span></label>
        <label class="check-row"><input id="${prefix}-pay-cash" type="checkbox"><span>Dinheiro</span></label>
        <label class="check-row"><input id="${prefix}-pay-card" type="checkbox"><span>Cartão na entrega</span></label>
      </div>
      <div class="input-wrap"><label for="${prefix}-notes">Observações administrativas</label><input id="${prefix}-notes" class="input" maxlength="2000" placeholder="Evidências, combinações e pendências"></div>
      <button class="primary" onclick="adminConvertPilotPartner('${id}')">Converter em revenda pendente</button>
    `:''}
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
    ${m.businessDetails?`<div class="order-line"><strong>Responsável:</strong> ${esc(m.businessDetails.responsible_name)} • ${esc(m.businessDetails.city)}/${esc(m.businessDetails.state)} • WhatsApp ${esc(m.businessDetails.whatsapp)}</div>`:''}
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

function adminSupportCaseCard(x){
  const category={
    late:'Atraso',
    wrong_item:'Produto incorreto',
    price_payment:'Preço ou pagamento',
    no_show:'Entrega não apareceu',
    delivery:'Problema na entrega',
    other:'Outro problema'
  }[x.category]||String(x.category||'Problema');
  const statusLabel={
    open:'ABERTO',
    in_review:'EM ANÁLISE',
    resolved:'RESOLVIDO',
    closed:'ENCERRADO'
  }[x.status]||String(x.status||'—').toUpperCase();
  const statusClass=['resolved','closed'].includes(x.status)?'online':x.status==='open'?'offline':'risk';
  return `<article class="order-card">
    <div class="order-head"><div><div class="order-id">${esc(category)}</div><div class="tiny muted">Pedido ${esc(x.order_id)} • aberto em ${new Date(x.created_at).toLocaleString('pt-BR')}</div></div><span class="status-pill ${statusClass}">${esc(statusLabel)}</span></div>
    ${x.message?`<div class="order-line"><strong>Cliente:</strong> ${esc(x.message)}</div>`:''}
    ${x.resolution_note?`<div class="notice success" style="margin-top:10px"><strong>Tratativa:</strong><br>${esc(x.resolution_note)}</div>`:''}
    ${!['resolved','closed'].includes(x.status)?`<div class="order-actions">${x.status==='open'?`<button class="secondary small" onclick="adminSetSupportStatus('${x.id}','in_review')">Assumir análise</button>`:''}<button class="primary small" onclick="adminSetSupportStatus('${x.id}','resolved')">Resolver</button><button class="ghost small" onclick="adminSetSupportStatus('${x.id}','closed')">Encerrar</button></div>`:''}
  </article>`;
}

function adminProductionRequirementLabel(code){
  return ({
    admin_required:'Administrador ativo',
    real_supply_required:'Primeira oferta real',
    merchant_owner_required:'Responsável da revenda',
    merchant_payment_required:'Forma de pagamento',
    offerable_supply_required:'Capacidade de atender agora',
    live_portals_verification_required:'Portais live e Turnstile'
  })[String(code||'')]||String(code||'Pendência');
}
function adminSecurityBlockerLabel(code){
  return ({
    browser_sensitive_table_acl:'Acesso direto do navegador a tabelas sensíveis detectado.',
    sensitive_table_rls_disabled:'RLS desativado em tabela sensível.',
    admin_rpc_browser_exposure:'RPC administrativa privilegiada exposta ao navegador.',
    live_portals_verification_required:'Portais oficiais sem verificação técnica recente e consistente.'
  })[String(code||'')]||String(code||'Bloqueio técnico');
}
function adminLaunchControl(readiness={}){
  const security=Array.isArray(readiness.securityBlockers)?readiness.securityBlockers:[];
  const warningDetails=Array.isArray(readiness.warningDetails)?readiness.warningDetails:[];
  const mode=String(readiness.operationMode|| (readiness.commerceEnabled?'LIVE':'PRELAUNCH')).toUpperCase();
  const readinessState=String(readiness.readinessState|| (security.length?'BLOCKED_SECURITY':warningDetails.length?'READY_WITH_WARNINGS':'READY'));
  const canActivate=readiness.canActivateOperation===true;
  const verifiedAt=readiness.portalsVerifiedAt
    ? new Date(readiness.portalsVerifiedAt).toLocaleString('pt-BR')
    : 'ainda não verificados';
  const sourceSha=String(readiness.portalsSourceSha||'');
  const stateClass=readinessState==='READY'?'online':readinessState==='BLOCKED_SECURITY'?'offline':'risk';
  const modeClass=['PILOT','LIVE'].includes(mode)?'online':mode==='PAUSED'?'offline':'risk';
  const warnings=warningDetails.map(item=>{
    const confirmed=item.confirmed===true;
    const expiry=item.expiresAt?new Date(item.expiresAt).toLocaleString('pt-BR'):null;
    return `<article class="order-card">
      <div class="order-head"><div><div class="order-id">${esc(adminProductionRequirementLabel(item.key))}</div><div class="tiny muted">${esc(item.condition||'Pendência operacional')}</div></div><span class="status-pill ${confirmed?'online':'risk'}">${confirmed?'CONFIRMADO PELO ADMIN':esc(item.status||'PENDENTE')}</span></div>
      <div class="order-line"><strong>Risco:</strong> ${esc(item.risk||'Pendência operacional.')}</div>
      <div class="order-line"><strong>Recomendação:</strong> ${esc(item.recommendation||'Revisar antes de operar.')}</div>
      ${item.reason?`<div class="notice success" style="margin-top:10px"><strong>Decisão registrada:</strong> ${esc(item.reason)}${expiry?' • válida até '+esc(expiry):''}</div>`:''}
      ${!confirmed?`<div class="order-actions"><button class="secondary small" onclick="adminConfirmLaunchRequirement('${String(item.key).replace(/'/g,'')}')">Revisar e confirmar</button></div>`:''}
    </article>`;
  }).join('');
  const securityHtml=security.length
    ? `<div class="notice danger"><strong>Bloqueios críticos — não podem ser ignorados</strong><br>${security.map(x=>'• '+esc(adminSecurityBlockerLabel(x))).join('<br>')}</div>`
    : '<div class="notice success"><strong>Segurança estrutural sem bloqueios detectados.</strong><br>RLS, ACLs privilegiadas e autoridade administrativa permanecem fail-closed.</div>';

  return `<section class="section"><div class="section-head"><div><span class="section-kicker">CENTRAL DE PRODUÇÃO</span><h2>Operação real sob controle do administrador</h2><p>Segurança técnica continua obrigatória. Pendências comerciais e operacionais são exibidas com risco, recomendação e decisão auditada.</p></div><div class="order-actions"><span class="status-pill ${stateClass}">${esc(readinessState)}</span><span class="status-pill ${modeClass}">${esc(mode)}</span></div></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Admins ativos</span><strong>${Number(readiness.activeAdminCount||0)}</strong></div>
      <div class="kpi"><span class="label">Revendas configuradas</span><strong>${Number(readiness.configuredMerchantCount||0)}</strong></div>
      <div class="kpi"><span class="label">Owner pronto</span><strong>${Number(readiness.ownerReadyMerchantCount||0)}</strong></div>
      <div class="kpi"><span class="label">Pagamento pronto</span><strong>${Number(readiness.paymentReadyMerchantCount||0)}</strong></div>
      <div class="kpi"><span class="label">Ofertável agora</span><strong>${Number(readiness.offerReadyMerchantCount||0)}</strong><small>${readiness.availableNow?'há oferta real possível':'nenhuma oferta real possível'}</small></div>
      <div class="kpi"><span class="label">Portais</span><strong>${readiness.portalsFresh?'OK':'ATENÇÃO'}</strong><small>${esc(verifiedAt)}</small></div>
    </div>
    <div class="card flat form-stack" style="margin-top:12px">
      ${securityHtml}
      ${warningDetails.length?`<div><strong>Alertas operacionais</strong><div class="tiny muted" style="margin-top:4px">Resolva a condição ou registre conscientemente a decisão administrativa antes de ativar PILOT/LIVE.</div></div>${warnings}`:'<div class="notice success"><strong>Checklist operacional recomendado concluído.</strong></div>'}
      ${sourceSha?`<small class="field-help">Bundle live atestado: <code>${esc(sourceSha.slice(0,12))}…</code></small>`:''}
      <div class="order-actions">
        <button class="secondary" onclick="adminVerifyLaunchPortals()">Verificar portais live</button>
        ${['PILOT','LIVE'].includes(mode)
          ?'<button class="danger-btn" onclick="adminSetOperationMode(\'PAUSED\')">Pausar novos pedidos</button>'
          :`<button class="primary" ${canActivate?'':'disabled'} onclick="adminSetOperationMode('PILOT')">ATIVAR OPERAÇÃO PILOTO</button>`}
        ${mode==='PILOT'?`<button class="secondary" ${canActivate?'':'disabled'} onclick="adminSetOperationMode('LIVE')">Promover para LIVE</button>`:''}
        ${mode==='PAUSED'?'<button class="ghost" onclick="adminSetOperationMode(\'PRELAUNCH\')">Voltar a PRELAUNCH</button>':''}
      </div>
      <small class="field-help">${security.length?'A ativação está bloqueada por segurança.':canActivate?'A autoridade server-side permite ativação explícita.':'Há alertas ainda não confirmados.'} O kill switch preserva pedidos existentes e bloqueia apenas novos pedidos.</small>
    </div>
  </section>`;
}

function adminOrderStatusLabel(status){
  return ({
    OFFERED_TO_MERCHANT:'AGUARDANDO PARCEIRO',
    MERCHANT_ACCEPTED:'ACEITO',
    PREPARING:'PREPARANDO',
    AT_RISK:'EM RISCO',
    REASSIGNING:'REATRIBUINDO',
    REQUOTE_REQUIRED:'CONFIRMAÇÃO DE PREÇO',
    OUT_FOR_DELIVERY:'A CAMINHO',
    ARRIVING:'CHEGANDO',
    DELIVERED:'ENTREGUE',
    SETTLED:'CONCLUÍDO',
    CANCELLED:'CANCELADO'
  })[String(status||'')]||String(status||'—');
}
function adminOrderIsLate(o){
  const now=Date.now();
  if(['DELIVERED','SETTLED','CANCELLED'].includes(o.status))return false;
  const promised=Date.parse(o.promised_by||'');
  const dispatch=Date.parse(o.dispatch_due_at||'');
  if(Number.isFinite(promised)&&promised<now)return true;
  if(['PREPARING','AT_RISK'].includes(o.status)&&Number.isFinite(dispatch)&&dispatch<now)return true;
  return false;
}
function adminControlOrderCard(o){
  const merchant=(adminRuntime.data?.merchants||[]).find(x=>x.id===o.merchant_id);
  const proposed=(adminRuntime.data?.merchants||[]).find(x=>x.id===o.proposed_merchant_id);
  const items=(o.items||[]).map(i=>`${Number(i.quantity||0)}× ${esc(i.product_name||i.product_code||'Item')}`).join(' • ');
  const late=adminOrderIsLate(o);
  const risk=['AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(o.status)||late;
  const rescueable=['OFFERED_TO_MERCHANT','PREPARING','AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(o.status)&&!o.dispatched_at;
  const cancellable=rescueable;
  const postDispatchIncident=['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status)&&!!o.dispatched_at;
  const customerPhone=String(o.customer_phone_digits||'').replace(/\D/g,'');
  const merchantWhatsapp=String(merchant?.businessDetails?.whatsapp||'').replace(/\D/g,'');
  const statusClass=['DELIVERED','SETTLED'].includes(o.status)?'online':o.status==='CANCELLED'?'offline':risk?'offline':'risk';
  const destination=[o.address_text,o.address_complement,o.delivery_reference].filter(Boolean).join(' • ');
  return `<article class="order-card ${risk?'new':''}">
    <div class="order-head"><div><div class="order-id">${esc(o.public_code||o.id)}</div><div class="tiny muted">${items||'Itens não carregados'}</div></div><div style="text-align:right"><span class="status-pill ${statusClass}">${esc(adminOrderStatusLabel(o.status))}</span>${late?'<div class="tiny" style="margin-top:4px"><strong>ATRASADO</strong></div>':''}</div></div>
    <div class="order-line"><strong>${adminMoney(o.total_cents)}</strong> • pagamento ${esc(String(o.payment_method||'—').toUpperCase())} • versão ${Number(o.version||0)}</div>
    <div class="order-line"><strong>Revenda:</strong> ${esc(merchant?.name||o.supplier_name_snapshot||'Ainda não definida')}${proposed?' • alternativa '+esc(proposed.name):''}</div>
    ${destination?`<div class="order-line"><strong>Entrega:</strong> ${esc(destination)}</div>`:''}
    ${o.risk_reason?`<div class="notice danger" style="margin-top:8px"><strong>Risco:</strong> ${esc(o.risk_reason)}</div>`:''}
    <div class="tiny muted">Atualizado ${esc(formatDateTime(o.updated_at))}${o.promised_by?' • prometido '+esc(formatDateTime(o.promised_by)):''}</div>
    <div class="order-actions">
      ${customerPhone?`<button class="ghost small" onclick="adminOpenWhatsapp('${customerPhone}')">Cliente</button>`:''}
      ${merchantWhatsapp?`<button class="ghost small" onclick="adminOpenWhatsapp('${merchantWhatsapp}')">Revenda</button>`:''}
      <button class="secondary small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'note')">Registrar observação</button>
      ${rescueable?`<button class="secondary small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'rescue')">Buscar outra revenda</button>`:''}
      ${cancellable?`<button class="danger-btn small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'cancel')">Cancelar antes da saída</button>`:''}
      ${postDispatchIncident?`<button class="danger-btn small" onclick="adminOrderControl('${o.id}',${Number(o.version||0)},'cancel-after-dispatch')">Encerrar entrega com falha</button>`:''}
    </div>
    ${postDispatchIncident?'<small class="field-help">Use apenas quando a entrega falhou definitivamente depois da saída. O pedido será encerrado e o cashback liberado, mas o estoque NÃO será devolvido automaticamente; a revenda deve reconciliar fisicamente o produto.</small>':''}
  </article>`;
}
function adminControlTower(d){
  const orders=d.controlOrders||[];
  const terminal=new Set(['DELIVERED','SETTLED','CANCELLED']);
  const active=orders.filter(o=>!terminal.has(o.status));
  const waiting=active.filter(o=>o.status==='OFFERED_TO_MERCHANT');
  const risks=active.filter(o=>['AT_RISK','REASSIGNING','REQUOTE_REQUIRED'].includes(o.status)||adminOrderIsLate(o));
  const delivery=active.filter(o=>['OUT_FOR_DELIVERY','ARRIVING'].includes(o.status));
  const visible=[...active,...orders.filter(o=>terminal.has(o.status)).slice(0,12)];
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">TORRE DE CONTROLE</span><h2>Pedidos agora</h2><p>Visão operacional com intervenção auditada. Resgate preserva estoque, capacidade, compliance e confirmação de preço.</p></div><span class="status-pill ${risks.length?'offline':'online'}">${risks.length} em risco</span></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Ativos</span><strong>${active.length}</strong></div>
      <div class="kpi"><span class="label">Aguardando aceite</span><strong>${waiting.length}</strong></div>
      <div class="kpi"><span class="label">Em risco/atrasados</span><strong>${risks.length}</strong></div>
      <div class="kpi"><span class="label">Em entrega</span><strong>${delivery.length}</strong></div>
    </div>
    <div style="margin-top:12px">${visible.length?visible.map(adminControlOrderCard).join(''):'<div class="empty card">Nenhum pedido real registrado ainda.</div>'}</div>
  </section>`;
}

function adminBpsPct(bps){
  const n=Number(bps||0)/100;
  return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
}
function adminProductRegistrySection(d){
  const registry=d.productRegistry||{};
  const categories=Array.isArray(registry.categories)?registry.categories:[];
  const profiles=Array.isArray(registry.products)?registry.products:[];
  const general=profiles.filter(x=>x.delivery_class==='household_general');
  const glpGas=profiles.filter(x=>/^P([1-9][0-9]?)$/.test(String(x.product_code||'')));
  const glpContainers=profiles.filter(x=>/^P([1-9][0-9]?)_CONTAINER$/.test(String(x.product_code||'')));
  const selectableCategories=categories.filter(x=>x.active&&x.category_key!=='glp');
  const categoryCards=categories.map(cat=>`<div class="list-row">
    <div><strong>${esc(cat.category_name)}</strong><br><small>${esc(cat.category_key)} • ordem ${Number(cat.sort_order||100)}</small></div>
    <div class="order-actions"><span class="status-pill ${cat.active?'online':'offline'}">${cat.active?'ATIVA':'PAUSADA'}</span><button class="${cat.active?'danger-btn':'secondary'} small" onclick="adminToggleProductCategory('${esc(cat.category_key)}',${cat.active?'false':'true'},${Number(cat.sort_order||100)})">${cat.active?'Pausar':'Ativar'}</button></div>
  </div>`).join('');
  const productRows=general.map(item=>`<div class="list-row">
    <div><strong>${esc(item.product_name)}</strong><br><small>${esc(item.product_code)} • ${esc(item.category_key)} • ordem ${Number(item.sort_order||100)}</small></div>
    <div class="order-actions"><span class="status-pill ${item.active?'online':'offline'}">${item.active?'ATIVO':'PAUSADO'}</span><button class="${item.active?'danger-btn':'secondary'} small" onclick="adminSetProductActive('${esc(item.product_code)}',${item.active?'false':'true'})">${item.active?'Pausar':'Ativar'}</button></div>
  </div>`).join('');
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">CATÁLOGO DA PLATAFORMA</span><h2>Categorias e produtos</h2><p>Produtos gerais podem ser criados sem novo deploy. A família GLP P1–P90 e seus vasilhames permanece canônica e protegida.</p></div></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Categorias</span><strong>${categories.length}</strong></div>
      <div class="kpi"><span class="label">Produtos gerais</span><strong>${general.length}</strong></div>
      <div class="kpi"><span class="label">Cargas GLP</span><strong>${glpGas.length}</strong></div>
      <div class="kpi"><span class="label">Vasilhames GLP</span><strong>${glpContainers.length}</strong></div>
    </div>
    <div class="card flat form-stack" style="margin-top:12px">
      <h3>Nova categoria</h3>
      <div class="field-row">
        <div class="input-wrap"><label for="registry-category-key">Chave</label><input id="registry-category-key" class="input" maxlength="40" placeholder="bebidas"></div>
        <div class="input-wrap"><label for="registry-category-name">Nome</label><input id="registry-category-name" class="input" maxlength="80" placeholder="Bebidas"></div>
        <div class="input-wrap"><label for="registry-category-sort">Ordem</label><input id="registry-category-sort" class="input" type="number" min="0" max="10000" step="1" value="100"></div>
      </div>
      <button class="secondary" onclick="adminCreateProductCategory()">Criar categoria</button>
      <div class="divider"></div>
      <h3>Novo produto geral</h3>
      <div class="field-row">
        <div class="input-wrap"><label for="registry-product-code">Código</label><input id="registry-product-code" class="input" maxlength="32" placeholder="SODA2L"></div>
        <div class="input-wrap"><label for="registry-product-name">Nome</label><input id="registry-product-name" class="input" maxlength="120" placeholder="Refrigerante 2 L"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="registry-product-category">Categoria</label><select id="registry-product-category" class="input">${selectableCategories.map(cat=>`<option value="${esc(cat.category_key)}">${esc(cat.category_name)}</option>`).join('')}</select></div>
        <div class="input-wrap"><label for="registry-product-sort">Ordem</label><input id="registry-product-sort" class="input" type="number" min="0" max="10000" step="1" value="100"></div>
      </div>
      <label class="check-row"><input id="registry-product-visible" type="checkbox" checked><span><strong>Visível ao cliente</strong><small>Só aparece na vitrine quando houver oferta configurada.</small></span></label>
      <label class="check-row"><input id="registry-product-merchant" type="checkbox" checked><span><strong>Revendas podem adicionar ao catálogo</strong><small>A revenda ainda precisa definir preço, estoque e disponibilidade.</small></span></label>
      <button class="primary" onclick="adminCreateRegistryProduct()" ${selectableCategories.length?'':'disabled'}>Cadastrar produto</button>
      ${selectableCategories.length?'':'<div class="notice danger">Crie ou ative uma categoria geral antes de cadastrar produto.</div>'}
    </div>
    <div class="card flat" style="margin-top:12px"><h3>Categorias</h3><div class="list">${categoryCards||'<div class="tiny muted">Nenhuma categoria cadastrada.</div>'}</div></div>
    <div class="card flat" style="margin-top:12px"><h3>Produtos gerais</h3><div class="list">${productRows||'<div class="tiny muted">Nenhum produto geral cadastrado.</div>'}</div></div>
  </section>`;
}

function adminCommercialPolicySection(d){
  const p=d.commercialPolicy;
  if(!p)return `<section class="section"><div class="notice danger"><strong>Política comercial indisponível.</strong><br>O painel não conseguiu carregar a autoridade financeira.</div></section>`;
  const fee=Number(p.platform_fee_bps||0);
  const variable=Number(p.variable_cost_bps||0);
  const contribution=Number(p.minimum_contribution_bps||0);
  const cashback=Number(p.cashback_bps||0);
  const referral=Number(p.direct_referral_bps||0);
  const rewards=cashback+referral;
  const headroom=Math.max(0,fee-variable-contribution-rewards);
  const per100=(bps)=>adminMoney(Math.floor(10000*Number(bps||0)/10000));
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">ECONOMIA E INCENTIVOS</span><h2>Política comercial</h2><p>As alterações são snapshotadas somente em pedidos novos. Pedidos existentes preservam a regra vigente quando foram criados.</p></div><span class="status-pill ${p.active?'online':'offline'}">V${Number(p.policy_version||1)} • ${p.active?'ATIVA':'INATIVA'}</span></div>
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Taxa TAMÃO</span><strong>${adminBpsPct(fee)}%</strong><small>${per100(fee)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Reserva variável</span><strong>${adminBpsPct(variable)}%</strong><small>${per100(variable)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Contribuição mínima</span><strong>${adminBpsPct(contribution)}%</strong><small>${per100(contribution)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Cashback</span><strong>${adminBpsPct(cashback)}%</strong><small>${per100(cashback)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Indicação</span><strong>${adminBpsPct(referral)}%</strong><small>${per100(referral)} por R$ 100</small></div>
      <div class="kpi"><span class="label">Folga econômica</span><strong>${adminBpsPct(headroom)}%</strong><small>${per100(headroom)} por R$ 100 no pior caso</small></div>
    </div>
    <div class="card flat form-stack" style="margin-top:12px">
      <label class="check-row"><input id="policy-active" type="checkbox" ${p.active?'checked':''} onchange="adminPreviewCommercialPolicy()"><span><strong>Política ativa para novos pedidos</strong><small>Desativar durante PILOT/LIVE é bloqueado pelo servidor; pause a operação primeiro.</small></span></label>
      <div class="field-row">
        <div class="input-wrap"><label for="policy-fee">Taxa TAMÃO (%)</label><input id="policy-fee" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(fee)}" oninput="adminPreviewCommercialPolicy()"></div>
        <div class="input-wrap"><label for="policy-variable">Reserva de custo (%)</label><input id="policy-variable" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(variable)}" oninput="adminPreviewCommercialPolicy()"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="policy-contribution">Contribuição mínima (%)</label><input id="policy-contribution" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(contribution)}" oninput="adminPreviewCommercialPolicy()"></div>
        <div class="input-wrap"><label for="policy-cashback">Cashback (%)</label><input id="policy-cashback" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(cashback)}" oninput="adminPreviewCommercialPolicy()"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="policy-referral">Indicação direta (%)</label><input id="policy-referral" type="number" min="0" max="50" step="0.05" class="input" value="${adminBpsPct(referral)}" oninput="adminPreviewCommercialPolicy()"></div>
        <div class="input-wrap"><label for="policy-hold">Carência da indicação (horas)</label><input id="policy-hold" type="number" min="0" max="2160" step="1" class="input" value="${Number(p.commission_hold_hours||0)}"></div>
      </div>
      <div id="policy-preview" class="notice"><strong>Prévia por R$ 100:</strong><br>Taxa ${per100(fee)} • custo ${per100(variable)} • contribuição mínima ${per100(contribution)} • cashback ${per100(cashback)} • indicação ${per100(referral)} • folga ${per100(headroom)}.</div>
      <div class="input-wrap"><label for="policy-reason">Motivo da alteração</label><input id="policy-reason" class="input" maxlength="1000" placeholder="Ex.: ajustar cashback do piloto após revisão de margem"></div>
      <button class="primary" onclick="adminSaveCommercialPolicy(${Number(p.policy_version||1)})">Salvar política para pedidos futuros</button>
      ${p.last_change_reason?`<small class="field-help">Última decisão: ${esc(p.last_change_reason)} • ${esc(formatDateTime(p.updated_at))}</small>`:''}
    </div>
  </section>`;
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
  if(adminRuntime.status==='bootstrap-error')return adminBootstrapErrorView();
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
  const supportCases=d.supportCases||[];
  const openSupportCases=supportCases.filter(x=>['open','in_review'].includes(x.status));
  const controlOrders=d.controlOrders||[];
  const metrics=d.businessMetrics||{};
  const openFees=receivables.reduce((s,x)=>s+Number(x.platform_fee_cents||0),0);
  const openCashback=reimbursements.reduce((s,x)=>s+Number(x.cashback_cents||0),0);
  const openAdjustments=adjustments.reduce((s,x)=>s+Number(x.amount_cents||0),0);

  return shell(`<section class="page">
    <div class="status-bar"><div><div class="tiny muted">CONTROL PLANE REAL</div><h1 class="page-title" style="margin-bottom:2px">Administração TAMÃO</h1></div><div class="order-actions"><button class="secondary small" onclick="adminRefresh()">Atualizar</button><button class="ghost small" onclick="adminSignOut()">Sair</button></div></div>
    ${adminRuntime.error?`<div class="notice danger" style="margin-top:12px">${esc(adminRuntime.error)}</div>`:''}

    ${adminLaunchControl(d.launchReadiness||{})}

    ${adminControlTower({...d,controlOrders})}

    ${adminProductRegistrySection(d)}

    ${adminCommercialPolicySection(d)}

    <section class="section"><div class="section-head"><div><span class="section-kicker">NEGÓCIO • 30 DIAS</span><h2>Pulso da operação</h2><p>Indicadores server-side calculados apenas sobre fatos liquidados e estados reais do pedido.</p></div></div><div class="merchant-kpis">
      <div class="kpi"><span class="label">GMV 30d</span><strong>${adminMoney(metrics.gmvCents30d)}</strong><small>${Number(metrics.settledOrders30d||0)} pedidos liquidados</small></div>
      <div class="kpi"><span class="label">Ticket médio</span><strong>${adminMoney(metrics.averageTicketCents30d)}</strong></div>
      <div class="kpi"><span class="label">Clientes recorrentes</span><strong>${metrics.repeatRate30d==null?'—':Math.round(Number(metrics.repeatRate30d)*100)+'%'}</strong><small>${Number(metrics.repeatCustomers30d||0)} de ${Number(metrics.activeCustomers30d||0)} clientes ativos</small></div>
      <div class="kpi"><span class="label">Cancelamentos</span><strong>${metrics.cancellationRate30d==null?'—':Math.round(Number(metrics.cancellationRate30d)*100)+'%'}</strong><small>${Number(metrics.cancelledOrders30d||0)} de ${Number(metrics.createdOrders30d||0)} pedidos</small></div>
      <div class="kpi"><span class="label">Pontualidade 90d</span><strong>${metrics.onTimeRate90d==null?'—':Math.round(Number(metrics.onTimeRate90d)*100)+'%'}</strong></div>
      <div class="kpi"><span class="label">Taxa gerada 30d</span><strong>${adminMoney(metrics.platformFeeGeneratedCents30d)}</strong></div>
      <div class="kpi"><span class="label">Cashback 30d</span><strong>${adminMoney(metrics.cashbackGrantedCents30d)}</strong></div>
      <div class="kpi"><span class="label">Atendimentos abertos</span><strong>${Number(metrics.openSupportCases||openSupportCases.length)}</strong></div>
    </div></section>

    <section class="section"><div class="merchant-kpis">
      <div class="kpi"><span class="label">Cadastros pendentes</span><strong>${pending.length}</strong></div>
      <div class="kpi"><span class="label">Parceiros piloto</span><strong>${pilotPartners.filter(x=>x.onboarding_status!=='cancelled').length}</strong></div>
      <div class="kpi"><span class="label">Revendas ativas</span><strong>${active.length}</strong></div>
      <div class="kpi"><span class="label">Taxas a receber</span><strong>${adminMoney(openFees)}</strong></div>
      <div class="kpi"><span class="label">Cashback a reembolsar</span><strong>${adminMoney(openCashback)}</strong></div>
    </div></section>

    ${adminPrelaunchLeadsSection(d)}

    ${adminPublicRequestsSection(d)}

    <section class="section"><div class="section-head"><div><h2>Atendimento de pedidos</h2><p>Problemas registrados pelo cliente entram aqui com vínculo ao pedido, status e trilha administrativa.</p></div><span class="status-pill ${openSupportCases.length?'offline':'online'}">${openSupportCases.length} aberto(s)</span></div>${supportCases.length?supportCases.map(adminSupportCaseCard).join(''):'<div class="empty card">Nenhum atendimento registrado.</div>'}</section>

    <section class="section"><div class="section-head"><div><h2>Administradores da plataforma</h2><p>O primeiro admin é criado somente por bootstrap server-side. Depois disso, esta tela mantém redundância operacional sem permitir remover o último admin ativo.</p></div><span class="status-pill online">${platformAdmins.filter(x=>x.active).length} ativo(s)</span></div>
      <div class="card flat form-stack">
        <div class="list">${platformAdmins.length?platformAdmins.map(x=>`<div class="list-row"><div><strong>${esc(x.user_id)}</strong><br><small>${x.active?'Administrador ativo':'Acesso administrativo suspenso'}</small></div><div class="order-actions"><span class="status-pill ${x.active?'online':'offline'}">${x.active?'ATIVO':'INATIVO'}</span><button class="${x.active?'danger-btn':'secondary'} small" onclick="adminSetPlatformAdmin('${x.user_id}',${x.active?'false':'true'})">${x.active?'Desativar':'Ativar'}</button></div></div>`).join(''):'<div class="tiny muted">Nenhum administrador bootstrapado ainda.</div>'}</div>
        <div class="divider"></div>
        <div class="input-wrap"><label for="admin-new-user-email">E-mail da conta permanente</label><input id="admin-new-user-email" class="input" type="email" maxlength="160" autocomplete="off" placeholder="pessoa@empresa.com"><small class="field-help">A pessoa precisa ter acessado o TAMÃO com este e-mail ao menos uma vez. O servidor resolve a conta sem expor UUIDs.</small></div>
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

async function adminCreateProductCategory(){
  const categoryKey=String(document.getElementById('registry-category-key')?.value||'').trim().toLowerCase();
  const categoryName=String(document.getElementById('registry-category-name')?.value||'').trim();
  const sortOrder=Number(document.getElementById('registry-category-sort')?.value||100);
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(categoryKey))return toast('Use uma chave simples, como bebidas ou limpeza');
  if(categoryName.length<2)return toast('Informe o nome da categoria');
  if(!Number.isSafeInteger(sortOrder)||sortOrder<0||sortOrder>10000)return toast('Ordem inválida');
  const reason=prompt('Motivo para criar/atualizar esta categoria:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  try{
    await adminPerform('product-registry',{
      registryAction:'upsert-category',categoryKey,categoryName,
      active:true,sortOrder,reason
    });
    toast('Categoria salva');
  }catch(e){toast(String(e?.message||e))}
}
async function adminToggleProductCategory(categoryKey,active,sortOrder){
  const category=(adminRuntime.data?.productRegistry?.categories||[]).find(x=>x.category_key===categoryKey);
  const categoryName=String(category?.category_name||categoryKey);
  const reason=prompt((active?'Motivo para ativar ':'Motivo para pausar ')+categoryName+':')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  if(!active&&!confirm('Pausar esta categoria? SKUs ativos das revendas serão pausados e precisarão ser reconfirmados antes de voltar a vender.'))return;
  try{
    await adminPerform('product-registry',{
      registryAction:'upsert-category',categoryKey,categoryName,
      active:active===true,sortOrder:Number(sortOrder||100),reason
    });
    toast(active?'Categoria ativada':'Categoria pausada');
  }catch(e){toast(String(e?.message||e))}
}
async function adminCreateRegistryProduct(){
  const productCode=String(document.getElementById('registry-product-code')?.value||'').trim().toUpperCase();
  const productName=String(document.getElementById('registry-product-name')?.value||'').trim();
  const categoryKey=String(document.getElementById('registry-product-category')?.value||'').trim().toLowerCase();
  const sortOrder=Number(document.getElementById('registry-product-sort')?.value||100);
  const customerVisible=document.getElementById('registry-product-visible')?.checked===true;
  const merchantAddAllowed=document.getElementById('registry-product-merchant')?.checked===true;
  if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(productCode))return toast('Código inválido. Use letras, números e underscore.');
  if(/^P[0-9]/.test(productCode))return toast('Códigos Pxx são reservados à família GLP canônica');
  if(productName.length<2)return toast('Informe o nome do produto');
  if(!categoryKey||categoryKey==='glp')return toast('Escolha uma categoria geral');
  if(!Number.isSafeInteger(sortOrder)||sortOrder<0||sortOrder>10000)return toast('Ordem inválida');
  const reason=prompt('Motivo para cadastrar/atualizar este produto:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  try{
    await adminPerform('product-registry',{
      registryAction:'upsert-product',
      categoryKey,productCode,productName,
      deliveryClass:'household_general',
      requiresIsolatedDelivery:false,
      customerVisible,merchantAddAllowed,
      active:true,sortOrder,reason
    });
    toast('Produto salvo no catálogo da plataforma');
  }catch(e){toast(String(e?.message||e))}
}
async function adminSetProductActive(productCode,active){
  const reason=prompt((active?'Motivo para ativar ':'Motivo para pausar ')+productCode+':')||'';
  if(reason.trim().length<3)return toast('Informe o motivo');
  if(!active&&!confirm('Pausar este produto? Itens ativos das revendas serão pausados e não serão reativados automaticamente.'))return;
  try{
    await adminPerform('product-registry',{
      registryAction:'set-product-active',
      productCode,active:active===true,sortOrder:100,reason
    });
    toast(active?'Produto ativado':'Produto pausado');
  }catch(e){toast(String(e?.message||e))}
}

function adminPolicyFieldBps(id){
  const n=Number(document.getElementById(id)?.value);
  if(!Number.isFinite(n)||n<0||n>50)return null;
  return Math.round(n*100);
}
function adminPreviewCommercialPolicy(){
  const el=document.getElementById('policy-preview');
  if(!el)return;
  const fee=adminPolicyFieldBps('policy-fee');
  const variable=adminPolicyFieldBps('policy-variable');
  const contribution=adminPolicyFieldBps('policy-contribution');
  const cashback=adminPolicyFieldBps('policy-cashback');
  const referral=adminPolicyFieldBps('policy-referral');
  if([fee,variable,contribution,cashback,referral].some(x=>x==null)){
    el.className='notice danger';
    el.innerHTML='<strong>Prévia indisponível.</strong><br>Revise os percentuais.';
    return;
  }
  const headroom=fee-variable-contribution-cashback-referral;
  const cents=(bps)=>adminMoney(Math.floor(10000*bps/10000));
  el.className='notice '+(headroom>=0?'success':'danger');
  el.innerHTML='<strong>Prévia por R$ 100:</strong><br>Taxa '+cents(fee)+' • custo '+cents(variable)+' • contribuição mínima '+cents(contribution)+' • cashback '+cents(cashback)+' • indicação '+cents(referral)+' • folga '+cents(Math.max(0,headroom))+(headroom<0?' • <strong>POLÍTICA NÃO FINANCIADA</strong>':'');
}
async function adminSaveCommercialPolicy(expectedVersion){
  const active=document.getElementById('policy-active')?.checked===true;
  const platformFeeBps=adminPolicyFieldBps('policy-fee');
  const variableCostBps=adminPolicyFieldBps('policy-variable');
  const minimumContributionBps=adminPolicyFieldBps('policy-contribution');
  const cashbackBps=adminPolicyFieldBps('policy-cashback');
  const directReferralBps=adminPolicyFieldBps('policy-referral');
  const commissionHoldHours=Number(document.getElementById('policy-hold')?.value);
  const reason=document.getElementById('policy-reason')?.value.trim()||'';
  if([platformFeeBps,variableCostBps,minimumContributionBps,cashbackBps,directReferralBps].some(x=>x==null)){
    return toast('Revise os percentuais da política');
  }
  if(!Number.isSafeInteger(commissionHoldHours)||commissionHoldHours<0||commissionHoldHours>2160){
    return toast('A carência precisa estar entre 0 e 2160 horas');
  }
  if(reason.length<3)return toast('Informe o motivo da alteração');
  if(active&&platformFeeBps<variableCostBps+minimumContributionBps+cashbackBps+directReferralBps){
    return toast('A taxa TAMÃO não financia custos, contribuição mínima e recompensas informadas');
  }
  if(!confirm('Salvar esta política para PEDIDOS FUTUROS? Pedidos existentes manterão seus snapshots atuais.'))return;
  try{
    await adminPerform('commercial-policy',{
      expectedVersion,
      active,
      platformFeeBps,
      variableCostBps,
      minimumContributionBps,
      cashbackBps,
      directReferralBps,
      commissionHoldHours,
      reason
    });
    toast('Política comercial atualizada para pedidos futuros');
  }catch(e){toast(String(e?.message||e))}
}

function adminOpenWhatsapp(phone){
  const digits=String(phone||'').replace(/\D/g,'');
  if(digits.length<10)return toast('Contato indisponível');
  window.open('https://wa.me/'+digits,'_blank','noopener,noreferrer');
}
async function adminOrderControl(orderId,expectedVersion,controlAction){
  const labels={
    note:'Registrar uma observação administrativa neste pedido:',
    rescue:'Motivo para buscar outra revenda:',
    cancel:'Motivo para cancelar o pedido antes da saída:',
    'cancel-after-dispatch':'Descreva a falha confirmada depois da saída:'
  };
  const reason=prompt(labels[controlAction]||'Motivo da intervenção:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo da intervenção');
  if(controlAction==='rescue'&&!confirm('Buscar outra revenda agora? O sistema revalidará estoque, preço, compliance, pagamento e capacidade. Se a nova condição for mais cara, o cliente deverá confirmar.'))return;
  if(controlAction==='cancel'&&!confirm('Cancelar este pedido antes da saída? Estoque reservado e cashback serão restaurados quando aplicável.'))return;
  if(controlAction==='cancel-after-dispatch'&&!confirm('Encerrar esta entrega após a saída? O cashback será liberado e o PIN invalidado, mas o estoque NÃO será restaurado automaticamente. Use somente após confirmar que a entrega falhou.'))return;
  try{
    const result=await adminPerform('order-control',{orderId,expectedVersion,controlAction,reason});
    toast(controlAction==='note'?'Observação registrada':controlAction==='rescue'?'Resgate executado':controlAction==='cancel-after-dispatch'?'Entrega falhada encerrada; revisar estoque físico':'Pedido cancelado');
    return result;
  }catch(e){toast(String(e?.message||e))}
}

async function adminVerifyLaunchPortals(){
  try{
    const result=await adminPerform('verify-launch-portals',{});
    if(result?.ok)toast('Os três portais live foram verificados');
  }catch(e){toast(String(e?.message||e))}
}
async function adminConfirmLaunchRequirement(requirementKey){
  const reason=prompt('Explique por que esta pendência pode ser assumida agora pelo administrador:')||'';
  if(reason.trim().length<3)return toast('Informe o motivo da decisão');
  const hoursText=prompt('Validade da confirmação em horas. Deixe vazio para não expirar:','24');
  if(hoursText===null)return;
  let expiresAt=null;
  if(String(hoursText).trim()){
    const hours=Number(hoursText);
    if(!Number.isFinite(hours)||hours<=0||hours>8760)return toast('Informe uma validade entre 1 e 8760 horas');
    expiresAt=new Date(Date.now()+hours*60*60*1000).toISOString();
  }
  const evidence=prompt('Evidência ou referência opcional:','')||'';
  if(!confirm('Estou ciente do risco e desejo registrar esta decisão administrativa.'))return;
  try{
    await adminPerform('confirm-launch-requirement',{
      requirementKey,
      status:'confirmed',
      reason,
      evidence,
      expiresAt,
      source:'admin-panel'
    });
    toast('Decisão registrada na auditoria');
  }catch(e){toast(String(e?.message||e))}
}
async function adminSetOperationMode(mode){
  const target=String(mode||'').toUpperCase();
  const labels={PRELAUNCH:'voltar ao pré-lançamento',PILOT:'ativar a operação piloto',LIVE:'ativar a operação normal',PAUSED:'pausar novos pedidos'};
  if(!labels[target])return toast('Modo operacional inválido');
  const reason=prompt('Motivo para '+labels[target]+':')||'';
  if(reason.trim().length<3)return toast('Informe o motivo da mudança');
  const confirmText=target==='PAUSED'
    ?'Pausar novos pedidos agora? Pedidos existentes e o painel continuarão acessíveis.'
    :target==='LIVE'
      ?'Ativar LIVE agora? Esta ação libera a operação normal conforme o checklist confirmado.'
      :target==='PILOT'
        ?'Ativar PILOT agora? Pedidos reais serão permitidos em operação controlada.'
        :'Voltar a PRELAUNCH? Novos pedidos reais ficarão bloqueados.';
  if(!confirm(confirmText))return;
  try{
    await adminPerform('set-operation-mode',{mode:target,reason});
    toast('Modo operacional atualizado para '+target);
  }catch(e){toast(String(e?.message||e))}
}
async function adminSetCommerceEnabled(enabled){
  return adminSetOperationMode(enabled?'PILOT':'PAUSED');
}

async function adminSetSupportStatus(caseId,status){
  const label=status==='in_review'?'colocar este atendimento em análise':status==='resolved'?'resolver este atendimento':'encerrar este atendimento';
  let resolutionNote='';
  if(['resolved','closed'].includes(status)){
    resolutionNote=prompt('Descreva a solução ou motivo do encerramento:')||'';
    if(resolutionNote.trim().length<3)return toast('Informe como o atendimento foi tratado');
  }
  if(!confirm('Confirma '+label+'?'))return;
  try{
    await adminPerform('support-case-status',{caseId,status,resolutionNote});
    toast(status==='in_review'?'Atendimento em análise':status==='resolved'?'Atendimento resolvido':'Atendimento encerrado');
  }catch(e){toast(String(e?.message||e))}
}

async function adminConvertPilotPartner(id){
  const p=(adminRuntime.data?.pilotPartners||[]).find(x=>x.id===id);
  if(!p)return toast('Parceiro piloto não encontrado');
  const prefix='pilot-'+id;
  const value=(suffix)=>document.getElementById(prefix+'-'+suffix)?.value?.trim()||'';
  const checked=(suffix)=>document.getElementById(prefix+'-'+suffix)?.checked===true;
  const paymentMethods=[];
  if(checked('pay-pix'))paymentMethods.push('pix');
  if(checked('pay-cash'))paymentMethods.push('cash');
  if(checked('pay-card'))paymentMethods.push('card');
  const required={
    legalName:value('legal'),cnpj:value('cnpj'),responsibleName:value('responsible'),
    phone:value('phone'),whatsapp:value('whatsapp'),postalCode:value('postal'),
    city:value('city'),addressText:value('address')
  };
  if(Object.values(required).some(x=>!x))return toast('Preencha os dados reais obrigatórios da revenda');
  const ownerUserId=null;
  const availableStock=Number(value('stock')||0);
  const deliveryFeeCents=Math.round(Number(value('fee')||0)*100);
  const baseEtaMinutes=Number(value('eta')||30);
  const radiusText=value('radius');
  if(!confirm('Criar esta revenda como PENDENTE? Compliance não será marcado como verificado e a revenda não ficará online automaticamente.'))return;
  try{
    const result=await adminPerform('assisted-merchant-onboarding',{
      draftId:id,
      tradeName:p.display_name,
      ...required,
      state:'RS',
      ownerUserId,
      ownerDisplayName:value('owner-name')||null,
      productCode:p.proposed_product_code,
      productName:adminProductName(p.proposed_product_code),
      pricingMode:p.pricing_mode||'fixed',
      minPriceCents:Number(p.min_delivered_price_cents||p.proposed_delivered_price_cents),
      preferredPriceCents:Number(p.preferred_delivered_price_cents||p.proposed_delivered_price_cents),
      maxPriceCents:Number(p.max_delivered_price_cents||p.proposed_delivered_price_cents),
      pricingStrategy:p.pricing_strategy||'balanced',
      availableStock,
      paymentMethods,
      deliveryFeeCents,
      baseEtaMinutes,
      acceptsCitywide:checked('citywide'),
      serviceRadiusKm:radiusText===''?null:Number(radiusText),
      adminNotes:value('notes')||null
    });
    toast(result?.alreadyConverted?'Parceiro já estava convertido':'Revenda criada como pendente');
  }catch(e){toast(String(e?.message||e))}
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
  const targetEmail=document.querySelector('#admin-new-user-email')?.value.trim().toLowerCase()||'';
  if(targetEmail.length<3||targetEmail.length>160||!/^\S+@\S+\.\S+$/.test(targetEmail)){
    return toast('Informe um e-mail válido de conta permanente');
  }
  try{
    await adminPerform('set-platform-admin',{targetEmail,active:true});
    toast('Administrador ativado');
  }catch(e){toast(String(e?.message||e))}
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
globalThis.adminRetryBootstrapFromUi=adminRetryBootstrapFromUi;
globalThis.adminSignOut=adminSignOut;
globalThis.adminRefresh=adminRefresh;
globalThis.adminPoll=adminPoll;
globalThis.adminPage=adminPage;
globalThis.adminRetryReward=adminRetryReward;
globalThis.adminRetryAccounting=adminRetryAccounting;
globalThis.adminSetPlatformAdmin=adminSetPlatformAdmin;
globalThis.adminAddPlatformAdmin=adminAddPlatformAdmin;
globalThis.openAdminPortal=openAdminPortal;


globalThis.adminCreateProductCategory=adminCreateProductCategory;
globalThis.adminToggleProductCategory=adminToggleProductCategory;
globalThis.adminCreateRegistryProduct=adminCreateRegistryProduct;
globalThis.adminSetProductActive=adminSetProductActive;
globalThis.adminPreviewCommercialPolicy=adminPreviewCommercialPolicy;
globalThis.adminSaveCommercialPolicy=adminSaveCommercialPolicy;
globalThis.adminOpenWhatsapp=adminOpenWhatsapp;
globalThis.adminOrderControl=adminOrderControl;
globalThis.adminVerifyLaunchPortals=adminVerifyLaunchPortals;
globalThis.adminConfirmLaunchRequirement=adminConfirmLaunchRequirement;
globalThis.adminSetOperationMode=adminSetOperationMode;
globalThis.adminSetCommerceEnabled=adminSetCommerceEnabled;
globalThis.adminSetSupportStatus=adminSetSupportStatus;
globalThis.adminConvertPilotPartner=adminConvertPilotPartner;

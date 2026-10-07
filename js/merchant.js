function merchantRealPortalRequired(){
  return shell('<section class="page"><span class="eyebrow">ÁREA DA REVENDA</span><h1 class="page-title">Acesso operacional real</h1><p class="muted">A operação da revenda não possui modo fictício em produção.</p><button class="primary full" onclick="openMerchantPortal()">Entrar / cadastrar revenda</button></section>');
}

function merchantLiveLoginView(){
  const rt=globalThis.merchantRuntime||{};
  const pilotInvite=String(globalThis.merchantPilotInviteToken?.()||'').trim();
  return shell(`<section class="page">
    <span class="eyebrow">${pilotInvite?'CONVITE DE PARCEIRO PILOTO':'PAINEL REAL DA REVENDA'}</span>
    <h1 class="page-title">${pilotInvite?'Entre para continuar seu cadastro':'Acessar operação'}</h1>
    <p class="muted">${pilotInvite?'Use o e-mail que ficará responsável pela operação. Depois do link de acesso, você volta direto ao cadastro da empresa.':'Use o e-mail vinculado à sua revenda. O acesso é separado da sessão do cliente.'}</p>
    ${pilotInvite?'<div class="notice success" style="margin-top:14px"><strong>Convite reconhecido.</strong><br>Suas condições comerciais já estão preservadas no TAMÃO. Entrar não coloca a revenda online nem libera pedidos.</div>':''}
    ${rt.notice?`<div class="notice success" style="margin-top:14px">${esc(rt.notice)}</div>`:''}
    ${rt.error?`<div class="notice danger" style="margin-top:14px">${esc(rt.error)}</div>`:''}
    <div class="card flat form-stack" style="margin-top:16px">
      <div class="input-wrap"><label for="merchant-email">E-mail</label><input id="merchant-email" type="email" autocomplete="email" class="input" maxlength="160" placeholder="voce@empresa.com"></div>
      <button class="primary" onclick="merchantLoginFromUi()">Enviar link de acesso</button>
    </div>
    <div class="notice" style="margin-top:14px">Somente contas permanentes podem operar revendas. Cadastro de empresa e acesso operacional são aprovados separadamente.</div>
  </section>`);
}

function merchantLiveNoAccess(){
  const rt=globalThis.merchantRuntime||{};
  const email=rt.session?.user?.email||'conta autenticada';
  const roleBlocked=rt.accessReason==='MERCHANT_ROLE_NOT_ENABLED';
  return shell(`<section class="page">
    <span class="eyebrow">CONTA AUTENTICADA</span>
    <h1 class="page-title">${roleBlocked?'Seu acesso ainda não habilita o painel':'Revenda ainda não vinculada'}</h1>
    <p class="muted">${roleBlocked
      ? 'Você entrou como '+esc(email)+', mas seu papel atual não possui acesso operacional neste piloto.'
      : 'Você entrou como '+esc(email)+', mas esta conta ainda não possui uma operação ativa.'}</p>
    ${rt.notice?`<div class="notice success" style="margin-top:16px"><strong>Cadastro recebido.</strong><br>${esc(rt.notice)}</div>`:''}
    ${roleBlocked
      ? '<div class="notice" style="margin-top:16px"><strong>Acesso operacional limitado.</strong><br>Seu papel atual ainda não possui uma experiência habilitada nesta operação.</div>'
      : '<div class="card flat" style="margin-top:16px"><h3>Quer participar?</h3><p class="muted tiny">Envie ou atualize o cadastro da empresa. Um cadastro rejeitado pode ser corrigido e reenviado para nova análise.</p><button class="primary full" onclick="go(\'merchant-join\')">Cadastrar / atualizar empresa</button></div>'}
    <button class="ghost full" style="margin-top:12px" onclick="merchantLiveLogout()">Sair desta conta</button>
  </section>`);
}

function merchantLiveProduct(code){
  return (globalThis.merchantRuntime?.catalog||[]).find(x=>x.productCode===code)||null;
}
function merchantTimestampFresh(value,hours=24){
  const ts=Date.parse(value||'');
  return Number.isFinite(ts)&&Date.now()-ts<=hours*60*60*1000&&ts<=Date.now()+5*60*1000;
}
function merchantLiveFreshness(){
  const rt=globalThis.merchantRuntime||{};
  const offerable=(rt.catalog||[]).filter(item=>item.active&&Number(item.availableStock)>0);
  const staleProducts=offerable.filter(item=>!merchantTimestampFresh(item.priceConfirmedAt));
  const deliveryFresh=merchantTimestampFresh(rt.merchant?.deliveryFeeConfirmedAt);
  return {offerable,staleProducts,deliveryFresh,allFresh:deliveryFresh&&offerable.length>0&&!staleProducts.length};
}

function merchantDeliveryMemberLabel(userId){
  const id=String(userId||'');
  const member=(globalThis.merchantRuntime?.deliveryTeam||[]).find(x=>x.userId===id);
  if(member?.displayName)return member.displayName;
  const m=globalThis.merchantRuntime?.merchant;
  if(m?.memberRole==='driver'&&id&&m?.memberDisplayName)return m.memberDisplayName;
  return id?'Responsável atribuído':'Ainda não atribuído';
}

function merchantAlertControl(){
  const status=globalThis.merchantAlertStatus?.()||{enabled:false,notificationSupported:false,notificationPermission:'unsupported'};
  const permission=status.notificationPermission;
  const notificationCopy=!status.notificationSupported
    ? 'Notificação do sistema indisponível neste navegador; som e vibração ainda podem funcionar.'
    : permission==='granted'
      ? 'Som, vibração e notificação do sistema habilitados neste aparelho.'
      : permission==='denied'
        ? 'Som e vibração podem funcionar, mas o navegador bloqueou notificações do sistema.'
        : 'Ao ativar, o navegador pode pedir permissão para notificações.';
  return `<div class="card flat form-stack" style="margin-top:14px">
    <div class="status-bar"><div><strong>Alertas neste aparelho</strong><br><small>${esc(notificationCopy)}</small></div><span class="status-pill ${status.enabled?'online':'offline'}">${status.enabled?'ATIVOS':'DESLIGADOS'}</span></div>
    <div class="notice"><strong>Escopo atual.</strong><br>Os alertas funcionam enquanto este painel/PWA estiver aberto, inclusive em outra aba. Fechar totalmente o navegador interrompe o polling; push com o app fechado exige uma etapa posterior.</div>
    <button class="${status.enabled?'danger-btn':'primary'}" onclick="${status.enabled?'merchantDisableAlertsFromUi()':'merchantEnableAlertsFromUi()'}">${status.enabled?'Desativar alertas':'Ativar som, vibração e notificações'}</button>
  </div>`;
}

function merchantDriverLivePage(rt){
  const m=rt.merchant||{};
  const orders=rt.orders||[];
  const name=String(m.memberDisplayName||'').trim();
  return shell(`<section class="page">
    <div class="status-bar"><div><div class="tiny muted">MINHAS ENTREGAS</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name||'Revenda')}</h1></div><span class="status-pill online">MOTORISTA</span></div>
    <div class="notice success" style="margin-top:14px"><strong>Visão restrita por atribuição.</strong><br>Você vê somente pedidos que a operação vinculou à sua conta. Catálogo, preços, compliance e pedidos de outros responsáveis não aparecem aqui.</div>
    ${merchantAlertControl()}
    <div class="card flat form-stack" style="margin-top:14px">
      <h3>Seu nome operacional</h3>
      <div class="input-wrap"><label for="driver-display-name">Como aparecer para a equipe</label><input id="driver-display-name" class="input" maxlength="60" value="${esc(name)}" placeholder="Ex.: João"></div>
      <small class="field-help">Esse nome é usado dentro da operação. O cliente não recebe sua identidade por este painel.</small>
      <button class="secondary" onclick="merchantLiveSaveMemberProfile()">Salvar nome</button>
      <div class="order-actions"><button class="secondary small" onclick="merchantLiveRefresh()">Atualizar entregas</button><button class="ghost small" onclick="merchantLiveLogout()">Sair</button></div>
    </div>
    <section class="section"><div class="section-head"><div><h2>Pedidos atribuídos a você</h2><p>Saída, chegada e conclusão continuam protegidas pela versão do pedido e pelas autoridades do servidor.</p></div></div>${orders.length?orders.map(merchantLiveOrder).join(''):'<div class="empty card">Nenhuma entrega atribuída a você agora.</div>'}</section>
  </section>`);
}

function merchantTeamPage(){
  const rt=globalThis.merchantRuntime||{};
  const m=rt.merchant;
  if(rt.status!=='ready'||!m){
    return shell('<section class="page"><h1 class="page-title">Equipe da revenda</h1><div class="empty card">Conecte-se à operação para gerenciar a equipe.</div></section>');
  }
  if(!['owner','manager'].includes(String(m.memberRole||''))){
    return shell('<section class="page"><button class="back" onclick="go(\'merchant\')">← Operação</button><h1 class="page-title">Equipe da revenda</h1><div class="notice danger"><strong>Acesso restrito.</strong><br>Somente owner ou manager pode gerenciar membros.</div></section>');
  }
  if(rt.teamLoading&&!rt.team){
    return shell('<section class="page"><button class="back" onclick="go(\'merchant\')">← Operação</button><h1 class="page-title">Equipe da revenda</h1><div class="empty card">Carregando equipe…</div></section>');
  }
  const team=rt.team||{actorRole:m.memberRole,members:[],pendingInvites:[]};
  const members=Array.isArray(team.members)?team.members:[];
  const pending=Array.isArray(team.pendingInvites)?team.pendingInvites:[];
  const canInviteManager=String(team.actorRole||m.memberRole)==='owner';
  const roleLabel={owner:'Proprietário',manager:'Gerente',operator:'Operador',driver:'Motorista'};
  const memberRows=members.map(member=>{
    const role=String(member.memberRole||'');
    const active=member.active===true;
    const protectedMember=member.isSelf===true||role==='owner'||(role==='manager'&&!canInviteManager);
    const status=active?'ATIVO':'INATIVO';
    const statusClass=active?'online':'offline';
    return `<div class="card flat" style="margin-bottom:10px">
      <div class="status-bar"><div><strong>${esc(member.displayName||member.email||'Membro')}</strong><br><small>${esc(member.email||'')} • ${esc(roleLabel[role]||role)}</small></div><span class="status-pill ${statusClass}">${status}</span></div>
      ${active&&!protectedMember?`<button class="danger-btn small" style="margin-top:10px" onclick="merchantTeamRevokeMemberFromUi('${esc(member.userId)}')">Revogar acesso</button>`:''}
      ${!active?'<div class="tiny muted" style="margin-top:8px">Para reativar, envie um novo convite para o mesmo e-mail.</div>':''}
    </div>`;
  }).join('');
  const inviteRows=pending.map(invite=>`<div class="card flat" style="margin-bottom:10px">
    <div class="status-bar"><div><strong>${esc(invite.displayName||invite.email)}</strong><br><small>${esc(invite.email)} • ${esc(roleLabel[invite.memberRole]||invite.memberRole)}</small></div><span class="status-pill risk">PENDENTE</span></div>
    <div class="tiny muted" style="margin-top:8px">Válido até ${esc(formatDateTime(invite.expiresAt))}. O vínculo acontece quando esse e-mail entrar no portal da revenda.</div>
    <div class="order-actions"><button class="secondary small" data-invite-id="${esc(invite.inviteId)}" onclick="copyMerchantTeamInstructionsByInvite(this.dataset.inviteId)">Copiar instruções</button><button class="danger-btn small" onclick="merchantTeamRevokeInviteFromUi('${esc(invite.inviteId)}')">Cancelar convite</button></div>
  </div>`).join('');

  return shell(`<section class="page">
    <button class="back" onclick="go('merchant')">← Operação</button>
    <span class="eyebrow">ACESSO DA EQUIPE</span>
    <h1 class="page-title">Equipe da revenda</h1>
    <p class="muted page-lead">Convide pessoas pelo e-mail que elas usarão para entrar. A conta recebe somente o papel definido aqui.</p>
    ${rt.error?`<div class="notice danger">${esc(rt.error)}</div>`:''}
    <div class="card flat form-stack">
      <h3>Convidar membro</h3>
      <div class="input-wrap"><label for="team-email">E-mail</label><input id="team-email" class="input" type="email" autocomplete="email" maxlength="160" placeholder="pessoa@empresa.com"></div>
      <div class="field-row">
        <div class="input-wrap"><label for="team-role">Papel</label><select id="team-role" class="input">${canInviteManager?'<option value="manager">Gerente</option>':''}<option value="operator">Operador</option><option value="driver" selected>Motorista</option></select></div>
        <div class="input-wrap"><label for="team-display-name">Nome operacional</label><input id="team-display-name" class="input" maxlength="60" placeholder="Ex.: João"></div>
      </div>
      <div class="notice"><strong>Sem senha compartilhada.</strong><br>Se a conta já existir, o acesso entra imediatamente. Caso contrário, o convite fica pendente por 7 dias e é reivindicado automaticamente no primeiro login com o mesmo e-mail.</div>
      <button class="primary" onclick="merchantTeamInviteFromUi()" ${rt.actionPending?'disabled':''}>Convidar para a equipe</button>
    </div>
    <section class="section"><div class="section-head"><div><h2>Membros</h2><p>Owner não pode ser removido por esta tela. Manager só pode revogar operator ou driver.</p></div><button class="ghost small" onclick="merchantTeamReloadFromUi()">Atualizar</button></div>${memberRows||'<div class="empty card">Nenhum membro listado.</div>'}</section>
    <section class="section"><div class="section-head"><div><h2>Convites pendentes</h2><p>O convidado deve entrar no portal usando exatamente o e-mail abaixo.</p></div></div>${inviteRows||'<div class="empty card">Nenhum convite pendente.</div>'}</section>
  </section>`);
}

function merchantBillingLiveView(rt){
  const billing=rt.billing||null;
  if(!billing?.account)return '';
  const account=billing.account||{};
  const plan=billing.plan||{};
  const statements=billing.openStatements||[];
  const requests=billing.paymentRequests||[];
  const pending=requests.filter(r=>r.status==='pending');
  const pendingPackage=pending.find(r=>r.requestKind==='package_purchase')||null;
  const pendingByStatement=new Map(
    pending.filter(r=>r.requestKind==='statement_payment'&&r.statementId).map(r=>[r.statementId,r])
  );
  const held=account.salesHold===true;
  const role=String(rt.merchant?.memberRole||'');
  const canSeeFinance=['owner','manager'].includes(role);
  if(!canSeeFinance){
    return held
      ? '<div class="notice danger" style="margin-top:12px"><strong>Novas vendas suspensas por pendência financeira.</strong><br>O owner ou gerente precisa regularizar o fechamento vencido. Pedidos já aceitos continuam disponíveis normalmente.</div>'
      : '';
  }
  const feePct=(Number(plan.platformFeeBps||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const available=Number(account.creditAvailableCents||0);
  const nextDue=statements
    .filter(x=>['open','overdue'].includes(x.status))
    .sort((a,b)=>Date.parse(a.dueAt||'')-Date.parse(b.dueAt||''))[0]||null;
  const openDue=statements.reduce((sum,x)=>sum+Number(x.amountDueCents||0),0);
  const planCards=(billing.plans||[]).map(p=>{
    const pct=(Number(p.platformFeeBps||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const current=p.planKey===plan.planKey;
    const prepaid=p.billingMode==='prepaid_credit';
    const pendingThis=pendingPackage?.planKey===p.planKey;
    const action=prepaid
      ? pendingThis
        ? `<div class="notice risk" style="margin-top:8px"><strong>Aguardando confirmação.</strong><br>O admin precisa conferir o pagamento antes de liberar o crédito.</div><button class="ghost small" style="margin-top:8px" onclick="merchantCancelBillingRequestFromUi('${esc(pendingPackage.id)}')" ${rt.actionPending?'disabled':''}>Cancelar solicitação</button>`
        : `<button class="secondary small" style="margin-top:8px" onclick="merchantRequestBillingPackageFromUi('${esc(p.planKey)}')" ${pendingPackage||rt.actionPending?'disabled':''}>${pendingPackage?'Outro pacote já está pendente':'Informar pagamento e solicitar ativação'}</button>`
      : '';
    return `<div class="card flat"><div class="order-head"><div><strong>${esc(p.displayName)}</strong><br><small>${prepaid?'Pacote pré-pago':'Pós-pago diário'}</small></div><span class="status-pill ${current?'online':''}">${pct}%</span></div>${prepaid?`<div class="tiny muted">${BRL.format(Number(p.purchaseAmountCents||0)/100)} de crédito de taxas • ativação somente após conferência administrativa.</div>`:'<div class="tiny muted">Sem recarga antecipada. Fechamento diário com vencimento D+1.</div>'}${current?'<div class="notice success" style="margin-top:8px"><strong>Plano atual</strong></div>':''}${action}</div>`;
  }).join('');
  const statementRows=statements.map(s=>{
    const request=pendingByStatement.get(s.id);
    const paymentAction=request
      ? `<div class="tiny muted" style="margin-top:6px"><strong>Pagamento informado.</strong> Aguardando conferência do admin.</div><button class="ghost small" style="margin-top:6px" onclick="merchantCancelBillingRequestFromUi('${esc(request.id)}')" ${rt.actionPending?'disabled':''}>Cancelar aviso</button>`
      : `<button class="secondary small" style="margin-top:6px" onclick="merchantNotifyStatementPaidFromUi('${esc(s.id)}')" ${rt.actionPending?'disabled':''}>Informar pagamento</button>`;
    return `<div class="list-row"><div><strong>${esc(String(s.businessDate||'Fechamento'))}</strong><br><small>${s.status==='overdue'?'VENCIDO':'vence '+esc(s.dueAt?new Date(s.dueAt).toLocaleString('pt-BR'):'—')}</small>${paymentAction}</div><div style="text-align:right"><strong>${BRL.format(Number(s.amountDueCents||0)/100)}</strong><br><small>taxa bruta ${BRL.format(Number(s.grossFeeCents||0)/100)} • crédito ${BRL.format(Number(s.prepaidCreditAppliedCents||0)/100)}</small></div></div>`;
  }).join('');
  const recentRequests=requests.slice(0,8).map(r=>{
    const label=r.requestKind==='package_purchase'
      ? 'Pacote '+((billing.plans||[]).find(p=>p.planKey===r.planKey)?.displayName||r.planKey||'')
      : 'Pagamento do fechamento';
    const status=({pending:'PENDENTE',approved:'APROVADO',rejected:'REJEITADO',cancelled:'CANCELADO'})[r.status]||String(r.status||'').toUpperCase();
    return `<div class="list-row"><div><strong>${esc(label)}</strong><br><small>${esc(r.requestedAt?new Date(r.requestedAt).toLocaleString('pt-BR'):'—')} • ${esc(r.merchantReference||'sem referência')}</small></div><div style="text-align:right"><span class="status-pill ${r.status==='approved'?'online':r.status==='rejected'?'offline':r.status==='pending'?'risk':''}">${esc(status)}</span><br><small>${BRL.format(Number(r.expectedAmountCents||0)/100)}</small></div></div>`;
  }).join('');
  return `<section class="section">
    <div class="section-head"><div><span class="section-kicker">FINANCEIRO TAMÃO</span><h2>Taxas e fechamento diário</h2><p>Cada venda conserva sua taxa individual. O TAMÃO fecha o dia às 00:05 e eventual saldo pós-pago vence até o fim do dia seguinte.</p></div><span class="status-pill ${held?'offline':'online'}">${held?'VENDAS SUSPENSAS':'EM DIA'}</span></div>
    ${held?'<div class="notice danger"><strong>Há fechamento vencido.</strong><br>Novas vendas ficam pausadas até a regularização. Pedidos já aceitos continuam normalmente; seu acesso ao painel e ao histórico permanece disponível.</div>':''}
    <div class="merchant-kpis">
      <div class="kpi"><span class="label">Plano</span><strong>${esc(plan.displayName||'Flex Diário')}</strong><small>${feePct}% por venda</small></div>
      <div class="kpi"><span class="label">Crédito pré-pago</span><strong>${BRL.format(Number(account.creditBalanceCents||0)/100)}</strong></div>
      <div class="kpi"><span class="label">Reservado</span><strong>${BRL.format(Number(account.creditReservedCents||0)/100)}</strong><small>pedidos ainda não liquidados</small></div>
      <div class="kpi"><span class="label">Disponível</span><strong>${BRL.format(available/100)}</strong></div>
      <div class="kpi"><span class="label">Saldo D+1 aberto</span><strong>${BRL.format(openDue/100)}</strong><small>${nextDue?'próximo vencimento '+new Date(nextDue.dueAt).toLocaleString('pt-BR'):'nenhum vencimento'}</small></div>
    </div>
    ${statementRows?`<div class="card flat" style="margin-top:12px"><h3>Fechamentos em aberto</h3><div class="list">${statementRows}</div></div>`:''}
    <div class="section-head" style="margin-top:16px"><div><h3>Opções de taxa</h3><p>Quanto maior o crédito antecipado, menor a taxa por venda. O crédito só é consumido quando pedidos são liquidados.</p></div></div>
    <div class="admin-entity-grid">${planCards}</div>
    <div class="notice" style="margin-top:12px"><strong>Confirmação financeira em duas etapas.</strong><br>A revenda informa a referência do pagamento; o pedido fica pendente. Só o admin pode confirmar e gerar crédito ou quitar o fechamento diário.</div>
    ${recentRequests?`<details class="card flat" style="margin-top:12px"><summary><strong>Solicitações financeiras recentes</strong></summary><div class="list" style="margin-top:10px">${recentRequests}</div></details>`:''}
  </section>`;
}

async function merchantRequestBillingPackageFromUi(planKey){
  const billing=globalThis.merchantRuntime?.billing||{};
  const plan=(billing.plans||[]).find(p=>p.planKey===planKey);
  if(!plan)return toast('Pacote não encontrado');
  const reference=prompt('Referência do pagamento do pacote (Pix/PSP/comprovante):')||'';
  if(reference.trim().length<3)return toast('Informe a referência do pagamento');
  if(!confirm('Enviar para conferência o '+plan.displayName+' no valor de '+BRL.format(Number(plan.purchaseAmountCents||0)/100)+'? O crédito só entra após aprovação do admin.'))return;
  try{
    await merchantRequestBillingPackageLive(planKey,reference);
    toast('Solicitação enviada para conferência');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantNotifyStatementPaidFromUi(statementId){
  const billing=globalThis.merchantRuntime?.billing||{};
  const statement=(billing.openStatements||[]).find(s=>s.id===statementId);
  if(!statement)return toast('Fechamento não encontrado');
  const reference=prompt('Referência do pagamento (Pix/PSP/comprovante):')||'';
  if(reference.trim().length<3)return toast('Informe a referência do pagamento');
  if(!confirm('Informar pagamento de '+BRL.format(Number(statement.amountDueCents||0)/100)+'? O fechamento só será quitado depois da conferência do admin.'))return;
  try{
    await merchantNotifyBillingPaymentLive(statementId,reference);
    toast('Pagamento informado; aguardando conferência');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantCancelBillingRequestFromUi(paymentRequestId){
  if(!confirm('Cancelar esta solicitação financeira pendente?'))return;
  try{
    await merchantCancelBillingRequestLive(paymentRequestId);
    toast('Solicitação cancelada');
  }catch(e){toast(String(e?.message||e))}
}

function merchantLivePage(){
  const rt=globalThis.merchantRuntime||{};
  if(['disabled','loading'].includes(rt.status)){
    return shell('<section class="page"><h1 class="page-title">Painel da revenda</h1><div class="empty card">Conectando à operação real…</div></section>');
  }
  if(rt.status==='unsafe-origin'){
    return shell('<section class="page"><span class="eyebrow">PAINEL REAL BLOQUEADO</span><h1 class="page-title">Origem da revenda não isolada</h1><div class="notice danger"><strong>Não autenticamos operações da revenda em uma origem compartilhada.</strong><br>Use localhost para desenvolvimento ou uma origem dedicada configurada para o painel da revenda.</div></section>');
  }
  if(rt.status==='unauthenticated')return merchantLiveLoginView();
  if(rt.status==='no-access')return merchantLiveNoAccess();
  if(rt.status!=='ready'||!rt.merchant){
    return shell(`<section class="page"><h1 class="page-title">Painel da revenda</h1><div class="notice danger"><strong>Não foi possível carregar a operação.</strong><br>${esc(rt.error||'Tente novamente.')}</div><button class="secondary full" style="margin-top:12px" onclick="merchantLiveRefresh()">Tentar novamente</button></section>`);
  }

  const m=rt.merchant;
  if(m.memberRole==='driver')return merchantDriverLivePage(rt);
  const performance=m.performance||{};
  const capacity=Math.max(1,Number(m.maxActiveOrders||8));
  const acceptsScheduledOrders=m.acceptsScheduledOrders===true;
  const paymentMethods={
    pix:m.paymentMethods?.pix===true,
    card:m.paymentMethods?.card===true,
    cash:m.paymentMethods?.cash===true
  };
  const heartbeatFresh=merchantTimestampFresh(m.lastSeenAt,10/60);
  const connectionHealthy=!m.online||heartbeatFresh;
  const manage=['owner','manager'].includes(m.memberRole);
  const operate=['owner','manager','operator'].includes(m.memberRole);
  const p13=merchantLiveProduct('P13');
  const memberships=rt.memberships||[];
  const deliveryTeam=rt.deliveryTeam||[];
  const orders=rt.orders||[];
  const billing=rt.billing||null;
  const financialHold=billing?.account?.salesHold===true;
  const freshness=merchantLiveFreshness();
  const freshnessProblems=[];
  if(!freshness.deliveryFresh)freshnessProblems.push('taxa de entrega vencida');
  if(m.acceptsCitywide===false)freshnessProblems.push('atendimento em São Gabriel desativado');
  if(freshness.staleProducts.length)freshnessProblems.push('preço vencido: '+freshness.staleProducts.map(x=>x.productName||x.productCode).join(', '));
  if(!freshness.offerable.length)freshnessProblems.push('nenhum produto ativo com estoque');
  if(!Object.values(paymentMethods).some(Boolean))freshnessProblems.push('nenhuma forma de pagamento confirmada');
  const commercialReady=freshness.allFresh&&m.acceptsCitywide!==false&&Object.values(paymentMethods).some(Boolean);
  const freshnessNotice=!commercialReady
    ? '<div class="notice danger" style="margin-top:12px"><strong>Confirmação comercial incompleta.</strong><br>'+esc(freshnessProblems.join(' • '))+'. A revenda só participa das ofertas com área atendida, taxa e SKUs ofertáveis confirmados.</div>'
    : '';

  const compliance=m.compliance||{};
  const hasGlp=(rt.catalog||[]).some(item=>item.active&&/^P([1-9][0-9]?)$/.test(String(item.productCode||''))&&Number(String(item.productCode).slice(1))<=90);
  const cnpjCurrent=compliance.cnpjCurrent===true;
  const anpCurrent=compliance.anpCurrent===true;
  const complianceReady=cnpjCurrent&&anpCurrent;
  const cnpjWhen=compliance.cnpjVerifiedAt?formatDateTime(compliance.cnpjVerifiedAt):'nunca';
  const anpWhen=compliance.anpVerifiedAt?formatDateTime(compliance.anpVerifiedAt):(hasGlp?'nunca':'não exigida para o catálogo atual');
  const complianceNotice=complianceReady
    ? `<div class="notice success" style="margin-top:12px"><strong>Compliance vigente.</strong><br>CNPJ: ${esc(cnpjWhen)} • janela operacional ${Number(compliance.cnpjMaxAgeDays||30)} dias. ${hasGlp?`ANP: ${esc(anpWhen)} • janela operacional ${Number(compliance.anpMaxAgeDays||7)} dias.`:'Sem GLP ativo no catálogo; ANP não é exigida para a operação atual.'}</div>`
    : `<div class="notice danger" style="margin-top:12px"><strong>Revalidação necessária antes de operar.</strong><br>${!cnpjCurrent?`CNPJ: última verificação ${esc(cnpjWhen)}; revalidar a cada ${Number(compliance.cnpjMaxAgeDays||30)} dias. `:''}${!anpCurrent?`ANP: última verificação ${esc(anpWhen)}; revalidar a cada ${Number(compliance.anpMaxAgeDays||7)} dias para GLP.`:''}</div>`;
  const canGoOnline=m.status==='active'&&complianceReady&&commercialReady&&!financialHold;
  const connectionNotice=!connectionHealthy
    ? '<div class="notice danger" style="margin-top:12px"><strong>Conexão da operação sem confirmação recente.</strong><br>Enquanto a presença da revenda não for renovada, novos pedidos podem deixar de ser enviados para esta operação.</div>'
    : rt.heartbeatError
      ? '<div class="notice" style="margin-top:12px"><strong>Reconectando presença da revenda.</strong><br>'+esc(rt.heartbeatError)+'</div>'
      : '';

  return shell(`<section class="page">
    <div class="status-bar"><div><div class="tiny muted">PAINEL REAL • ${esc(String(m.memberRole||'').toUpperCase())}</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name)}</h1></div><span class="status-pill ${m.online?(heartbeatFresh?'online':'risk'):'offline'}">${m.online?(heartbeatFresh?'● ONLINE':'● SEM CONEXÃO'):'OFFLINE'}</span></div>

    ${rt.error?`<div class="notice danger" style="margin-top:12px">${esc(rt.error)}</div>`:''}
    ${connectionNotice}
    ${complianceNotice}
    ${freshnessNotice}
    ${financialHold?'<div class="notice danger" style="margin-top:12px"><strong>Novas vendas suspensas por pendência financeira.</strong><br>Regularize o fechamento vencido. Pedidos já aceitos continuam disponíveis normalmente.</div>':''}
    ${merchantAlertControl()}

    <div class="card flat form-stack" style="margin-top:14px">
      ${memberships.length>1?`<div class="input-wrap"><label for="merchant-live-select">Operação</label><select id="merchant-live-select" class="input" onchange="merchantLiveSelect(this.value)">${memberships.map(x=>`<option value="${esc(x.merchantId)}" ${x.merchantId===m.merchantId?'selected':''}>${esc(x.name)} • ${esc(x.memberRole)}</option>`).join('')}</select></div>`:''}
      <div class="order-actions"><button class="secondary small" onclick="merchantLiveRefresh()">Atualizar</button>${manage?'<button class="secondary small" onclick="merchantOpenTeam()">Equipe</button>':''}${operate?`<button class="${m.online?'danger-btn':'primary'} small" onclick="merchantLiveToggleOnline(${m.online?'false':'true'})" ${!m.online&&!canGoOnline?'disabled title="'+(financialHold?'Regularize o fechamento financeiro vencido antes de ficar online':'Regularize compliance, preços e logística antes de ficar online')+'"':''}>${m.online?'Pausar novos pedidos':'Ficar online'}</button>`:''}<button class="ghost small" onclick="merchantLiveLogout()">Sair</button></div>
    </div>

    <section class="section"><div class="merchant-kpis">
      <div class="kpi"><span class="label">${p13?.pricingMode==='range'?'Preço normal P13':'Preço P13'}</span><strong>${p13?BRL.format(Number(p13.priceCents||0)/100):'—'}</strong>${p13?.pricingMode==='range'?'<small>'+BRL.format(Number(p13.minPriceCents||0)/100)+'–'+BRL.format(Number(p13.maxPriceCents||0)/100)+'</small>':''}</div>
      <div class="kpi"><span class="label">Estoque P13</span><strong>${p13?Number(p13.availableStock||0):'—'}</strong></div>
      <div class="kpi"><span class="label">Trust</span><strong>${Number(m.trustScore||0)}/100</strong></div>
      <div class="kpi"><span class="label">Pedidos ativos</span><strong>${orders.length}/${capacity}</strong><small>capacidade simultânea</small></div>
      <div class="kpi"><span class="label">Concluídos 90d</span><strong>${Number(performance.completedOrders||0)}</strong></div>
      <div class="kpi"><span class="label">Conclusão pós-aceite</span><strong>${performance.completionRate==null?'—':Math.round(Number(performance.completionRate)*100)+'%'}</strong></div>
      <div class="kpi"><span class="label">No prazo</span><strong>${performance.onTimeRate==null?'—':Math.round(Number(performance.onTimeRate)*100)+'%'}</strong></div>
    </div></section>

    ${merchantBillingLiveView(rt)}

    ${manage?`<div class="card flat form-stack">
      <h3>Preço e estoque P13</h3>
      ${p13?.pricingMode==='range'?'<div class="notice"><strong>Faixa automática ativa.</strong><br>Autorizada de '+BRL.format(Number(p13.minPriceCents||0)/100)+' a '+BRL.format(Number(p13.maxPriceCents||0)/100)+'. Este atalho altera o preço normal e o estoque; edite limites e estratégia no catálogo.</div>':''}
      <div class="field-row"><div class="input-wrap"><label for="live-p13-price">${p13?.pricingMode==='range'?'Preço normal':'Preço'}</label><input id="live-p13-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" value="${p13?(Number(p13.priceCents||0)/100).toFixed(2):''}"></div><div class="input-wrap"><label for="live-p13-stock">Estoque disponível</label><input id="live-p13-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="${p13?Number(p13.availableStock||0):0}"></div></div>
      <button class="secondary" onclick="merchantLiveSaveP13()">Confirmar preço e estoque P13</button><button class="ghost" onclick="go('catalog')">Editar todos os produtos</button>
      <div class="divider"></div>
      <h3>Entrega</h3>
      <div class="field-row"><div class="input-wrap"><label for="live-delivery-fee">Taxa de entrega</label><input id="live-delivery-fee" inputmode="decimal" type="number" min="0" max="1000" step="0.10" class="input" value="${(Number(m.deliveryFeeCents||0)/100).toFixed(2)}"></div><div class="input-wrap"><label for="live-eta">ETA base (min)</label><input id="live-eta" inputmode="numeric" type="number" min="5" max="180" class="input" value="${Number(m.baseEtaMinutes||30)}"></div></div>
      <label class="check-row"><input id="live-citywide" type="checkbox" ${m.acceptsCitywide!==false?'checked':''}><span><strong>Atende São Gabriel</strong><small>Usado no filtro de ofertas do piloto.</small></span></label>
      <button class="secondary" onclick="merchantLiveSaveLogistics()">Salvar logística</button>
      <div class="divider"></div>
      <h3>Capacidade simultânea</h3>
      <div class="input-wrap"><label for="live-capacity">Máximo de pedidos ativos ao mesmo tempo</label><input id="live-capacity" inputmode="numeric" type="number" min="1" max="100" class="input" value="${capacity}"><small class="field-help">Ao atingir este limite, a revenda deixa de receber novas ofertas até liberar capacidade. Pedidos existentes não são cancelados.</small></div>
      <button class="secondary" onclick="merchantLiveSaveCapacity()">Salvar capacidade</button>
      <div class="divider"></div>
      <h3>Formas de pagamento</h3>
      <p class="muted tiny">O TAMÃO só mostra sua revenda ao cliente quando a forma escolhida estiver ativa aqui.</p>
      <label class="check-row"><input id="live-payment-pix" type="checkbox" ${paymentMethods.pix?'checked':''}><span><strong>Pix</strong><small>Pagamento via Pix aceito pela operação.</small></span></label>
      <label class="check-row"><input id="live-payment-card" type="checkbox" ${paymentMethods.card?'checked':''}><span><strong>Cartão</strong><small>Cartão aceito na entrega conforme sua operação.</small></span></label>
      <label class="check-row"><input id="live-payment-cash" type="checkbox" ${paymentMethods.cash?'checked':''}><span><strong>Dinheiro</strong><small>Dinheiro aceito; o pedido pode informar troco.</small></span></label>
      <button class="secondary" onclick="merchantLiveSavePaymentMethods()">Salvar formas de pagamento</button>
      <div class="divider"></div>
      <h3>Pedidos agendados</h3>
      <label class="check-row"><input id="live-scheduled-orders" type="checkbox" ${acceptsScheduledOrders?'checked':''}><span><strong>Aceitar entregas agendadas</strong><small>Quando ativo, clientes podem escolher janelas futuras de até 72 horas. O horário aparece antes do aceite.</small></span></label>
      <button class="secondary" onclick="merchantLiveSaveScheduling()">Salvar agendamento</button>
    </div>`:''}

    <section class="section"><div class="section-head"><div><h2>Pedidos que exigem ação</h2><p>Dados vêm do backend real. Status só muda depois de confirmação server-side.</p></div></div>${orders.length?orders.map(merchantLiveOrder).join(''):'<div class="empty card">Nenhum pedido ativo para esta revenda.</div>'}</section>
  </section>`);
}

function merchantScheduledDispatchState(o){
  if(!o?.deliveryWindowStart)return {scheduled:false,ready:true,opensAt:null};
  const start=Date.parse(o.deliveryWindowStart);
  const eta=Math.max(5,Math.min(180,Number(merchantRuntime.merchant?.baseEtaMinutes||30)));
  const opensAt=start-(eta+30)*60000;
  return {
    scheduled:true,
    ready:Date.now()>=opensAt,
    opensAt:Number.isFinite(opensAt)?new Date(opensAt).toISOString():null
  };
}

function merchantFormatPhone(value){
  const d=String(value||'').replace(/\D/g,'').slice(0,11);
  if(d.length===10)return '('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6);
  if(d.length===11)return '('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7);
  return d;
}

function merchantLiveOrder(o){
  const items=(o.items||[]).map(i=>`${Number(i.quantity)}× ${esc(i.productName||i.productCode||'Item')}`).join(' • ');
  const total=BRL.format(Number(o.totalCents||0)/100);
  const copy=statusCopy[o.status]||[o.status,''];
  const address=o.addressVisible&&o.address?'📍 '+esc(o.address):'📍 Endereço protegido até o aceite';
  const currentRole=String(globalThis.merchantRuntime?.merchant?.memberRole||'');
  const canAssignDelivery=['owner','manager'].includes(currentRole);
  const deliveryTeam=globalThis.merchantRuntime?.deliveryTeam||[];
  const assignedLabel=o.assignedDeliveryUserId
    ? merchantDeliveryMemberLabel(o.assignedDeliveryUserId)
    : '';
  const assignmentControl=canAssignDelivery&&['PREPARING','AT_RISK'].includes(o.status)&&deliveryTeam.length
    ? `<div class="form-stack" style="margin-top:10px"><div class="input-wrap"><label for="delivery-${o.orderId}">Responsável pela entrega</label><select id="delivery-${o.orderId}" class="input"><option value="">Escolher responsável</option>${deliveryTeam.map(member=>`<option value="${esc(member.userId)}" ${member.userId===o.assignedDeliveryUserId?'selected':''}>${esc(member.displayName)} • ${esc(member.memberRole)}</option>`).join('')}</select></div><button class="secondary small" onclick="merchantLiveAssignDelivery('${o.orderId}')">${o.assignedDeliveryUserId?'Alterar responsável':'Atribuir entrega'}</button></div>`
    : '';
  const deliveryContact=o.deliveryDetailsVisible
    ? `<div class="notice" style="margin-top:10px"><strong>Dados para entrega</strong>${o.postalCode?`<br>CEP: ${esc(String(o.postalCode).replace(/^(\d{5})(\d{3})$/,'$1-$2'))}`:''}<br>${o.customerPhone?`Telefone: <a href="tel:${esc(String(o.customerPhone))}">${esc(merchantFormatPhone(o.customerPhone))}</a>`:'Telefone não informado'}${o.addressComplement?`<br>Complemento: ${esc(o.addressComplement)}`:''}${o.deliveryReference?`<br>Referência: ${esc(o.deliveryReference)}`:''}${o.deliveryNotes?`<br>Instruções: ${esc(o.deliveryNotes)}`:''}</div>`
    : '';
  let actions='';

  if(o.status==='OFFERED_TO_MERCHANT'){
    const secs=o.offerExpiresAt?Math.max(0,Math.ceil((Date.parse(o.offerExpiresAt)-Date.now())/1000)):0;
    actions=`<button class="primary small" onclick="merchantLiveAction('${o.orderId}','accept')">Aceitar pedido</button><button class="danger-btn small" onclick="merchantLiveAction('${o.orderId}','reject')">Não consigo atender</button><span class="tiny muted">Prazo ~${secs}s</span>`;
  }else if(['PREPARING','AT_RISK','MERCHANT_ACCEPTED'].includes(o.status)){
    const scheduleState=merchantScheduledDispatchState(o);
    const dispatchButton=scheduleState.scheduled&&!scheduleState.ready
      ? `<button class="primary small" disabled>Saída ainda bloqueada</button><span class="tiny muted">Liberada por volta de ${scheduleState.opensAt?esc(new Date(scheduleState.opensAt).toLocaleString('pt-BR')):'mais perto da janela'}</span>`
      : `<button class="primary small" onclick="merchantLiveAction('${o.orderId}','dispatch')">Confirmar saída</button>`;
    actions=`${dispatchButton}<select id="reason-${o.orderId}" class="input" style="max-width:220px;height:40px"><option value="stock_issue">Problema de estoque</option><option value="vehicle_issue">Problema no veículo</option><option value="staffing_issue">Equipe indisponível</option><option value="other_operational">Outro problema operacional</option></select><button class="danger-btn small" onclick="merchantLiveCannotFulfill('${o.orderId}')">Não consigo concluir</button>`;
  }else if(o.status==='OUT_FOR_DELIVERY'){
    actions=`<button class="secondary small" onclick="merchantLiveAction('${o.orderId}','arriving')">Estou chegando</button>`;
  }else if(o.status==='ARRIVING'){
    actions=`<label class="sr-only" for="live-pin-${o.orderId}">PIN de entrega</label><input id="live-pin-${o.orderId}" inputmode="numeric" maxlength="4" class="input pin-input" placeholder="PIN"><label class="check-row"><input id="live-paid-${o.orderId}" type="checkbox"><span><strong>Pagamento recebido</strong><small>Obrigatório para liquidar o pedido.</small></span></label><button class="primary small" onclick="merchantLiveDeliver('${o.orderId}')">Confirmar entrega</button>`;
  }

  return `<article class="order-card ${o.status==='OFFERED_TO_MERCHANT'?'new':''}">
    <div class="order-head"><div><div class="order-id">${esc(o.publicCode||o.orderId)}</div><div class="order-line">${items||'Itens do pedido'}</div></div><div style="text-align:right"><strong>${total}</strong><div class="tiny muted">${esc(copy[0])}</div></div></div>
    <div class="order-line">${address}</div><div class="order-line">Pagamento: ${esc(paymentLabel(o.paymentMethod))}</div>${o.paymentMethod==='cash'&&o.cashTenderCents?`<div class="order-line"><strong>Troco para: ${BRL.format(Number(o.cashTenderCents)/100)}</strong></div>`:''}${o.deliveryWindowStart?`<div class="notice success" style="margin-top:10px"><strong>Entrega agendada</strong><br>${esc(formatDeliveryWindow(o.deliveryWindowStart,o.deliveryWindowEnd))}</div>`:''}
    ${deliveryContact}
    ${assignedLabel?`<div class="notice success" style="margin-top:10px"><strong>Responsável pela entrega:</strong> ${esc(assignedLabel)}</div>`:''}
    ${assignmentControl}
    ${o.riskReason?`<div class="notice danger" style="margin-top:10px">${esc(o.riskReason)}</div>`:''}
    <div class="order-actions">${actions}</div>
  </article>`;
}

async function merchantEnableAlertsFromUi(){
  try{
    const status=await merchantEnableAlertsLive();
    toast(status?.notificationPermission==='denied'
      ?'Alertas sonoros ativados; notificações do navegador estão bloqueadas'
      :'Alertas de novos pedidos ativados');
  }catch(e){toast(String(e?.message||e))}
}
function merchantDisableAlertsFromUi(){
  try{
    merchantDisableAlertsLive();
    toast('Alertas desativados neste aparelho');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantTeamReloadFromUi(){
  try{await merchantTeamLoadLive();toast('Equipe atualizada')}catch(e){toast(String(e?.message||e))}
}
async function merchantTeamInviteFromUi(){
  const email=String(document.getElementById('team-email')?.value||'').trim();
  const role=String(document.getElementById('team-role')?.value||'driver');
  const displayName=String(document.getElementById('team-display-name')?.value||'').trim();
  try{
    const result=await merchantTeamInviteLive(email,role,displayName);
    toast(result?.status==='linked'?'Conta vinculada à equipe':'Convite pendente criado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantTeamRevokeMemberFromUi(userId){
  try{
    await merchantTeamRevokeMemberLive(userId);
    toast('Acesso do membro revogado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantTeamRevokeInviteFromUi(inviteId){
  try{
    await merchantTeamRevokeInviteLive(inviteId);
    toast('Convite cancelado');
  }catch(e){toast(String(e?.message||e))}
}
async function copyMerchantTeamInstructionsByInvite(inviteId){
  const id=String(inviteId||'');
  const invite=(globalThis.merchantRuntime?.team?.pendingInvites||[]).find(x=>String(x.inviteId||'')===id);
  if(!invite)return toast('Convite não encontrado');
  return copyMerchantTeamInstructions(invite.email);
}
async function copyMerchantTeamInstructions(email){
  const url=location.origin+location.pathname+'?merchant=1#merchant';
  const message='Você foi convidado para a equipe no TAMÃO. Acesse '+url+' e entre usando exatamente este e-mail: '+String(email||'');
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(message);
      toast('Instruções copiadas');
      return;
    }
  }catch{}
  toast('Não foi possível copiar automaticamente');
}

async function merchantLoginFromUi(){
  const email=document.querySelector('#merchant-email')?.value.trim()||'';
  try{await merchantSendLogin(email);toast('Link de acesso enviado')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveRefresh(){
  try{await merchantRefresh();toast('Operação atualizada')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveAssignDelivery(id){
  const deliveryUserId=String(document.getElementById('delivery-'+id)?.value||'');
  if(!deliveryUserId)return toast('Escolha um responsável pela entrega');
  try{
    await merchantAssignDeliveryLive(id,deliveryUserId);
    toast('Responsável pela entrega atualizado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSaveMemberProfile(){
  const name=String(document.getElementById('driver-display-name')?.value||'').trim();
  try{
    await merchantUpdateMemberProfileLive(name);
    toast('Nome operacional atualizado');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSelect(id){
  try{await merchantSelectLive(id)}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveToggleOnline(online){
  try{await merchantSetOnlineLive(online);toast(online?'Revenda online':'Novos pedidos pausados')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSaveProduct(code){
  const price=Number(document.getElementById('live-price-'+code)?.value);
  const stock=Number(document.getElementById('live-stock-'+code)?.value);
  const active=document.getElementById('live-active-'+code)?.checked===true;
  const pricingMode=String(document.getElementById('live-pricing-mode-'+code)?.value||'fixed');
  const pricingStrategy=String(document.getElementById('live-pricing-strategy-'+code)?.value||'balanced');
  const minPrice=Number(document.getElementById('live-min-price-'+code)?.value);
  const maxPrice=Number(document.getElementById('live-max-price-'+code)?.value);
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0)return toast('Revise preço e estoque de '+code);
  if(pricingMode==='range'){
    if(!Number.isFinite(minPrice)||!Number.isFinite(maxPrice)||minPrice<=0||maxPrice>10000||minPrice>price||price>maxPrice){
      return toast('Na faixa automática: mínimo ≤ preço normal ≤ máximo.');
    }
  }
  try{
    await merchantUpdateProductLive(code,Math.round(price*100),stock,active,{
      pricingMode,
      minPriceCents:pricingMode==='range'?Math.round(minPrice*100):Math.round(price*100),
      maxPriceCents:pricingMode==='range'?Math.round(maxPrice*100):Math.round(price*100),
      pricingStrategy
    });
    toast(pricingMode==='range'?'Faixa de preço de '+code+' confirmada':'Preço fixo de '+code+' confirmado');
  }catch(e){toast(String(e?.message||e))}
}

function merchantPricingModeChanged(code){
  const mode=String(document.getElementById('live-pricing-mode-'+code)?.value||'fixed');
  const range=mode==='range';
  for(const id of ['live-min-price-'+code,'live-max-price-'+code,'live-pricing-strategy-'+code]){
    const el=document.getElementById(id);
    if(el)el.disabled=!range;
  }
}

async function merchantLiveSaveP13(){
  const price=Number(document.querySelector('#live-p13-price')?.value);
  const stock=Number(document.querySelector('#live-p13-stock')?.value);
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0)return toast('Revise preço e estoque');
  try{await merchantUpdateProductLive('P13',Math.round(price*100),stock,true);toast('Preço e estoque confirmados')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSaveLogistics(){
  const fee=Number(document.querySelector('#live-delivery-fee')?.value);
  const eta=Number(document.querySelector('#live-eta')?.value);
  const citywide=document.querySelector('#live-citywide')?.checked===true;
  if(!Number.isFinite(fee)||fee<0||!Number.isInteger(eta)||eta<5||eta>180)return toast('Revise taxa e ETA');
  try{await merchantUpdateLogisticsLive(Math.round(fee*100),eta,citywide);toast(citywide?'Logística atualizada':'Logística atualizada. Novos pedidos foram pausados até reativar São Gabriel.')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveSaveCapacity(){
  const capacity=Number(document.querySelector('#live-capacity')?.value);
  if(!Number.isInteger(capacity)||capacity<1||capacity>100)return toast('Informe uma capacidade entre 1 e 100 pedidos');
  try{
    await merchantUpdateCapacityLive(capacity);
    toast('Capacidade operacional atualizada');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveSavePaymentMethods(){
  const methods={
    pix:document.querySelector('#live-payment-pix')?.checked===true,
    card:document.querySelector('#live-payment-card')?.checked===true,
    cash:document.querySelector('#live-payment-cash')?.checked===true
  };
  if(!Object.values(methods).some(Boolean))return toast('Ative pelo menos uma forma de pagamento');
  try{
    await merchantUpdatePaymentMethodsLive(methods);
    toast('Formas de pagamento atualizadas');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveSaveScheduling(){
  const accepts=document.querySelector('#live-scheduled-orders')?.checked===true;
  try{
    await merchantUpdateSchedulingLive(accepts);
    toast(accepts?'Pedidos agendados ativados':'Pedidos agendados pausados');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveAction(id,action){
  try{
    const result=await merchantPerformAction(id,action);
    if(action==='accept'&&result?.autoRescued){
      const messages={
        stock_changed_before_accept:'O estoque mudou; o pedido foi redirecionado automaticamente.',
        delivery_capability_changed_before_accept:'A capacidade logística mudou; o pedido foi redirecionado automaticamente.',
        merchant_unavailable_before_accept:'A operação ficou indisponível; o pedido foi redirecionado automaticamente.',
        offer_expired:'O prazo expirou; o sistema já buscou outra opção.'
      };
      toast(messages[result.rescueReason]||'O aceite não pôde ser concluído; o pedido foi redirecionado automaticamente.');
      return;
    }
    toast(action==='accept'?'Pedido aceito':action==='reject'?'Pedido devolvido ao matching':action==='dispatch'?'Saída confirmada':'Chegada confirmada');
  }catch(e){toast(String(e?.message||e))}
}
async function merchantLiveCannotFulfill(id){
  const reason=document.getElementById('reason-'+id)?.value||'other_operational';
  try{await merchantPerformAction(id,'cannot-fulfill',reason);toast('Pedido devolvido ao matching com estoque recomposto')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveDeliver(id){
  const pin=document.getElementById('live-pin-'+id)?.value.trim()||'';
  const paid=document.getElementById('live-paid-'+id)?.checked===true;
  try{await merchantCompleteDeliveryLive(id,pin,paid);toast('Entrega e pagamento confirmados')}catch(e){toast(String(e?.message||e))}
}
async function merchantLiveLogout(){
  await merchantSignOut();toast('Sessão encerrada');
}

function merchantPage(){
  if(globalThis.merchantPortalRequested?.())return merchantLivePage();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  const orders=state.orders.filter(o=>o.merchantId===m.id&&['OFFERED_TO_MERCHANT','MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'].includes(o.status));
  const fresh=isPriceFresh(m);
  const internalPilot=globalThis.CHAMA_INTERNAL_PILOT===true;
  const policy=m.pricingP13||{mode:'fixed',min:m.priceP13,preferred:m.priceP13,max:m.priceP13,strategy:'balanced'};
  const autoPrice=Number(productPrice(m,'P13',1));
  return shell(`<section class="page"><div class="status-bar"><div><div class="tiny muted">${internalPilot?'PAINEL DA REVENDA — PILOTO INTERNO':'PAINEL DA REVENDA — DEMONSTRAÇÃO'}</div><h1 class="page-title" style="margin-bottom:2px">${esc(m.name)}</h1></div><span class="status-pill ${m.online?'online':'offline'}">${m.online?'● ONLINE':'OFFLINE'}</span></div>
${internalPilot?'<div class="notice" style="margin-top:12px"><strong>Operação simulada.</strong><br>Faixa comercial P13 confirmada: R$ 115,90 mínimo, R$ 120,00 normal e R$ 125,00 máximo, com entrega incluída. Estoque, ETA, trust, aceite, pagamento e entrega desta tela continuam sendo testes locais.</div>':''}
<div class="card flat form-stack"><div class="input-wrap"><label for="merchant-select">Operação demonstrada</label><select id="merchant-select" class="input" onchange="selectMerchant(this.value)">${state.merchants.map(x=>`<option value="${x.id}" ${x.id===m.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><button class="${m.online?'secondary':'primary'}" onclick="toggleOnline('${m.id}')">${m.online?'Pausar novos pedidos':'Ficar online'}</button></div>
${!fresh?'<div class="notice danger" style="margin-top:12px"><strong>Preço expirado.</strong> A oferta não aparece ao cliente até ser reconfirmada.</div>':''}
<section class="section"><div class="merchant-kpis"><div class="kpi"><span class="label">${policy.mode==='range'?'Preço automático agora':'Preço P13'}</span><strong>${BRL.format(autoPrice)}</strong>${policy.mode==='range'?'<small>normal '+BRL.format(m.priceP13)+'</small>':''}</div><div class="kpi"><span class="label">Estoque P13</span><strong>${m.inventory.P13}</strong></div><div class="kpi"><span class="label">${internalPilot?'Trust simulado':'Trust'}</span><strong>${m.trust}</strong></div><div class="kpi"><span class="label">Pedidos ativos</span><strong>${orders.length}</strong></div></div></section>
<div class="card flat form-stack">
<div class="field-row">
  <div class="input-wrap"><label for="m-pricing-mode">Modo de preço</label><select id="m-pricing-mode" class="input" onchange="merchantDemoPricingModeChanged()"><option value="fixed" ${policy.mode==='fixed'?'selected':''}>Preço fixo</option><option value="range" ${policy.mode==='range'?'selected':''}>Faixa automática</option></select></div>
  <div class="input-wrap"><label for="m-price">${policy.mode==='range'?'Preço normal P13':'Preço P13'}</label><input id="m-price" inputmode="decimal" type="number" min="0.01" max="9999" step="0.10" class="input" value="${m.priceP13}"></div>
  <div class="input-wrap"><label for="m-stock">Estoque disponível P13</label><input id="m-stock" inputmode="numeric" type="number" min="0" max="9999" class="input" value="${m.inventory.P13}"></div>
</div>
<div class="field-row">
  <div class="input-wrap"><label for="m-price-min">Mínimo autorizado</label><input id="m-price-min" inputmode="decimal" type="number" min="0.01" max="9999" step="0.10" class="input" value="${policy.min}" ${policy.mode==='range'?'':'disabled'}></div>
  <div class="input-wrap"><label for="m-price-max">Máximo autorizado</label><input id="m-price-max" inputmode="decimal" type="number" min="0.01" max="9999" step="0.10" class="input" value="${policy.max}" ${policy.mode==='range'?'':'disabled'}></div>
  <div class="input-wrap"><label for="m-pricing-strategy">Estratégia</label><select id="m-pricing-strategy" class="input" ${policy.mode==='range'?'':'disabled'}><option value="volume" ${policy.strategy==='volume'?'selected':''}>Priorizar volume</option><option value="balanced" ${policy.strategy==='balanced'?'selected':''}>Equilibrado</option><option value="margin" ${policy.strategy==='margin'?'selected':''}>Priorizar margem</option></select></div>
</div>
<div class="notice"><strong>${policy.mode==='range'?'Faixa automática do piloto':'Preço fixo'}.</strong><br>${policy.mode==='range'?'O TAMÃO ajusta somente entre '+BRL.format(policy.min)+' e '+BRL.format(policy.max)+', usando estoque e carga desta revenda.':'O preço não muda automaticamente.'} ${internalPilot?'Nada nesta tela altera a condição comercial real do JR.':''}</div>
<button class="secondary" onclick="merchantUpdate('${m.id}')">Confirmar política e estoque</button><div class="tiny muted">Última confirmação: ${esc(formatDateTime(m.priceConfirmedAt))}</div></div>
<section class="section"><div class="section-head"><div><h2>Pedidos que exigem ação</h2><p>${internalPilot?'Use estes pedidos para treinar aceite, saída, chegada e conclusão. Nenhuma ação é real.':'Aceitar significa assumir compromisso real de atendimento.'}</p></div></div>${orders.length?orders.map(merchantOrder).join(''):`<div class="empty card">Nenhum pedido ativo para esta revenda.</div>`}</section></section>`)
}
function merchantOrder(o){
  const copy=statusCopy[o.status]||[o.status,''];
  const items=(o.items||[]).map(i=>`${i.qty}× ${esc(i.name)}`).join(' • ')||Object.entries(o.cart||{}).filter(([,q])=>q>0).map(([k,q])=>`${q}× ${esc(products[k]?.name||k)}`).join(' • ');
  let actions='';
  if(o.status==='OFFERED_TO_MERCHANT'){
    const secs=Math.max(0,Math.ceil((Date.parse(o.offerExpiresAt)-Date.now())/1000));
    actions=`<button class="primary small" onclick="merchantAction('${o.id}','accept')">Aceitar pedido</button><button class="danger-btn small" onclick="merchantAction('${o.id}','reject')">Não consigo atender</button><span class="tiny muted">Prazo: ~${secs}s</span>`;
  }else if(['MERCHANT_ACCEPTED','PREPARING','AT_RISK'].includes(o.status)){
    actions=`<button class="primary small" onclick="merchantAction('${o.id}','dispatch')">Confirmar saída</button><button class="danger-btn small" onclick="merchantAction('${o.id}','cannot-fulfill')">Não consigo concluir</button>`;
  }else if(o.status==='OUT_FOR_DELIVERY'){
    actions=`<button class="secondary small" onclick="merchantAction('${o.id}','arriving')">Estou chegando</button>`;
  }else if(o.status==='ARRIVING'){
    actions=`<label class="sr-only" for="pin-${o.id}">PIN de entrega</label><input id="pin-${o.id}" inputmode="numeric" maxlength="4" class="input pin-input" placeholder="PIN"><label class="check-row"><input id="paid-${o.id}" type="checkbox"><span><strong>Pagamento recebido</strong><small>Obrigatório para concluir o pedido.</small></span></label><button class="primary small" onclick="merchantAction('${o.id}','deliver')">Confirmar entrega</button>`;
  }
  const addressLine=o.status==='OFFERED_TO_MERCHANT'?'📍 Endereço protegido até o aceite':'📍 '+esc(o.address);
  return `<article class="order-card ${o.status==='OFFERED_TO_MERCHANT'?'new':''}"><div class="order-head"><div><div class="order-id">${esc(o.id)}</div><div class="order-line">${items}</div></div><div style="text-align:right"><strong>${BRL.format(o.total)}</strong><div class="tiny muted">${esc(copy[0])}</div></div></div><div class="order-line">${addressLine}</div><div class="order-line">Pagamento: ${esc(paymentLabel(o.paymentMethod))}</div><div class="order-actions">${actions}</div></article>`;
}
function selectMerchant(id){if(merchantById(id)){state.selectedMerchant=id;save();render()}}
function toggleOnline(id){
  const m=merchantById(id);if(!m)return toast('Revenda não encontrada');
  const r=m.online?pauseMerchant(id):resumeMerchant(id);
  toast(r.ok?(m.online?'Revenda online':'Novos pedidos pausados'):r.error);
  render();
}
function merchantDemoPricingModeChanged(){
  const range=document.querySelector('#m-pricing-mode')?.value==='range';
  for(const id of ['m-price-min','m-price-max','m-pricing-strategy']){
    const el=document.getElementById(id);if(el)el.disabled=!range;
  }
}
function merchantUpdate(id){
  const price=document.querySelector('#m-price')?.value;
  const stock=document.querySelector('#m-stock')?.value;
  const pricingMode=document.querySelector('#m-pricing-mode')?.value||'fixed';
  const pricingMin=document.querySelector('#m-price-min')?.value;
  const pricingMax=document.querySelector('#m-price-max')?.value;
  const pricingStrategy=document.querySelector('#m-pricing-strategy')?.value||'balanced';
  const r=updateMerchant(id,{priceP13:price,stockP13:stock,pricingMode,pricingMin,pricingMax,pricingStrategy});
  toast(r.ok?(pricingMode==='range'?'Faixa do piloto confirmada':'Preço e estoque confirmados'):r.error);render();
}
function merchantAction(id,action){
  let r={ok:false,error:'Ação inválida'};
  if(action==='accept')r=acceptOrder(id);
  if(action==='reject')r=rejectOrder(id);
  if(action==='dispatch')r=dispatchOrder(id);
  if(action==='cannot-fulfill')r=failAcceptedOrder(id,'A revenda informou uma falha operacional antes da saída.');
  if(action==='arriving')r=arrivingOrder(id);
  if(action==='deliver'){
    const pin=document.querySelector('#pin-'+CSS.escape(id))?.value.trim()||'';
    const paid=document.querySelector('#paid-'+CSS.escape(id))?.checked===true;
    r=deliverOrder(id,pin,paid);
  }
  const successMessages={accept:'Pedido aceito e estoque reservado',reject:'Pedido recusado; o sistema buscou alternativa','cannot-fulfill':'Estoque devolvido; o sistema buscou outra revenda',dispatch:'Saída confirmada — o cliente agora vê “A caminho”',arriving:'Chegada confirmada',deliver:'Entrega e pagamento confirmados; benefícios processados'};
  toast(r.ok?successMessages[action]:r.error);
  render();
}
function merchantOrders(){
  if(globalThis.merchantPortalRequested?.())return merchantLivePage();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  state.mode='merchant';save();return merchantPage()
}
function catalog(){
  if(globalThis.merchantPortalRequested?.())return merchantLiveCatalog();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  return shell(`<section class="page"><h1 class="page-title">Meu catálogo</h1><p class="muted">A revenda não fica limitada ao P13. Cada produto tem preço e disponibilidade próprios.</p><div class="list">${Object.entries(products).map(([k,p])=>{const price=productPrice(m,k);const stock=inventoryFor(m,k);return `<div class="list-row"><div class="product-left"><div class="product-icon">${p.icon}</div><div><strong>${esc(p.name)}</strong><br><small>${price==null?'Não oferecido':`${BRL.format(price)} • estoque ${stock}`}</small></div></div><span class="status-pill ${price==null||stock<=0?'offline':'online'}">${price==null?'INATIVO':stock<=0?'SEM ESTOQUE':'ATIVO'}</span></div>`}).join('')}</div><div class="notice" style="margin-top:14px">No produto real, cada categoria terá regras de compatibilidade logística e conformidade próprias.</div></section>`)
}
function merchantLiveCatalog(){
  const rt=globalThis.merchantRuntime||{};
  if(rt.status!=='ready')return merchantLivePage();

  const local=Object.entries(products).map(([code,p])=>{
    const current=(rt.catalog||[]).find(x=>x.productCode===code);
    return {
      productCode:code,
      productName:current?.productName||p.name,
      priceCents:Number(current?.priceCents||0),
      pricingMode:current?.pricingMode||'fixed',
      minPriceCents:Number(current?.minPriceCents??current?.priceCents??0),
      maxPriceCents:Number(current?.maxPriceCents??current?.priceCents??0),
      pricingStrategy:current?.pricingStrategy||'balanced',
      availableStock:Number(current?.availableStock||0),
      active:current?.active===true,
      priceConfirmedAt:current?.priceConfirmedAt||null
    };
  });

  const localCodes=new Set(local.map(x=>x.productCode));
  const serverOnly=(rt.catalog||[])
    .filter(item=>!localCodes.has(item.productCode))
    .map(item=>({
      productCode:String(item.productCode||'').toUpperCase(),
      productName:item.productName||item.productCode||'Produto',
      priceCents:Number(item.priceCents||0),
      pricingMode:item.pricingMode||'fixed',
      minPriceCents:Number(item.minPriceCents??item.priceCents??0),
      maxPriceCents:Number(item.maxPriceCents??item.priceCents??0),
      pricingStrategy:item.pricingStrategy||'balanced',
      availableStock:Number(item.availableStock||0),
      active:item.active===true,
      priceConfirmedAt:item.priceConfirmedAt||null
    }));

  const known=[...local,...serverOnly]
    .sort((a,b)=>{
      const ag=/^P([1-9][0-9]?)(?:_CONTAINER)?$/.exec(a.productCode);
      const bg=/^P([1-9][0-9]?)(?:_CONTAINER)?$/.exec(b.productCode);
      if(ag&&bg){
        const byKg=Number(ag[1])-Number(bg[1]);
        if(byKg)return byKg;
        return a.productCode.includes('_CONTAINER')?1:-1;
      }
      if(ag)return -1;
      if(bg)return 1;
      return a.productName.localeCompare(b.productName,'pt-BR');
    });

  const rows=known.map(item=>{
    const fresh=merchantTimestampFresh(item.priceConfirmedAt);
    const status=!item.active?'INATIVO':item.availableStock<=0?'SEM ESTOQUE':fresh?'CONFIRMADO':'PREÇO VENCIDO';
    const statusClass=item.active&&item.availableStock>0&&fresh?'online':item.active&&item.availableStock>0?'risk':'offline';
    const icon=products[item.productCode]?.icon||( /_CONTAINER$/.test(item.productCode)?'🛢️':/^P([1-9][0-9]?)$/.test(item.productCode)?'🔥':'📦');
    const range=item.pricingMode==='range';
    const strategyLabel={volume:'Priorizar volume',balanced:'Equilibrado',margin:'Priorizar margem'}[item.pricingStrategy]||'Equilibrado';
    const priceSummary=range
      ? 'Faixa '+BRL.format(item.minPriceCents/100)+' – '+BRL.format(item.maxPriceCents/100)+' • normal '+BRL.format(item.priceCents/100)+' • '+strategyLabel
      : 'Preço fixo '+(item.priceCents>0?BRL.format(item.priceCents/100):'—');
    return `<div class="card flat form-stack" style="margin-bottom:12px">
      <div class="status-bar"><div class="product-left"><div class="product-icon">${icon}</div><div><strong>${esc(item.productName)}</strong><br><small>${esc(item.productCode)} • ${esc(priceSummary)} • ${item.priceConfirmedAt?'confirmado '+new Date(item.priceConfirmedAt).toLocaleString('pt-BR'):'nunca confirmado'}</small></div></div><span class="status-pill ${statusClass}">${status}</span></div>
      <div class="field-row">
        <div class="input-wrap"><label for="live-pricing-mode-${item.productCode}">Modo</label><select id="live-pricing-mode-${item.productCode}" class="input" onchange="merchantPricingModeChanged('${item.productCode}')"><option value="fixed" ${range?'':'selected'}>Preço fixo</option><option value="range" ${range?'selected':''}>Faixa automática</option></select></div>
        <div class="input-wrap"><label for="live-price-${item.productCode}">Preço normal</label><input id="live-price-${item.productCode}" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" value="${item.priceCents>0?(item.priceCents/100).toFixed(2):''}"></div>
        <div class="input-wrap"><label for="live-stock-${item.productCode}">Estoque</label><input id="live-stock-${item.productCode}" inputmode="numeric" type="number" min="0" max="100000" class="input" value="${item.availableStock}"></div>
      </div>
      <div class="field-row">
        <div class="input-wrap"><label for="live-min-price-${item.productCode}">Mínimo autorizado</label><input id="live-min-price-${item.productCode}" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" value="${(item.minPriceCents/100).toFixed(2)}" ${range?'':'disabled'}></div>
        <div class="input-wrap"><label for="live-max-price-${item.productCode}">Máximo autorizado</label><input id="live-max-price-${item.productCode}" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" value="${(item.maxPriceCents/100).toFixed(2)}" ${range?'':'disabled'}></div>
        <div class="input-wrap"><label for="live-pricing-strategy-${item.productCode}">Estratégia</label><select id="live-pricing-strategy-${item.productCode}" class="input" ${range?'':'disabled'}><option value="volume" ${item.pricingStrategy==='volume'?'selected':''}>Priorizar volume</option><option value="balanced" ${item.pricingStrategy==='balanced'?'selected':''}>Equilibrado</option><option value="margin" ${item.pricingStrategy==='margin'?'selected':''}>Priorizar margem</option></select></div>
      </div>
      <div class="notice"><strong>${range?'Faixa autorizada':'Preço fixo'}.</strong><br>${range?'O TAMÃO pode escolher um preço somente entre o mínimo e o máximo, usando estoque e carga da sua própria operação. O preço de concorrentes não define o seu valor.':'O TAMÃO usa exatamente o preço normal informado neste SKU.'}</div>
      <label class="check-row"><input id="live-active-${item.productCode}" type="checkbox" ${item.active?'checked':''}><span><strong>Produto ativo</strong><small>Somente itens ativos e com estoque participam das ofertas.</small></span></label>
      <button class="secondary" onclick="merchantLiveSaveProduct('${item.productCode}')">Salvar e confirmar política de preço</button>
    </div>`;
  }).join('');

  const catalogCodes=new Set((rt.catalog||[]).map(item=>String(item.productCode||'').toUpperCase()));
  const addableProducts=(rt.availableProducts||[])
    .filter(item=>{
      const code=String(item.productCode||'').toUpperCase();
      return code&&!catalogCodes.has(code)&&!localCodes.has(code);
    })
    .sort((a,b)=>{
      const category=String(a.categoryName||'').localeCompare(String(b.categoryName||''),'pt-BR');
      return category||String(a.productName||'').localeCompare(String(b.productName||''),'pt-BR');
    });
  const addRegistered=addableProducts.length
    ? `<div class="card flat form-stack" style="margin-bottom:16px">
        <h3>Adicionar produto do catálogo TAMÃO</h3>
        <p class="muted tiny">Aqui aparecem produtos gerais liberados pela administração. GLP e vasilhames continuam nos fluxos específicos abaixo.</p>
        <div class="input-wrap"><label for="live-new-registry-product">Produto</label><select id="live-new-registry-product" class="input">
          ${addableProducts.map(item=>`<option value="${esc(item.productCode)}">${esc(item.categoryName||'Outros')} • ${esc(item.productName)}</option>`).join('')}
        </select></div>
        <div class="field-row">
          <div class="input-wrap"><label for="live-new-registry-price">Preço</label><input id="live-new-registry-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" placeholder="0,00"></div>
          <div class="input-wrap"><label for="live-new-registry-stock">Estoque</label><input id="live-new-registry-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="0"></div>
        </div>
        <button class="primary" onclick="merchantLiveAddRegisteredProduct()">Adicionar e confirmar</button>
      </div>`
    : '';

  const addGlp=`<div class="card flat form-stack" style="margin-bottom:16px">
    <h3>Adicionar cilindro GLP</h3>
    <p class="muted tiny">Códigos P1 a P90 seguem automaticamente as regras regulatórias e logísticas de GLP.</p>
    <div class="field-row">
      <div class="input-wrap"><label for="live-new-glp-code">Código</label><input id="live-new-glp-code" class="input" maxlength="3" placeholder="P20"></div>
      <div class="input-wrap"><label for="live-new-glp-price">Preço</label><input id="live-new-glp-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" placeholder="0,00"></div>
      <div class="input-wrap"><label for="live-new-glp-stock">Estoque</label><input id="live-new-glp-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="0"></div>
    </div>
    <button class="primary" onclick="merchantLiveAddGlp()">Adicionar e confirmar</button>
  </div>`;

  const addContainer=`<div class="card flat form-stack" style="margin-bottom:16px">
    <h3>Adicionar vasilhame</h3>
    <p class="muted tiny">Cadastre o recipiente separadamente da carga. Ex.: P13 cria o SKU P13_CONTAINER.</p>
    <div class="field-row">
      <div class="input-wrap"><label for="live-new-container-code">Tamanho GLP</label><input id="live-new-container-code" class="input" maxlength="3" placeholder="P13"></div>
      <div class="input-wrap"><label for="live-new-container-price">Preço do vasilhame</label><input id="live-new-container-price" inputmode="decimal" type="number" min="0.01" max="10000" step="0.10" class="input" placeholder="0,00"></div>
      <div class="input-wrap"><label for="live-new-container-stock">Estoque</label><input id="live-new-container-stock" inputmode="numeric" type="number" min="0" max="100000" class="input" value="0"></div>
    </div>
    <button class="primary" onclick="merchantLiveAddContainer()">Adicionar vasilhame</button>
  </div>`;

  return shell(`<section class="page"><button class="back" onclick="go('merchant')">← Operação</button><h1 class="page-title">Catálogo real</h1><p class="muted">Cada SKU possui sua própria confirmação de preço e política comercial. Produtos gerais liberados pela administração entram sem novo deploy; GLP mantém regras próprias.</p><div style="margin-top:16px">${addRegistered}${addGlp}${addContainer}${rows}</div></section>`);
}

async function merchantLiveAddRegisteredProduct(){
  const code=String(document.getElementById('live-new-registry-product')?.value||'').trim().toUpperCase();
  const available=(globalThis.merchantRuntime?.availableProducts||[]).find(item=>String(item.productCode||'').toUpperCase()===code);
  const price=Number(document.getElementById('live-new-registry-price')?.value);
  const stock=Number(document.getElementById('live-new-registry-stock')?.value);
  if(!available)return toast('Escolha um produto liberado pela administração');
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0||stock>100000){
    return toast('Revise preço e estoque');
  }
  try{
    await merchantUpdateProductLive(code,Math.round(price*100),stock,true);
    toast(String(available.productName||code)+' adicionado ao catálogo');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveAddGlp(){
  const code=String(document.getElementById('live-new-glp-code')?.value||'').trim().toUpperCase();
  const match=/^P([1-9][0-9]?)$/.exec(code);
  const kg=match?Number(match[1]):NaN;
  const price=Number(document.getElementById('live-new-glp-price')?.value);
  const stock=Number(document.getElementById('live-new-glp-stock')?.value);
  if(!Number.isInteger(kg)||kg<1||kg>90)return toast('Use um código GLP entre P1 e P90');
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0||stock>100000)return toast('Revise preço e estoque');
  try{
    await merchantUpdateProductLive(code,Math.round(price*100),stock,true);
    toast('Gás P'+kg+' adicionado ao catálogo');
  }catch(e){toast(String(e?.message||e))}
}

async function merchantLiveAddContainer(){
  const gasCode=String(document.getElementById('live-new-container-code')?.value||'').trim().toUpperCase();
  const match=/^P([1-9][0-9]?)$/.exec(gasCode);
  const kg=match?Number(match[1]):NaN;
  const price=Number(document.getElementById('live-new-container-price')?.value);
  const stock=Number(document.getElementById('live-new-container-stock')?.value);
  if(!Number.isInteger(kg)||kg<1||kg>90)return toast('Use um tamanho entre P1 e P90');
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(stock)||stock<0||stock>100000)return toast('Revise preço e estoque do vasilhame');
  try{
    await merchantUpdateProductLive(gasCode+'_CONTAINER',Math.round(price*100),stock,true);
    toast('Vasilhame P'+kg+' adicionado ao catálogo');
  }catch(e){toast(String(e?.message||e))}
}

function merchantMetrics(){
  if(globalThis.merchantPortalRequested?.())return merchantLivePage();
  if(globalThis.__CHAMA_TEST__!==true)return merchantRealPortalRequired();
  const internalPilot=globalThis.CHAMA_INTERNAL_PILOT===true;
  const m=merchantById(state.selectedMerchant)||state.merchants[0];
  const accepted=Math.max(0,Number(m.accepted)||0),delivered=Math.max(0,Number(m.delivered)||0);
  const completion=accepted?delivered/accepted:0;
  return shell(`<section class="page"><h1 class="page-title">Desempenho</h1><div class="merchant-kpis"><div class="kpi"><span class="label">${internalPilot?'Trust simulado':'Trust Score'}</span><strong>${m.trust}/100</strong></div><div class="kpi"><span class="label">Aceitos</span><strong>${accepted}</strong></div><div class="kpi"><span class="label">Entregues</span><strong>${delivered}</strong></div><div class="kpi"><span class="label">Conclusão</span><strong>${accepted?Math.round(completion*100)+'%':'—'}</strong></div></div><section class="section"><div class="card flat"><h3>O que mais pesa no Trust Score</h3><div class="list"><div class="list-row"><strong>Entregas dentro do ETA</strong><span>25%</span></div><div class="list-row"><strong>Conclusão após aceite</strong><span>20%</span></div><div class="list-row"><strong>Integridade dos status</strong><span>15%</span></div><div class="list-row"><strong>Integridade de preço</strong><span>15%</span></div></div></div></section></section>`)
}
function formatDateTime(v){
  const d=new Date(v);if(Number.isNaN(d.getTime()))return 'não confirmada';
  return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

globalThis.merchantRequestBillingPackageFromUi=merchantRequestBillingPackageFromUi;
globalThis.merchantNotifyStatementPaidFromUi=merchantNotifyStatementPaidFromUi;
globalThis.merchantCancelBillingRequestFromUi=merchantCancelBillingRequestFromUi;

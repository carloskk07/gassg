function club(){
  const purchases=Math.max(0,Number(state.user.purchases)||0);
  const cycle=purchases===0?0:(purchases%5||5);
  const pct=cycle*20;
  const next=purchases>0&&cycle===5?'Bônus atingido — próxima compra inicia novo ciclo':`${cycle} de 5 compras para o próximo bônus`;
  return shell(`<section class="page"><h1 class="page-title">Clube Chama</h1><div class="reward-hero"><div class="tiny" style="opacity:.75">SEU CASHBACK</div><div class="balance">${BRL.format(state.user.cashback)}</div><div class="tiny">crédito para usar em novas compras</div><div class="progress"><div style="width:${pct}%"></div></div><strong>${esc(next)}</strong></div>
<section class="section"><div class="grid cards-3"><div class="card"><div class="feature-icon">💵</div><h3>Cashback</h3><p class="muted tiny">Não é sacável. Ele reduz o valor de compras futuras dentro da plataforma.</p></div><div class="card"><div class="feature-icon">⭐</div><h3>Fidelidade</h3><p class="muted tiny">Compras e recorrência liberam benefícios progressivos.</p></div><div class="card"><div class="feature-icon">👑</div><h3>Plus</h3><p class="muted tiny">Assinatura opcional com vantagens ampliadas. Valores finais serão testados no piloto.</p></div></div></section>
<div class="card flat"><h3>Clube Plus — prévia</h3><p class="muted">Cashback ampliado, ofertas exclusivas, benefícios familiares e vantagens em produtos complementares.</p><button class="primary full" onclick="toast('Lista de interesse Plus registrada — demonstração')">Quero ser avisado</button></div></section>`)
}

function referralUrl(){
  const base=`${location.origin}${location.pathname}`;
  return `${base}?ref=${encodeURIComponent(state.user.referralCode)}#home`;
}
function refer(){
  const url=referralUrl();
  const live=globalThis.liveRequested?.()===true;
  const permanent=state.user.cashEarningEligible===true;
  const identityCard=live&&!permanent
    ? `<div class="notice" style="margin-top:14px"><strong>Comissão em dinheiro exige conta permanente.</strong><br>Suas indicações podem ficar registradas como “a liberar”, mas o saldo só se torna sacável depois que você vincular e confirmar um e-mail.</div><div class="card flat form-stack" style="margin-top:14px"><div class="input-wrap"><label for="cash-email">Seu e-mail</label><input id="cash-email" type="email" autocomplete="email" maxlength="160" class="input" placeholder="voce@email.com"></div><button class="primary" onclick="activateCashAccount()">Ativar minha conta</button><div class="tiny muted">A ativação mantém o mesmo usuário, pedidos, cashback e histórico.</div></div>`
    : live&&permanent
      ? '<div class="notice success" style="margin-top:14px"><strong>Conta habilitada para comissão.</strong><br>Comissões elegíveis passam pela janela de validação antes de ficarem disponíveis.</div>'
      : '';

  return shell(`<section class="page"><h1 class="page-title">Indique e ganhe</h1><p class="muted">Compartilhe seu link pessoal. Comissão só nasce quando existe uma venda válida, entregue e com pagamento confirmado.</p><div class="card flat"><div class="tiny muted">SEU LINK PESSOAL</div><div class="share-box">${esc(url)}</div><button class="primary full" style="margin-top:12px" onclick="shareReferral()">Compartilhar</button></div>
${identityCard}
<section class="section"><div class="section-head"><div><h2>Como funciona</h2></div></div><div class="steps">${[['1','Compartilhe seu link','Cadastro sozinho não gera comissão.'],['2','A pessoa compra','O pedido precisa ser real.'],['3','A revenda entrega e confirma o pagamento','A operação precisa ser comprovada.'],['4','A comissão entra em validação','Depois da janela de segurança e com conta permanente, ela pode ficar disponível.']].map(x=>`<div class="step"><div class="step-num">${x[0]}</div><div><strong>${x[1]}</strong><p>${x[2]}</p></div></div>`).join('')}</div></section><div class="card flat"><div class="merchant-kpis"><div class="kpi"><span class="label">Disponível</span><strong>${BRL.format(state.user.commissionAvailable)}</strong></div><div class="kpi"><span class="label">A liberar</span><strong>${BRL.format(state.user.commissionPending)}</strong></div></div><button class="secondary full" style="margin-top:12px" onclick="toast('Saque Pix será ativado com PSP real')" ${live&&!permanent?'disabled':''}>Sacar via Pix</button></div><div class="notice" style="margin-top:14px">Não há pagamento por mero recrutamento. Benefícios sacáveis são vinculados a vendas reais, entregues, pagas e validadas.</div></section>`)
}

async function activateCashAccount(){
  const email=document.querySelector('#cash-email')?.value.trim()||'';
  try{
    const result=await liveUpgradeAccount(email);
    if(result?.alreadyPermanent){
      state.user.cashEarningEligible=true;
      state.user.identityType='permanent';
      save();render();toast('Sua conta já está habilitada');
      return;
    }
    toast('Enviamos a confirmação para seu e-mail');
    const el=document.querySelector('#cash-email');
    if(el)el.value='';
  }catch(e){
    const msg=String(e?.message||e);
    toast(/manual linking|identity linking/i.test(msg)?'Ativação por e-mail ainda precisa ser habilitada no Auth do piloto':msg);
  }
}

function merchantsLanding(){
  const portal=globalThis.merchantPortalRequested?.()===true;
  return shell(`<section class="page"><span class="eyebrow">PARCEIROS LOCAIS</span><h1 class="page-title">Mais pedidos para sua operação.</h1><p class="muted">Você define seus preços, sua disponibilidade e seu catálogo. A plataforma ajuda clientes próximos a encontrarem quem consegue atendê-los melhor.</p><div class="grid cards-3" style="margin-top:20px"><div class="card"><div class="feature-icon">📦</div><h3>Venda incremental</h3><p class="muted tiny">Receba pedidos novos sem abrir outra loja.</p></div><div class="card"><div class="feature-icon">🎛️</div><h3>Controle total</h3><p class="muted tiny">Fique online, ajuste preço, estoque e área atendida.</p></div><div class="card"><div class="feature-icon">✅</div><h3>Confiança</h3><p class="muted tiny">Aceite real, saída confirmada e entrega comprovada.</p></div></div><div class="card flat" style="margin-top:16px"><h3>Quer participar do pool de São Gabriel?</h3><p class="muted">Comece com um cadastro curto. A ativação ocorre após validação operacional e, para GLP, verificação regulatória.</p><button class="primary full" onclick="${portal?"go('merchant-join')":"openMerchantPortal()"}">${portal?'Cadastrar minha empresa':'Acessar / cadastrar revenda'}</button></div></section>`)
}
function merchantJoin(){
  if(globalThis.merchantPortalRequested?.()){
    const rt=globalThis.merchantRuntime||{};
    if(['disabled','loading'].includes(rt.status)){
      return shell('<section class="page"><h1 class="page-title">Cadastro de parceiro</h1><div class="empty card">Conectando à sua conta…</div></section>');
    }
    if(rt.status==='unauthenticated')return merchantLiveLoginView();
  }
  return shell(`<section class="page"><button class="back" onclick="go('merchants')">← Para revendas</button><h1 class="page-title">Quero ser parceiro</h1><p class="muted">${globalThis.merchantPortalRequested?.()?'Este cadastro será enviado ao backend real do piloto.':'Demonstração do cadastro de parceiros.'}</p><div class="card flat form-stack"><div class="field-row"><div class="input-wrap"><label for="j-cnpj">CNPJ</label><input id="j-cnpj" autocapitalize="characters" maxlength="18" class="input" placeholder="00.000.000/0000-00 ou alfanumérico"></div><div class="input-wrap"><label for="j-name">Nome da empresa</label><input id="j-name" maxlength="90" class="input" placeholder="Nome da revenda"></div></div><div class="field-row"><div class="input-wrap"><label for="j-owner">Responsável</label><input id="j-owner" maxlength="90" class="input" placeholder="Nome do responsável"></div><div class="input-wrap"><label for="j-phone">WhatsApp</label><input id="j-phone" inputmode="tel" maxlength="20" class="input" placeholder="(55) 99999-9999"></div></div><div class="input-wrap"><label for="j-address">Endereço</label><input id="j-address" maxlength="160" class="input" placeholder="Endereço da empresa"></div><button class="primary" onclick="joinMerchant()">Enviar para análise</button></div><div class="notice" style="margin-top:14px">O cadastro não coloca a empresa online automaticamente. GLP exige validação da revenda e teste completo do fluxo antes do go-live.</div></section>`)
}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}
function isValidPhoneShape(v){const n=onlyDigits(v);return n.length===10||n.length===11}
async function joinMerchant(){
  const cnpj=document.querySelector('#j-cnpj')?.value.trim()||'';
  const name=document.querySelector('#j-name')?.value.trim()||'';
  const owner=document.querySelector('#j-owner')?.value.trim()||'';
  const phone=document.querySelector('#j-phone')?.value.trim()||'';
  const address=document.querySelector('#j-address')?.value.trim()||'';
  if(!isValidCnpjShape(cnpj))return toast('Informe um CNPJ válido no formato atual');
  if(name.length<2||owner.length<2||address.length<5)return toast('Revise os dados da empresa');
  if(!isValidPhoneShape(phone))return toast('Informe um WhatsApp válido');

  if(globalThis.merchantPortalRequested?.()){
    if(!globalThis.merchantRuntime?.session?.access_token)return toast('Entre com seu e-mail antes de enviar o cadastro');
    try{
      const result=await merchantSubmitApplicationLive({
        cnpj,
        companyName:name.slice(0,90),
        responsibleName:owner.slice(0,90),
        phone,
        address:address.slice(0,160)
      });
      toast('Cadastro real enviado para análise');
      globalThis.merchantRuntime.notice='Cadastro '+String(result?.companyName||name)+' recebido. Aguarde a validação e o vínculo da operação.';
      go('merchant');
      render();
      return;
    }catch(e){
      toast(String(e?.message||e));
      return;
    }
  }

  const normalized=normalizeCnpj(cnpj);
  if(state.onboarding.some(x=>normalizeCnpj(x.cnpj)===normalized))return toast('Este CNPJ já foi enviado para análise');
  state.onboarding.push({cnpj:normalized,name:name.slice(0,90),owner:owner.slice(0,90),phone:onlyDigits(phone),address:address.slice(0,160),status:'Em análise',createdAt:nowIso()});
  save();toast('Cadastro enviado para análise');go('merchants');
}

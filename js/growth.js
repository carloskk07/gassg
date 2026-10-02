const REFERRAL_PILOT_RATE=0.02;

function club(){
  const purchases=Math.max(0,Number(state.user.purchases)||0);
  const cycle=purchases===0?0:(purchases%5||5);
  const pct=cycle*20;
  const next=purchases>0&&cycle===5?'Ciclo completo — a próxima compra inicia um novo ciclo':\`\${cycle} de 5 compras no ciclo atual\`;
  const debt=Math.max(0,Number(state.user.cashbackDebt)||0);
  return shell(\`<section class="page">
    <span class="eyebrow">BENEFÍCIOS PARA QUEM COMPRA</span>
    <h1 class="page-title">Clube Chama</h1>
    <p class="muted page-lead">Acompanhe o que suas compras já devolveram para você e use o saldo disponível para economizar nas próximas.</p>
    <div class="reward-hero"><div class="tiny" style="opacity:.75">SEU CASHBACK DISPONÍVEL</div><div class="balance">\${BRL.format(state.user.cashback)}</div><div class="tiny">crédito para usar em novas compras</div><div class="progress"><div style="width:\${pct}%"></div></div><strong>\${esc(next)}</strong></div>
    \${debt>0?\`<div class="notice" style="margin-top:14px"><strong>\${BRL.format(debt)} em compensação.</strong><br>Esse valor corresponde a cashback de uma compra posteriormente revertida. Novos créditos reduzem essa compensação antes de ficarem disponíveis.</div>\`:''}
    <section class="section"><div class="grid cards-3">
      <div class="card"><div class="feature-icon">💵</div><h3>Cashback</h3><p class="muted tiny">Crédito para reduzir o valor de novas compras no Chama.</p></div>
      <div class="card"><div class="feature-icon">⭐</div><h3>Recorrência</h3><p class="muted tiny">Seu histórico ajuda a organizar benefícios e ciclos de fidelidade.</p></div>
      <div class="card"><div class="feature-icon">🤝</div><h3>Indicação</h3><p class="muted tiny">Além de economizar, você pode participar indicando novos compradores.</p><button class="ghost small" onclick="go('earn')">Ver como ganhar →</button></div>
    </div></section>
    <div class="card flat planned-card"><div><span class="section-kicker">EM EVOLUÇÃO</span><h3>Clube Plus</h3><p class="muted">Vantagens ampliadas estão em estudo para uma etapa futura. Nada é cobrado enquanto o produto não estiver ativo e claramente apresentado.</p></div><span class="status-pill offline">AINDA NÃO DISPONÍVEL</span></div>
  </section>\`)
}

function referralUrl(){
  if(!state.user.referralCode)return '';
  const base=\`\${location.origin}\${location.pathname}\`;
  return \`\${base}?ref=\${encodeURIComponent(state.user.referralCode)}#home\`;
}
function referralExample(orderReais,count=1){
  const amount=Math.max(0,Number(orderReais)||0);
  const qty=Math.max(1,Math.trunc(Number(count)||1));
  return roundMoney(amount*REFERRAL_PILOT_RATE*qty);
}
function refer(){
  const url=referralUrl();
  const live=globalThis.liveRequested?.()===true;
  const permanent=state.user.cashEarningEligible===true;
  const hasReferral=Boolean(state.user.referralCode);
  const referralCard=hasReferral
    ? \`<div class="card flat referral-share-card"><div class="tiny muted">SEU LINK PESSOAL</div><div class="share-box">\${esc(url)}</div><button class="primary full" style="margin-top:12px" onclick="shareReferral()">Compartilhar meu link</button></div>\`
    : '<div class="notice"><strong>Seu link ainda não está disponível.</strong><br>Ele aparece quando sua identidade real for carregada pelo serviço do Chama.</div>';
  const identityCard=live&&!permanent
    ? \`<div class="notice" style="margin-top:14px"><strong>Quer transformar comissão em saldo disponível?</strong><br>Vincule um e-mail à sua conta. Seu histórico, pedidos e cashback continuam no mesmo usuário.</div><div class="card flat form-stack" style="margin-top:14px"><div class="input-wrap"><label for="cash-email">Seu e-mail</label><input id="cash-email" type="email" autocomplete="email" maxlength="160" class="input" placeholder="voce@email.com"></div><button class="primary" onclick="activateCashAccount()">Vincular meu e-mail</button></div>\`
    : live&&permanent
      ? '<div class="notice success" style="margin-top:14px"><strong>Conta habilitada para comissão.</strong><br>Vendas elegíveis ainda passam pela janela de validação antes de se tornarem saldo disponível.</div>'
      : '';

  return shell(\`<section class="page">
    <button class="back" onclick="go('earn')">← Ganhe com o Chama</button>
    <span class="eyebrow">PARA PESSOAS</span>
    <h1 class="page-title">Compartilhe. A pessoa compra. Você pode ganhar.</h1>
    <p class="muted page-lead">Seu link identifica quem chegou por você. A comissão é vinculada a vendas elegíveis que realmente foram entregues, pagas e validadas.</p>
    <div class="earn-summary">
      <div class="earn-balance-card"><span>Disponível</span><strong>\${BRL.format(state.user.commissionAvailable)}</strong><small>saldo já liberado</small></div>
      <div class="earn-balance-card"><span>A liberar</span><strong>\${BRL.format(state.user.commissionPending)}</strong><small>em validação</small></div>
    </div>
    \${referralCard}
    \${identityCard}

    <section class="section"><div class="section-head"><div><span class="section-kicker">EXEMPLO SIMPLES</span><h2>Entenda a regra atual do piloto</h2><p>A política atual usa 2% sobre a venda elegível atribuída à indicação.</p></div></div>
      <div class="example-math">
        <div><small>1 compra de R$ 120</small><strong>\${BRL.format(referralExample(120))}</strong><span>exemplo de comissão</span></div>
        <div><small>10 compras de R$ 120</small><strong>\${BRL.format(referralExample(120,10))}</strong><span>exemplo acumulado</span></div>
      </div>
      <div class="notice" style="margin-top:12px">Os exemplos não são promessa de renda. Só contam vendas elegíveis atribuídas ao seu link e aprovadas pelas regras do programa.</div>
    </section>

    <section class="section"><div class="section-head"><div><h2>Como funciona</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Compartilhe seu link</strong><p>Envie para quem realmente possa se interessar pelo Chama.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>A pessoa compra</strong><p>Cadastro sozinho não gera comissão.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>A venda é concluída</strong><p>A entrega e o pagamento precisam ser confirmados.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>A comissão é validada</strong><p>Depois da janela de segurança, o valor elegível pode ficar disponível.</p></div></div>
    </div></section>

    <div class="card flat payout-card"><div><span class="section-kicker">SAQUE</span><h3>Pix está em preparação</h3><p class="muted">O saldo disponível já é separado do valor em validação. O saque só será habilitado quando a integração financeira real estiver pronta.</p></div><button class="secondary" disabled>Saque Pix ainda não disponível</button></div>
  </section>\`)
}

function earn(){
  return shell(\`<section class="page">
    <span class="eyebrow">GANHE COM O CHAMA</span>
    <h1 class="page-title">Duas formas de participar do crescimento.</h1>
    <p class="muted page-lead">Você pode gerar comissão indicando compradores ou usar sua empresa para conquistar novas vendas. São modelos diferentes, com regras claras e sem pagamento por simples recrutamento.</p>

    <div class="opportunity-grid main-opportunities">
      <article class="opportunity-card person-opportunity"><div class="opportunity-icon">🤝</div><span class="section-kicker">PARA PESSOAS</span><h2>Indique compradores</h2><p>Compartilhe seu link pessoal. Quando uma venda elegível atribuída a você é entregue, paga e validada, ela pode gerar comissão.</p>
        <ul class="clean-list"><li>Seu próprio link de indicação</li><li>Saldo “a liberar” separado do saldo disponível</li><li>Conta permanente para liberar comissão em dinheiro</li></ul>
        <div class="opportunity-example"><small>Regra atual do piloto</small><strong>2% sobre venda elegível</strong><span>Ex.: R$ 120 → \${BRL.format(referralExample(120))}</span></div>
        <button class="primary full" onclick="go('refer')">Abrir meu programa</button>
      </article>
      <article class="opportunity-card business-opportunity"><div class="opportunity-icon">🏪</div><span class="section-kicker">PARA EMPRESAS</span><h2>Venda pelo Chama</h2><p>Transforme a plataforma em mais um canal de vendas para gás, água e outros itens da sua operação.</p>
        <ul class="clean-list"><li>Você define preços e estoque</li><li>Escolhe quando ficar online</li><li>Decide se aceita cada pedido</li><li>Pode vender vários tipos de produto</li></ul>
        <div class="opportunity-example"><small>Você mantém o controle</small><strong>Catálogo + operação + pedidos</strong><span>Condições comerciais são apresentadas antes da ativação.</span></div>
        <button class="primary full" onclick="go('merchants')">Quero vender pelo Chama</button>
      </article>
    </div>

    <section class="section"><div class="soft-band"><div><span class="section-kicker">TRANSPARÊNCIA</span><h2>Ganhar depende de atividade real.</h2><p>Indicação exige venda válida. Revenda ganha vendendo produtos. O Chama não paga por formar rede de pessoas nem promete renda fixa.</p></div><button class="secondary" onclick="go('learn')">Entender o Chama</button></div></section>
  </section>\`)
}

function learn(){
  return shell(\`<section class="page">
    <span class="eyebrow">SAIBA MAIS</span>
    <h1 class="page-title">Entenda o Chama antes de fazer seu primeiro pedido.</h1>
    <p class="muted page-lead">O objetivo é simples: facilitar a comparação, dar mais clareza sobre o aceite da revenda e permitir que você acompanhe a entrega.</p>

    <section class="section"><div class="section-head"><div><span class="section-kicker">PASSO A PASSO</span><h2>Comprar é um fluxo de quatro etapas</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Monte sua cesta</strong><p>Escolha gás e/ou produtos essenciais disponíveis.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>Confirme seu endereço</strong><p>Usamos a cesta e o endereço para procurar opções elegíveis.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>Escolha uma opção</strong><p>Compare valor total e previsão de entrega antes de confirmar.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>Acompanhe</strong><p>Aceite, preparação, saída e conclusão aparecem como etapas distintas.</p></div></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">O QUE MUDA PARA VOCÊ</span><h2>Menos dúvida durante a compra</h2></div></div><div class="grid cards-3">
      <div class="card feature-card"><div class="feature-icon">💲</div><h3>Valor antes de confirmar</h3><p>Você vê o total da opção antes de criar o pedido.</p></div>
      <div class="card feature-card"><div class="feature-icon">✅</div><h3>Aceite real da revenda</h3><p>Pedido enviado não é tratado como atendido até a revenda confirmar.</p></div>
      <div class="card feature-card"><div class="feature-icon">📍</div><h3>Acompanhamento por etapas</h3><p>Preparando, a caminho e chegando são estados separados.</p></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">DÚVIDAS FREQUENTES</span><h2>Antes de comprar</h2></div></div><div class="faq-list">
      <details open><summary>Preciso comprar gás para pedir água, carvão, lenha ou gelo?</summary><p>Não. Quando houver oferta real para o produto, você pode montar uma cesta sem gás.</p></details>
      <details><summary>O preço pode mudar depois que eu escolho?</summary><p>A opção escolhida é protegida para o pedido. Se for necessária uma alternativa mais cara durante uma reatribuição, o sistema pede seu aceite antes de trocar a condição.</p></details>
      <details><summary>Como sei que a revenda realmente vai entregar?</summary><p>A revenda precisa aceitar o pedido. Depois, a saída também precisa ser confirmada antes de aparecer “A caminho”.</p></details>
      <details><summary>Como a entrega é concluída?</summary><p>A conclusão exige confirmação de pagamento e o PIN de recebimento do pedido.</p></details>
      <details><summary>Como funciona o cashback?</summary><p>Compras elegíveis podem gerar crédito para reduzir compras futuras dentro do Chama. O saldo aparece no Clube Chama.</p></details>
      <details><summary>Também posso ganhar indicando pessoas?</summary><p>Sim. Vendas elegíveis atribuídas ao seu link podem gerar comissão após entrega, pagamento e validação. Veja a área “Ganhe”.</p></details>
      <details><summary>Tenho uma revenda. Posso vender outros produtos além de gás?</summary><p>Sim. A proposta inclui gás e produtos relacionados, com preço e estoque controlados por SKU. GLP exige a validação regulatória aplicável.</p></details>
    </div></section>

    <div class="dual-cta"><button class="primary" onclick="quickProduct('P13')">🔥 Consultar uma compra</button><button class="secondary" onclick="go('earn')">💰 Ver como ganhar</button></div>
  </section>\`)
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

async function shareReferral(){
  const url=referralUrl();
  if(!url)return toast('Link real de indicação ainda indisponível');
  const text=`Use o Chama para consultar preço e pedir gás e outros itens em São Gabriel: ${url}`;
  try{
    if(navigator.share){
      await navigator.share({title:'Chama São Gabriel',text,url});
      return;
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      toast('Link copiado');
      return;
    }
    toast('Copie o link exibido acima');
  }catch(e){
    if(e?.name!=='AbortError')toast('Não foi possível compartilhar automaticamente');
  }
}

function merchantsLanding(){
  const portal=globalThis.merchantPortalRequested?.()===true;
  const cta=portal?"go('merchant-join')":"openMerchantPortal()";
  return shell(\`<section class="page merchant-landing">
    <span class="eyebrow">PARA EMPRESAS LOCAIS</span>
    <h1 class="page-title">Transforme o Chama em um novo canal de vendas.</h1>
    <p class="muted page-lead">Receba oportunidades de pedidos sem abrir outra loja. Você mantém o controle do catálogo, preço, estoque, disponibilidade e da decisão de aceitar cada pedido.</p>
    <div class="hero-actions merchant-hero-actions"><button class="primary" onclick="\${cta}">\${portal?'Cadastrar minha empresa':'Acessar / cadastrar revenda'}</button><button class="secondary" onclick="document.getElementById('merchant-how')?.scrollIntoView({behavior:'smooth'})">Como funciona</button></div>

    <div class="grid cards-3 partner-benefits">
      <div class="card"><div class="feature-icon">📈</div><h3>Mais um canal de vendas</h3><p class="muted tiny">O Chama pode apresentar sua operação a clientes procurando exatamente o que você vende.</p></div>
      <div class="card"><div class="feature-icon">🎛️</div><h3>Você continua no controle</h3><p class="muted tiny">Defina preço, estoque, taxa e disponibilidade. Fique offline quando não quiser receber novos pedidos.</p></div>
      <div class="card"><div class="feature-icon">🧺</div><h3>Venda além do P13</h3><p class="muted tiny">Cadastre outros tamanhos de GLP e produtos como água, carvão, lenha e gelo conforme sua operação.</p></div>
    </div>

    <section class="section" id="merchant-how"><div class="section-head"><div><span class="section-kicker">DO PEDIDO À ENTREGA</span><h2>Uma operação simples de entender</h2></div></div><div class="how-grid">
      <div class="how-card"><span>1</span><div><strong>Cliente consulta</strong><p>O Chama procura operações elegíveis para a cesta e o endereço.</p></div></div>
      <div class="how-card"><span>2</span><div><strong>Você decide se aceita</strong><p>Nenhum pedido vira compromisso da revenda sem seu aceite.</p></div></div>
      <div class="how-card"><span>3</span><div><strong>Prepare e confirme a saída</strong><p>O cliente só vê “A caminho” depois da sua confirmação.</p></div></div>
      <div class="how-card"><span>4</span><div><strong>Conclua com prova</strong><p>Pagamento confirmado e PIN encerram a entrega com rastreabilidade.</p></div></div>
    </div></section>

    <section class="section"><div class="section-head"><div><span class="section-kicker">O QUE VOCÊ CONTROLA</span><h2>Sua operação continua sendo sua.</h2></div></div>
      <div class="control-grid">
        <div class="control-item"><span>💲</span><div><strong>Preço por produto</strong><small>Atualize e reconfirme cada SKU.</small></div></div>
        <div class="control-item"><span>📦</span><div><strong>Estoque</strong><small>Somente item ativo e disponível entra nas ofertas.</small></div></div>
        <div class="control-item"><span>⏱️</span><div><strong>Prazo e taxa de entrega</strong><small>Configure a condição comercial da operação.</small></div></div>
        <div class="control-item"><span>🟢</span><div><strong>Online ou offline</strong><small>Pare de receber novos pedidos quando precisar.</small></div></div>
      </div>
    </section>

    <section class="section"><div class="merchant-requirements"><div><span class="section-kicker light">PARA COMEÇAR</span><h2>Cadastro curto, ativação responsável.</h2><p>Precisamos identificar a empresa e o responsável. Para vender GLP, a operação passa também pela verificação regulatória aplicável antes de entrar nas ofertas.</p></div>
      <div class="requirement-list"><span>✓ CNPJ e dados da empresa</span><span>✓ Responsável e contato</span><span>✓ Endereço da operação</span><span>✓ Validação ANP quando houver GLP</span></div>
    </div></section>

    <section class="section"><div class="soft-band"><div><span class="section-kicker">CONDIÇÕES COMERCIAIS</span><h2>Sem surpresa na ativação.</h2><p>As condições do piloto são apresentadas antes da operação entrar no ar. Enviar o cadastro não coloca a empresa online automaticamente e não cria cobrança por si só.</p></div><button class="primary" onclick="\${cta}">Começar cadastro</button></div></section>

    <div class="notice"><strong>Por que existe validação?</strong><br>Para que clientes encontrem operações realmente aptas a atender. Isso protege a experiência do comprador e também a reputação das empresas parceiras.</div>
  </section>\`)
}
function merchantJoin(){
  if(globalThis.merchantPortalRequested?.()){
    const rt=globalThis.merchantRuntime||{};
    if(['disabled','loading'].includes(rt.status)){
      return shell('<section class="page"><h1 class="page-title">Cadastro de parceiro</h1><div class="empty card">Conectando à sua conta…</div></section>');
    }
    if(rt.status==='unauthenticated')return merchantLiveLoginView();
  }
  if(globalThis.__CHAMA_TEST__!==true&&!globalThis.merchantPortalRequested?.())return merchantRealPortalRequired();
  return shell(`<section class="page"><button class="back" onclick="go('merchants')">← Para revendas</button><h1 class="page-title">Quero ser parceiro</h1><p class="muted">${globalThis.merchantPortalRequested?.()?'Este cadastro será enviado ao backend real.':'Ambiente isolado de teste.'}</p><div class="card flat form-stack"><div class="field-row"><div class="input-wrap"><label for="j-cnpj">CNPJ</label><input id="j-cnpj" autocapitalize="characters" maxlength="18" class="input" placeholder="00.000.000/0000-00 ou alfanumérico"></div><div class="input-wrap"><label for="j-name">Nome da empresa</label><input id="j-name" maxlength="90" class="input" placeholder="Nome da revenda"></div></div><div class="field-row"><div class="input-wrap"><label for="j-owner">Responsável</label><input id="j-owner" maxlength="90" class="input" placeholder="Nome do responsável"></div><div class="input-wrap"><label for="j-phone">WhatsApp</label><input id="j-phone" inputmode="tel" maxlength="20" class="input" placeholder="(55) 99999-9999"></div></div><div class="input-wrap"><label for="j-address">Endereço</label><input id="j-address" maxlength="160" class="input" placeholder="Endereço da empresa"></div><button class="primary" onclick="joinMerchant()">Enviar para análise</button></div><div class="notice" style="margin-top:14px">O cadastro não coloca a empresa online automaticamente. GLP exige validação da revenda e teste completo do fluxo antes do go-live.</div></section>`)
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

  if(globalThis.__CHAMA_TEST__!==true){
    openMerchantPortal();
    return;
  }

  const normalized=normalizeCnpj(cnpj);
  if(state.onboarding.some(x=>normalizeCnpj(x.cnpj)===normalized))return toast('Este CNPJ já foi enviado para análise');
  state.onboarding.push({cnpj:normalized,name:name.slice(0,90),owner:owner.slice(0,90),phone:onlyDigits(phone),address:address.slice(0,160),status:'Em análise',createdAt:nowIso()});
  save();toast('Cadastro enviado para análise');go('merchants');
}

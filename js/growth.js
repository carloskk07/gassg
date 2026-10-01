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
  return shell(`<section class="page"><h1 class="page-title">Indique e ganhe</h1><p class="muted">Compartilhe seu link pessoal. Comissão só nasce quando existe uma venda válida e entregue.</p><div class="card flat"><div class="tiny muted">SEU LINK PESSOAL</div><div class="share-box">${esc(url)}</div><button class="primary full" style="margin-top:12px" onclick="shareReferral()">Compartilhar</button></div>
<section class="section"><div class="section-head"><div><h2>Como funciona</h2></div></div><div class="steps">${[['1','Compartilhe seu link','Cadastro sozinho não gera comissão.'],['2','A pessoa compra','O pedido precisa ser real.'],['3','A revenda entrega','A entrega precisa ser comprovada.'],['4','A comissão é validada','Só então entra no saldo disponível para Pix.']].map(x=>`<div class="step"><div class="step-num">${x[0]}</div><div><strong>${x[1]}</strong><p>${x[2]}</p></div></div>`).join('')}</div></section><div class="card flat"><div class="merchant-kpis"><div class="kpi"><span class="label">Disponível</span><strong>${BRL.format(state.user.commissionAvailable)}</strong></div><div class="kpi"><span class="label">A liberar</span><strong>${BRL.format(state.user.commissionPending)}</strong></div></div><button class="secondary full" style="margin-top:12px" onclick="toast('Saque Pix será ativado com PSP real')">Sacar via Pix</button></div><div class="notice" style="margin-top:14px">Não há pagamento por mero recrutamento. Benefícios sacáveis são vinculados a vendas reais, entregues e validadas.</div></section>`)
}
async function shareReferral(){
  const url=referralUrl();
  const text=`Use o Chama para consultar preço e pedir gás e outros itens em São Gabriel: ${url}`;
  try{
    if(navigator.share){await navigator.share({title:'Chama São Gabriel',text,url});return}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);toast('Link copiado');return}
    toast('Copie o link exibido acima');
  }catch(e){
    if(e?.name!=='AbortError')toast('Não foi possível compartilhar automaticamente');
  }
}

function merchantsLanding(){
  return shell(`<section class="page"><span class="eyebrow">PARCEIROS LOCAIS</span><h1 class="page-title">Mais pedidos para sua operação.</h1><p class="muted">Você define seus preços, sua disponibilidade e seu catálogo. A plataforma ajuda clientes próximos a encontrarem quem consegue atendê-los melhor.</p><div class="grid cards-3" style="margin-top:20px"><div class="card"><div class="feature-icon">📦</div><h3>Venda incremental</h3><p class="muted tiny">Receba pedidos novos sem abrir outra loja.</p></div><div class="card"><div class="feature-icon">🎛️</div><h3>Controle total</h3><p class="muted tiny">Fique online, ajuste preço, estoque e área atendida.</p></div><div class="card"><div class="feature-icon">✅</div><h3>Confiança</h3><p class="muted tiny">Aceite real, saída confirmada e entrega comprovada.</p></div></div><div class="card flat" style="margin-top:16px"><h3>Quer participar do pool de São Gabriel?</h3><p class="muted">Comece com um cadastro curto. A ativação ocorre após validação operacional e, para GLP, verificação regulatória.</p><button class="primary full" onclick="go('merchant-join')">Cadastrar minha empresa</button></div></section>`)
}
function merchantJoin(){
  return shell(`<section class="page"><button class="back" onclick="go('merchants')">← Para revendas</button><h1 class="page-title">Quero ser parceiro</h1><div class="card flat form-stack"><div class="field-row"><div class="input-wrap"><label for="j-cnpj">CNPJ</label><input id="j-cnpj" autocapitalize="characters" maxlength="18" class="input" placeholder="00.000.000/0000-00 ou alfanumérico"></div><div class="input-wrap"><label for="j-name">Nome da empresa</label><input id="j-name" maxlength="90" class="input" placeholder="Nome da revenda"></div></div><div class="field-row"><div class="input-wrap"><label for="j-owner">Responsável</label><input id="j-owner" maxlength="90" class="input" placeholder="Nome do responsável"></div><div class="input-wrap"><label for="j-phone">WhatsApp</label><input id="j-phone" inputmode="tel" maxlength="20" class="input" placeholder="(55) 99999-9999"></div></div><div class="input-wrap"><label for="j-address">Endereço</label><input id="j-address" maxlength="160" class="input" placeholder="Endereço da empresa"></div><button class="primary" onclick="joinMerchant()">Enviar para análise</button></div><div class="notice" style="margin-top:14px">O cadastro não coloca a empresa online automaticamente. GLP exige validação da revenda e teste completo do fluxo antes do go-live.</div></section>`)
}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}
function isValidPhoneShape(v){const n=onlyDigits(v);return n.length===10||n.length===11}
function joinMerchant(){
  const cnpj=document.querySelector('#j-cnpj')?.value.trim()||'';
  const name=document.querySelector('#j-name')?.value.trim()||'';
  const owner=document.querySelector('#j-owner')?.value.trim()||'';
  const phone=document.querySelector('#j-phone')?.value.trim()||'';
  const address=document.querySelector('#j-address')?.value.trim()||'';
  if(!isValidCnpjShape(cnpj))return toast('Informe um CNPJ válido no formato atual');
  if(name.length<2||owner.length<2||address.length<5)return toast('Revise os dados da empresa');
  if(!isValidPhoneShape(phone))return toast('Informe um WhatsApp válido');
  const normalized=normalizeCnpj(cnpj);
  if(state.onboarding.some(x=>normalizeCnpj(x.cnpj)===normalized))return toast('Este CNPJ já foi enviado para análise');
  state.onboarding.push({cnpj:normalized,name:name.slice(0,90),owner:owner.slice(0,90),phone:onlyDigits(phone),address:address.slice(0,160),status:'Em análise',createdAt:nowIso()});
  save();toast('Cadastro enviado para análise');go('merchants');
}

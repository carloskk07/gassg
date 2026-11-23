// TAMÃO V1.1090 — premium sponsor-only experience, loaded on demand.
// Keeps the customer homepage lightweight; this module never enables billing.

// V1.1094 — interactive creative studio, with explicit draft handoff and no live ad delivery.
// Presets are illustrative, never a live booking, advertiser, or publication.
const TAMAO_SPONSOR_DEMO_PRESETS=Object.freeze({
 commerce:Object.freeze({label:'Comércio',symbol:'◇',headline:'Novidades que vale a pena conhecer.',
  copy:'Descubra produtos e novidades no site oficial da empresa.',
  newsHeadline:'Uma novidade especial para conhecer.',newsCopy:'Acompanhe os lançamentos e as novidades desta loja.',
  visitHeadline:'Conheça o nosso espaço na internet.',visitCopy:'Explore o catálogo e as informações da empresa no site oficial.'}),
 services:Object.freeze({label:'Serviços',symbol:'✦',headline:'Conheça os serviços da nossa cidade.',
  copy:'Saiba mais sobre o trabalho e os canais oficiais da empresa.',
  newsHeadline:'Tem novidade nos nossos serviços.',newsCopy:'Descubra novidades, especialidades e formas de atendimento.',
  visitHeadline:'Descubra mais sobre nossos serviços.',visitCopy:'Conheça o trabalho da empresa e seus canais oficiais.'}),
 food:Object.freeze({label:'Gastronomia',symbol:'◉',headline:'Novos sabores para descobrir na cidade.',
  copy:'Conheça o cardápio, as novidades e o site oficial do negócio.',
  newsHeadline:'Uma novidade para quem gosta de comer bem.',newsCopy:'Descubra os sabores e novidades preparados pelo estabelecimento.',
  visitHeadline:'Conheça nosso cardápio e novidades.',visitCopy:'Visite o site oficial para conhecer o cardápio e a empresa.'})
});
const TAMAO_SPONSOR_DEMO_GOALS=Object.freeze({
 intro:Object.freeze({label:'Apresentar a marca'}),
 news:Object.freeze({label:'Divulgar novidade'}),
 visit:Object.freeze({label:'Atrair visitas'})
});
const TAMAO_SPONSOR_DEMO_PLACEMENTS=Object.freeze({
 home:Object.freeze({label:'Na página inicial',context:'Descobertas perto de você',caption:'Produtos, serviços e novidades da sua região'}),
 brands:Object.freeze({label:'Na área de marcas',context:'Marcas da nossa região',caption:'Conheça empresas e iniciativas locais'})
});
// Prepaid credit values: preview-only, no payment or publishing side effects.
const TAMAO_SPONSOR_DEMO_PLANS=Object.freeze({
 1990:Object.freeze({value:1990,price:'R$ 19,90',days:7}),
 4990:Object.freeze({value:4990,price:'R$ 49,90',days:15}),
 9990:Object.freeze({value:9990,price:'R$ 99,90',days:30}),
 19990:Object.freeze({value:19990,price:'R$ 199,90',days:30})
});
const TAMAO_SPONSOR_DEMO_KEY='tamao-sponsor-showcase-v1092';
const tamaoSponsorDemoState={
 sector:'commerce',goal:'intro',placement:'home',company:'',message:'',
 budget:4990,budgetChosen:false,preparing:false
};
function sponsorDemoSafeText(text){
 return String(text||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,48);
}
function sponsorDemoEscape(text){
 return String(text||'').replace(/[&<>"']/g,ch=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function sponsorDemoRestore(){
 try{
  const raw=globalThis.sessionStorage?.getItem(TAMAO_SPONSOR_DEMO_KEY);
  if(!raw)return;
  const data=JSON.parse(raw);
  if(data&&Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_PRESETS,data.sector))
   tamaoSponsorDemoState.sector=data.sector;
  if(data&&typeof data.company==='string')
   tamaoSponsorDemoState.company=sponsorDemoSafeText(data.company);
  if(data&&Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_GOALS,data.goal))
   tamaoSponsorDemoState.goal=data.goal;
  if(data&&typeof data.message==='string')
   tamaoSponsorDemoState.message=sponsorDemoSafeText(data.message).replace(/\s+/g,' ').trim();
  if(data&&Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_PLACEMENTS,data.placement))
   tamaoSponsorDemoState.placement=data.placement;
  const chosenBudget=Number(data?.budget);
  if(Number.isSafeInteger(chosenBudget)&&
     Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_PLANS,chosenBudget))
   tamaoSponsorDemoState.budget=chosenBudget;
  tamaoSponsorDemoState.budgetChosen=data?.budgetChosen===true;
  tamaoSponsorDemoState.preparing=data?.preparing===true;
 }catch{}
}
function sponsorDemoSave(){
 try{
  globalThis.sessionStorage?.setItem(TAMAO_SPONSOR_DEMO_KEY,JSON.stringify(tamaoSponsorDemoState));
 }catch{}
}
function sponsorDemoPresentation(){
 const sector=tamaoSponsorDemoState.sector,goal=tamaoSponsorDemoState.goal;
 const placement=tamaoSponsorDemoState.placement;
 const location=TAMAO_SPONSOR_DEMO_PLACEMENTS[placement]||TAMAO_SPONSOR_DEMO_PLACEMENTS.home;
 const plan=TAMAO_SPONSOR_DEMO_PLANS[tamaoSponsorDemoState.budget]||
  TAMAO_SPONSOR_DEMO_PLANS[4990];
 const data=TAMAO_SPONSOR_DEMO_PRESETS[sector]||TAMAO_SPONSOR_DEMO_PRESETS.commerce;
 const brand=tamaoSponsorDemoState.company.trim()||'A SUA MARCA AQUI';
 const first=[...tamaoSponsorDemoState.company.trim()].find(ch=>/[\p{L}\p{N}]/u.test(ch))||'M';
 const headline=goal==='news'?data.newsHeadline:goal==='visit'?data.visitHeadline:data.headline;
 const baseCopy=goal==='news'?data.newsCopy:goal==='visit'?data.visitCopy:data.copy;
 return {sector,goal,placement,context:location.context,caption:location.caption,
  planLabel:plan.price+' em créditos',viewEstimate:Math.floor(plan.value/2).toLocaleString('pt-BR'),brand,
  monogram:first.toLocaleUpperCase('pt-BR'),...data,
  headline,copy:tamaoSponsorDemoState.message||baseCopy,
  goalLabel:TAMAO_SPONSOR_DEMO_GOALS[goal]?.label||TAMAO_SPONSOR_DEMO_GOALS.intro.label};
}
function sponsorDemoPaint(){
 if(typeof document==='undefined')return false;
 const demo=sponsorDemoPresentation();
 for(const field of ['brand','headline','copy','label','symbol','goalLabel','monogram','context','caption','planLabel','viewEstimate']){
  for(const element of document.querySelectorAll('[data-sponsor-demo="'+field+'"]'))
   element.textContent=String(demo[field]);
 }
 const art=document.querySelector('.sponsor-premium-ad-art');
 art?.setAttribute('data-demo-sector',demo.sector);
 document.querySelector('.sponsor-premium-visual')?.setAttribute('data-demo-placement',demo.placement);
 for(const option of document.querySelectorAll('[data-sponsor-demo-sector]')){
  const chosen=option.getAttribute('data-sponsor-demo-sector')===demo.sector;
  option.setAttribute('aria-pressed',String(chosen));
 }
 for(const option of document.querySelectorAll('[data-sponsor-demo-goal]')){
  const chosen=option.getAttribute('data-sponsor-demo-goal')===demo.goal;
  option.setAttribute('aria-pressed',String(chosen));
 }
 for(const option of document.querySelectorAll('[data-sponsor-demo-placement]')){
  const chosen=option.getAttribute('data-sponsor-demo-placement')===demo.placement;
  option.setAttribute('aria-pressed',String(chosen));
 }
 for(const option of document.querySelectorAll('[data-sponsor-demo-budget]')){
  const selected=Number(option.getAttribute('data-sponsor-demo-budget'))===tamaoSponsorDemoState.budget;
  option.setAttribute('aria-pressed',String(selected));
 }
 return true;
}
function sponsorDemoType(){
 const input=document.getElementById('sponsor-demo-company');
 if(!input)return false;
 tamaoSponsorDemoState.company=sponsorDemoSafeText(input.value);
 sponsorDemoSave();
 return sponsorDemoPaint();
}
function sponsorDemoSelect(sector){
 if(!Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_PRESETS,sector))return false;
 tamaoSponsorDemoState.sector=sector;
 sponsorDemoSave();
 const painted=sponsorDemoPaint();
 const status=document.getElementById('sponsor-demo-status');
 if(status)status.textContent='Prévia ilustrativa para '+TAMAO_SPONSOR_DEMO_PRESETS[sector].label.toLowerCase()+' atualizada. Nenhuma campanha foi criada.';
 return painted;
}
function sponsorDemoPlacement(placement){
 if(!Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_PLACEMENTS,placement))return false;
 tamaoSponsorDemoState.placement=placement;
 sponsorDemoSave();
 const painted=sponsorDemoPaint();
 const status=document.getElementById('sponsor-demo-status');
 if(status)status.textContent='Exemplo ilustrativo alterado: '+TAMAO_SPONSOR_DEMO_PLACEMENTS[placement].label+'. A campanha ainda não existe.';
 return painted;
}
function sponsorDemoGoal(goal){
 if(!Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_GOALS,goal))return false;
 tamaoSponsorDemoState.goal=goal;
 sponsorDemoSave();
 const painted=sponsorDemoPaint();
 const status=document.getElementById('sponsor-demo-status');
 if(status)status.textContent='Objetivo selecionado: '+TAMAO_SPONSOR_DEMO_GOALS[goal].label+'. Prévia privada atualizada.';
 return painted;
}
function sponsorDemoMessage(){
 const input=document.getElementById('sponsor-demo-message');
 if(!input)return false;
 tamaoSponsorDemoState.message=sponsorDemoSafeText(input.value).replace(/\s+/g,' ').trim();
 sponsorDemoSave();
 return sponsorDemoPaint();
}
function sponsorDemoBudget(value){
 const budget=Number(value);
 if(!Number.isSafeInteger(budget)||
    !Object.prototype.hasOwnProperty.call(TAMAO_SPONSOR_DEMO_PLANS,budget))return false;
 tamaoSponsorDemoState.budget=budget;
 tamaoSponsorDemoState.budgetChosen=true;
 sponsorDemoSave();
 const painted=sponsorDemoPaint();
 const status=document.getElementById('sponsor-demo-status');
 if(status){
  const plan=TAMAO_SPONSOR_DEMO_PLANS[budget];
  status.textContent='Valor selecionado: '+plan.price+' em créditos. Até '+
   Math.floor(plan.value/2).toLocaleString('pt-BR')+
   ' visualizações faturáveis, se houver audiência. Nenhum Pix é criado aqui.';
 }
 return painted;
}
function sponsorDemoContinue(){
 // Continuing explicitly accepts the amount already displayed, even if the
 // advertiser did not click the selected default again. No payment occurs here.
 tamaoSponsorDemoState.budgetChosen=true;
 tamaoSponsorDemoState.preparing=true;
 sponsorDemoSave();
 const demo=sponsorDemoPresentation();
 for(const [id,value] of [['sponsor-ad-company',tamaoSponsorDemoState.company.trim()],
   ['sponsor-ad-title',demo.headline],['sponsor-ad-copy',demo.copy]]){
  const input=document.getElementById(id);
  if(input&&!String(input.value||'').trim()&&value)input.value=value;
 }
 globalThis.tamaoAdsUpdateCreativePreview?.();
 if(tamaoSponsorDemoState.budgetChosen)
  globalThis.tamaoCreditChoose?.(tamaoSponsorDemoState.budget);
 globalThis.tamaoCreditPrepareFromStudio?.();
 return sponsorJumpTo('sponsor-pricing');
}
// Used only to prefill an EMPTY campaign draft after explicit continuation.
// Never fills a person's name, e-mail, phone, or payment fields.
globalThis.tamaoSponsorDemoBudget=()=>tamaoSponsorDemoState.preparing&&
 tamaoSponsorDemoState.budgetChosen?tamaoSponsorDemoState.budget:null;
globalThis.tamaoSponsorDemoCompany=()=>tamaoSponsorDemoState.preparing?
  tamaoSponsorDemoState.company.trim():'';
globalThis.tamaoSponsorDemoCreative=()=>{
 if(!tamaoSponsorDemoState.preparing)return null;
 const demo=sponsorDemoPresentation();
 return {headline:demo.headline,copy:demo.copy};
};
globalThis.tamaoSponsorDemoConsume=()=>{
 tamaoSponsorDemoState.preparing=false;sponsorDemoSave();
};
sponsorDemoRestore();

function sponsorJumpTo(id){
 if(!['sponsor-formats','sponsor-pricing','sponsor-faq','sponsor-placements','sponsor-account-step'].includes(id))return false;
 const section=document.getElementById(id);
 if(!section)return false;
 const reduce=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
 section.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});
 section.focus?.({preventScroll:true});
 return true;
}
function sponsorsLandingPremium(){
 globalThis.tamaoAdsCreditModeEnabled=true;
  const demo=sponsorDemoPresentation();
  return shell(`<section class="page tamao-sponsors-page sponsor-premium-v1090">
<header class="tamao-sponsor-hero sponsor-premium-hero">
 <div class="sponsor-hero-layout">
  <div class="sponsor-hero-copy">
   <span class="sponsor-premium-eyebrow"><span class="sponsor-premium-dot" aria-hidden="true"></span> PUBLICIDADE LOCAL NO TAMÃO</span>
   <h1 class="page-title">Sua marca merece <em>ser vista</em> por quem vive a sua cidade.</h1>
   <p class="page-lead">Apresente sua empresa, seus serviços e suas novidades em um espaço pensado para conectar negócios e pessoas. Escolha a região e prepare sua campanha com clareza.</p>
   <div class="sponsor-premium-actions">
    <button type="button" class="primary sponsor-premium-main-cta" onclick="sponsorDemoContinue()">Criar meu anúncio <span aria-hidden="true">→</span></button>
    <button type="button" class="sponsor-premium-link" onclick="sponsorJumpTo('sponsor-formats')">Conhecer os formatos <span aria-hidden="true">↗</span></button>
   </div>
   <div class="sponsor-premium-hero-proof"><span>✓ Sem precisar ter revenda</span><span>✓ Escolha sua região</span><span>✓ Proposta gratuita</span></div>
   <p class="sponsor-premium-starting"><strong>R$ 0,02 por visualização elegível</strong> <span>· Recargas a partir de R$ 19,90, sem pacote de dias</span></p>
  </div>
  <aside class="sponsor-premium-visual" data-demo-placement="${demo.placement}" aria-label="Prévia ilustrativa de anúncio identificado">
   <div class="sponsor-premium-browser"><span class="sponsor-premium-browser-dots" aria-hidden="true">● ● ●</span><strong>TAMÃO</strong><small>Prévia de anúncio</small></div>
   <div class="sponsor-preview-switch" role="group" aria-label="Ver anúncio em diferentes espaços">
     <button type="button" data-sponsor-demo-placement="home" aria-pressed="${String(demo.placement==='home')}" onclick="sponsorDemoPlacement('home')">Página inicial</button>
     <button type="button" data-sponsor-demo-placement="brands" aria-pressed="${String(demo.placement==='brands')}" onclick="sponsorDemoPlacement('brands')">Área de marcas</button>
   </div>
   <div class="sponsor-preview-context" aria-hidden="true">
     <small data-sponsor-demo="caption">${sponsorDemoEscape(demo.caption)}</small>
     <strong data-sponsor-demo="context">${sponsorDemoEscape(demo.context)}</strong>
     <div class="sponsor-preview-pills"><span>Região</span><span>Produtos</span><span>Serviços</span></div>
   </div>
   <div class="sponsor-premium-ad-mock">
    <span class="sponsor-premium-ad-tag">PUBLICIDADE IDENTIFICADA</span>
    <div class="sponsor-premium-ad-art" data-demo-sector="${demo.sector}" aria-hidden="true"><span class="sponsor-premium-ad-orbit"></span><span class="sponsor-premium-ad-shape" data-sponsor-demo="monogram">${sponsorDemoEscape(demo.monogram)}</span><span class="sponsor-premium-art-caption" data-sponsor-demo="label">${sponsorDemoEscape(demo.label)}</span></div>
    <span class="sponsor-premium-ad-brand" data-sponsor-demo="brand">${sponsorDemoEscape(demo.brand)}</span>
    <strong data-sponsor-demo="headline">${sponsorDemoEscape(demo.headline)}</strong>
    <p data-sponsor-demo="copy">${sponsorDemoEscape(demo.copy)}</p>
    <span class="sponsor-premium-ad-action">Conhecer a empresa <span aria-hidden="true">↗</span></span>
   </div>
   <div class="sponsor-preview-after" aria-hidden="true"><span>Marca identificada</span><span>Condições transparentes</span><span>Revisão antes de publicar</span></div>
   <p class="sponsor-premium-visual-note">Apresentação ilustrativa, não é anúncio publicado. Localização e exibição dependem de revisão e inventário disponível.</p>
  </aside>
 </div>
   <div class="sponsor-demo-panel">
     <div class="sponsor-demo-panel-head"><span class="sponsor-demo-studio-kicker">ESTÚDIO DE ANÚNCIOS</span><strong>Sua campanha começa aqui.</strong><small>Teste a apresentação sem criar conta. Personalize sua marca e escolha o valor de crédito para montar a proposta.</small></div>
     <div class="sponsor-demo-name-field">
       <label for="sponsor-demo-company">Nome da empresa <span>(opcional)</span></label>
       <input id="sponsor-demo-company" class="input" maxlength="48" autocomplete="organization" type="text" placeholder="Ex.: Minha empresa" value="${sponsorDemoEscape(tamaoSponsorDemoState.company)}" oninput="sponsorDemoType()">
     </div>
     <div class="sponsor-demo-sector-field">
       <span class="sponsor-demo-control-label">Qual é seu segmento?</span>
       <div class="sponsor-demo-options" role="group" aria-label="Escolha o tipo de negócio">
         ${Object.entries(TAMAO_SPONSOR_DEMO_PRESETS).map(([key,value])=>'<button type="button" data-sponsor-demo-sector="'+key+'" aria-pressed="'+String(demo.sector===key)+'" onclick="sponsorDemoSelect(\''+key+'\')">'+sponsorDemoEscape(value.label)+'</button>').join('')}
       </div>
     </div>
     <div class="sponsor-demo-goals-field">
       <span class="sponsor-demo-control-label">O que você quer divulgar?</span>
       <div class="sponsor-demo-goals" role="group" aria-label="Objetivo da campanha">
         ${Object.entries(TAMAO_SPONSOR_DEMO_GOALS).map(([key,value])=>'<button type="button" data-sponsor-demo-goal="'+key+'" aria-pressed="'+String(demo.goal===key)+'" onclick="sponsorDemoGoal(\''+key+'\')">'+sponsorDemoEscape(value.label)+'</button>').join('')}
       </div>
     </div>
     <div class="sponsor-demo-message-field">
       <label for="sponsor-demo-message">Sua mensagem <span>(opcional · até 48 caracteres)</span></label>
       <input id="sponsor-demo-message" class="input" maxlength="48" type="text" placeholder="Ou use o texto sugerido ao lado" value="${sponsorDemoEscape(tamaoSponsorDemoState.message)}" oninput="sponsorDemoMessage()">
     </div>
     <div class="sponsor-demo-budget-field">
       <span class="sponsor-demo-control-label">Escolha quanto carregar em créditos</span>
       <div class="sponsor-demo-plans" role="group" aria-label="Escolha um valor de créditos publicitários">
         ${Object.values(TAMAO_SPONSOR_DEMO_PLANS).map(plan=>'<button type="button" data-sponsor-demo-budget="'+plan.value+'" aria-pressed="'+String(tamaoSponsorDemoState.budget===plan.value)+'" onclick="sponsorDemoBudget('+plan.value+')"><strong>'+plan.price+'</strong><small>'+'créditos</small></button>').join('')}
       </div>
       <small class="sponsor-demo-plan-note">São créditos para consumir por visualizações elegíveis, não pacotes de dias. A entrega depende da audiência disponível.</small>
     </div>
     <div class="sponsor-demo-action">
       <span class="sponsor-demo-plan-summary">Sua escolha: <strong data-sponsor-demo="planLabel">${sponsorDemoEscape(demo.planLabel)}</strong></span>
       <p class="sponsor-demo-view-estimate" role="note"><span>Potencial matemático do saldo</span><strong>Até <span data-sponsor-demo="viewEstimate">${sponsorDemoEscape(demo.viewEstimate)}</span> visualizações faturáveis</strong><small>Não é garantia de entrega: depende da audiência, da revisão e do inventário.</small></p>
       <button type="button" class="sponsor-demo-continue" onclick="sponsorDemoContinue()">Continuar com esta proposta <span aria-hidden="true">→</span></button>
       <small>Teste livre, sem cadastro. Confirme seus dados somente quando decidir enviar.</small>
     </div>
     <p id="sponsor-demo-status" class="sponsor-demo-feedback" role="status" aria-live="polite">Personalize sua proposta. Não é necessário pagar para preparar ou enviar o anúncio.</p>
   </div>
</header>
<div class="sponsor-premium-trust-rail" aria-label="O que sua empresa encontra no TAMÃO">
 <div><span aria-hidden="true">⌖</span><strong>Presença por cidade</strong><small>Você indica a região de interesse.</small></div>
 <div><span aria-hidden="true">✦</span><strong>Sua marca identificada</strong><small>Conteúdo patrocinado claramente sinalizado.</small></div>
 <div><span aria-hidden="true">◷</span><strong>Saldo e consumo</strong><small>Desconto por visualização elegível.</small></div>
 <div><span aria-hidden="true">▤</span><strong>Acompanhamento</strong><small>Status da campanha em sua conta.</small></div>
</div>
<section class="sponsor-premium-placements" id="sponsor-placements" tabindex="-1" aria-label="Onde sua marca pode aparecer">
 <div class="sponsor-premium-section-heading">
  <span class="section-kicker">VEJA ONDE SUA MARCA PODE APARECER</span>
  <h2>Uma divulgação que combina com a experiência do TAMÃO.</h2>
  <p>O público reconhece sua marca em espaços de publicidade identificada. Conheça dois contextos de apresentação previstos na plataforma.</p>
 </div>
 <div class="sponsor-placement-gallery">
  <article class="sponsor-placement-frame">
   <div class="sponsor-placement-browser"><strong>TAMÃO</strong><small>Início • Produtos e serviços</small><span aria-hidden="true">● ● ●</span></div>
   <div class="sponsor-placement-body">
    <div class="sponsor-placement-context"><span>NA PÁGINA INICIAL</span><strong>Descubra produtos, serviços e novidades na sua região.</strong></div>
    <div class="sponsor-placement-faux-products" aria-hidden="true"><span>Produtos e serviços</span><span>Atendimento local</span><span>Publicidade identificada</span></div>
    <div class="sponsor-placement-ad"><small>PUBLICIDADE · <span data-sponsor-demo="brand">${sponsorDemoEscape(demo.brand)}</span></small><strong data-sponsor-demo="headline">${sponsorDemoEscape(demo.headline)}</strong><p data-sponsor-demo="copy">${sponsorDemoEscape(demo.copy)}</p><span>Conhecer a empresa ↗</span></div>
   </div>
   <div class="sponsor-placement-caption"><strong>01 · Página inicial</strong><p>Um espaço contextual para campanhas elegíveis na navegação pública.</p></div>
  </article>
  <article class="sponsor-placement-frame">
   <div class="sponsor-placement-browser"><strong>TAMÃO</strong><small>Publicidade local</small><span aria-hidden="true">● ● ●</span></div>
   <div class="sponsor-placement-body sponsor-placement-body-brands">
    <div class="sponsor-placement-context"><span>NA ÁREA DE MARCAS</span><strong>Descubra iniciativas de empresas da região.</strong></div>
    <div class="sponsor-placement-ad sponsor-placement-ad-brands"><small>PUBLICIDADE · <span data-sponsor-demo="brand">${sponsorDemoEscape(demo.brand)}</span></small><strong data-sponsor-demo="headline">${sponsorDemoEscape(demo.headline)}</strong><p data-sponsor-demo="copy">${sponsorDemoEscape(demo.copy)}</p><span>Conhecer o anunciante ↗</span></div>
    <div class="sponsor-placement-faux-lines" aria-hidden="true"><span>Marca identificada</span><span>Região definida</span></div>
   </div>
   <div class="sponsor-placement-caption"><strong>02 · Área de publicidade</strong><p>Outra oportunidade de apresentação quando houver inventário na cidade.</p></div>
  </article>
 </div>
 <p class="sponsor-placement-caveat">Representações ilustrativas dos espaços já previstos na plataforma. A posição, a duração e a veiculação efetiva dependem de inventário, revisão e condições aprovadas; não representam campanha ativa.</p>
 <div class="sponsor-placement-action"><button type="button" class="secondary" onclick="sponsorJumpTo('sponsor-pricing')">Preparar meu anúncio para avaliação <span aria-hidden="true">→</span></button></div>
</section>
<section class="sponsor-premium-why" aria-label="Vantagens de anunciar no TAMÃO">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">VISIBILIDADE PARA QUEM EMPREENDE</span><h2>Mais presença para o seu negócio, sem complicar sua rotina.</h2><p>Você não precisa vender produtos pelo TAMÃO para divulgar a sua marca. Campanhas independentes seguem critérios de revisão, região e disponibilidade.</p></div>
 <div class="sponsor-premium-value-grid">
  <article><span aria-hidden="true">01</span><h3>Mostre o que a empresa faz</h3><p>Apresente sua mensagem em um anúncio identificado e direcione interessados ao seu site oficial.</p></article>
  <article><span aria-hidden="true">02</span><h3>Escolha o contexto local</h3><p>Indique a cidade que faz sentido para sua campanha e o orçamento que pretende investir.</p></article>
  <article><span aria-hidden="true">03</span><h3>Tenha clareza em cada etapa</h3><p>Envie a proposta, acompanhe sua situação e conheça as condições antes da ativação.</p></article>
 </div>
</section>
<section class="section sponsor-formats sponsor-premium-formats" id="sponsor-formats" tabindex="-1" aria-label="Formatos para sua campanha">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">ESCOLHA SEU OBJETIVO</span><h2>Publicidade para diferentes momentos do seu negócio.</h2><p>Comece com um anúncio identificado ou converse sobre uma ação de benefícios e parcerias regionais.</p></div>
 <div class="sponsor-format-grid">
  <article><span>01 / VISIBILIDADE</span><span class="sponsor-premium-format-icon" aria-hidden="true">✦</span><h3>Anúncio da sua empresa</h3><p>Apresente sua marca em áreas elegíveis do TAMÃO, conforme a cidade e a disponibilidade de espaços.</p><button type="button" onclick="sponsorJumpTo('sponsor-pricing')">Criar anúncio da minha empresa <span aria-hidden="true">→</span></button></article>
  <article><span>02 / RELACIONAMENTO</span><span class="sponsor-premium-format-icon" aria-hidden="true">♡</span><h3>Ações com benefícios</h3><p>Converse sobre campanhas com vantagens para clientes, orçamento e regras previamente combinados.</p><button type="button" onclick="openSponsorContact('relationship')">Conversar sobre benefícios <span aria-hidden="true">→</span></button></article>
  <article><span>03 / COMÉRCIO LOCAL</span><span class="sponsor-premium-format-icon" aria-hidden="true">◇</span><h3>Parceria regional</h3><p>Estude ações com revendas elegíveis, quando houver parceiros e operação disponíveis na cidade.</p><button type="button" onclick="openSponsorContact('local')">Explorar parceria regional <span aria-hidden="true">→</span></button></article>
 </div>
 <p class="sponsor-premium-format-note">Para criar um anúncio independente, use o formulário abaixo. As outras opções começam com uma conversa sem compromisso.</p>
</section>
<section class="sponsor-premium-how" aria-label="Como criar um anúncio">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">DO RASCUNHO À PUBLICAÇÃO</span><h2>Você sabe o que acontece em cada etapa.</h2></div>
 <ol class="sponsor-premium-steps">
  <li><span>01</span><div><h3>Prepare a proposta</h3><p>Personalize a marca, escolha cidade e orçamento e confirme sua conta.</p></div></li>
  <li><span>02</span><div><h3>Receba a análise</h3><p>O TAMÃO revisa o conteúdo. Depois, você pode carregar créditos por Pix e acompanhar o saldo.</p></div></li>
  <li><span>03</span><div><h3>Divulgue com controle</h3><p>Com anúncio publicado e crédito disponível, acompanhe visualizações elegíveis e descontos no extrato. Pause quando quiser.</p></div></li>
 </ol>
</section>
<section class="sponsor-premium-workspace" id="sponsor-pricing" tabindex="-1" aria-label="Planejar e cadastrar anúncio">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">CRIE SUA CAMPANHA</span><h2>Comece com uma proposta clara.</h2><p>Envie a peça para análise e acompanhe o saldo de publicidade na sua conta, sem pacote de dias.</p></div>
 <div id="tamao-credit-mount" aria-live="polite"></div>
 ${(globalThis.tamaoAdsPlannerLoad?.(),globalThis.tamaoAdsPlannerSection?.()||'<p role="status">Carregando opções de campanha…</p>')}
</section>
<section class="sponsor-premium-faq" id="sponsor-faq" tabindex="-1" aria-label="Dúvidas de quem anuncia">
 <div class="sponsor-premium-section-heading"><span class="section-kicker">TRANSPARÊNCIA</span><h2>Respostas para anunciar com confiança.</h2></div>
 <div class="sponsor-premium-faq-list">
  <details><summary>Preciso ter uma revenda no TAMÃO?</summary><p>Não. Marcas, empresas e profissionais podem enviar anúncios independentes para análise.</p></details>
  <details><summary>Quanto custa anunciar?</summary><p>R$ 0,02 por visualização elegível. As recargas começam em R$ 19,90 e o saldo fica disponível para anúncios, sem pacote de dias. Por exemplo, R$ 19,90 pode cobrir até 995 visualizações faturáveis, se houver audiência. Não é uma promessa de alcance.</p></details>
   <details><summary>Quando uma visualização é cobrada?</summary><p>Após a exibição de pelo menos 50% do anúncio por um segundo contínuo e as verificações do servidor. O sistema evita cobrar novamente a mesma identidade de visitante na mesma campanha durante 24 horas. Os critérios não representam certificação independente de audiência.</p></details>
  <details><summary>Quantas pessoas verão meu anúncio?</summary><p>Não prometemos audiência, cliques ou conversões. A entrega depende de inventário disponível, e os sinais de visualização seguem os critérios de medição informados.</p></details>
  <details><summary>O anúncio vai ao ar quando eu envio?</summary><p>Não. Primeiro a campanha é revisada; a publicação depende da aprovação e das condições operacionais e comerciais.</p></details>
  <details><summary>Como acompanho a campanha?</summary><p>Com e-mail confirmado, acompanhe saldo, extrato, visualizações cobradas e situação das campanhas na mesma área.</p></details>
 </div>
</section>
<section class="sponsor-premium-closing" aria-label="Comece a divulgar sua empresa">
 <div><span class="section-kicker">SUA MARCA MERECE DESTAQUE</span><h2>Comece com uma apresentação que passa confiança.</h2><p>Prepare seu anúncio ou converse sobre uma ação regional. O primeiro contato não gera cobrança.</p></div>
 <div class="sponsor-premium-closing-actions"><button type="button" class="primary" onclick="sponsorJumpTo('sponsor-pricing')">Preparar meu anúncio <span aria-hidden="true">→</span></button><button type="button" class="secondary" onclick="openSponsorContact()">Conversar sobre publicidade</button></div>
</section>
</section>`);
}


globalThis.tamaoSponsorPremiumLanding=sponsorsLandingPremium;
globalThis.sponsorJumpTo=sponsorJumpTo;

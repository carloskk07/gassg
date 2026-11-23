/* V1.1164 — Clube premium, lazy-loaded only on #club. Finance and auth are owned by existing modules. */
function clubPremiumPage(){
const u=globalThis.liveRuntime?.session?.user;
const member=globalThis.__CHAMA_TEST__||(globalThis.liveReady?.()&&u?.id&&u.email_confirmed_at&&u.is_anonymous!==true);
if(globalThis.document&&!globalThis.cshop){
globalThis.cshop=1;import('/js/clube-coupon-shop.js').then(render,()=>globalThis.cshop=0);
}
globalThis.clubeCouponWatchAuth?.();
// V1.1164: Decorative icons share one finished style and never impersonate a real offer.
const clubPremiumIcon=kind=>{
 const paths={
  ticket:'<path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6V5Z" fill="currentColor" opacity=".22"/><path d="M9 5v14M13 8.5h4M13 12h4M13 15.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  wallet:'<rect x="3" y="5" width="18" height="15" rx="3" fill="currentColor" opacity=".2"/><path d="M3 9.5h18M14.5 13h4.2v3.2h-4.2a1.6 1.6 0 0 1 0-3.2Z" fill="currentColor"/>',
  shield:'<path d="M12 2 20 5v6.7c0 4.8-3 8.4-8 10.3C7 20.1 4 16.5 4 11.7V5l8-3Z" fill="currentColor" opacity=".2"/><path d="m8 11.9 2.6 2.5 5.5-5.7" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  receipt:'<path d="M5 2.8h14v19l-3.4-1.7-3.6 1.7-3.5-1.7L5 21.8v-19Z" fill="currentColor" opacity=".2"/><path d="M8.5 8.3h7M8.5 12.3h7M8.5 16.3h4" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
  pin:'<path d="M12 22c4.5-5.8 7-9.4 7-13a7 7 0 1 0-14 0c0 3.6 2.5 7.2 7 13Z" fill="currentColor" opacity=".18"/><circle cx="12" cy="9" r="2.8" fill="currentColor"/>'
 };
 return '<svg class="club-premium-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'+(paths[kind]||paths.receipt)+'</svg>';
};
// A public verified-price card may only be unhidden by the canonical live catalog.
// The account form preserves its exact IDs, names, intents and Turnstile workflow.
if(!member)return shell(`<section class="page tamao-club-visitor tamao-club-premium club-premium-visitor" aria-label="Clube TAMÃO — benefícios e acesso">
<header class="tamao-club-visitor-focus club-premium-hero">
 <div class="tamao-club-visitor-hero club-premium-hero-copy">
  <span class="eyebrow club-premium-eyebrow"><span class="club-premium-mark" aria-hidden="true"></span> CLUBE TAMÃO / VANTAGENS LOCAIS</span>
  <h1>Suas compras podem render muito mais no Clube TAMÃO.<em> Com benefícios claros, do início ao fim.</em></h1>
  <p class="club-premium-lead">Cupons, cashback elegível e oportunidades da sua cidade. Consulte as condições, veja o que está disponível para você e acompanhe tudo na sua conta.</p>
  <div class="club-premium-actions">
   <button type="button" class="club-premium-button club-premium-primary" onclick="document.getElementById('club-premium-account')?.scrollIntoView({behavior:'smooth',block:'start'})">Acessar meu Clube <span aria-hidden="true">→</span></button>
   <button type="button" class="club-premium-button club-premium-outline" onclick="document.getElementById('club-premium-benefits')?.scrollIntoView({behavior:'smooth',block:'start'})">Conhecer os benefícios</button>
  </div>
  <div class="club-premium-trustline" aria-label="Compromissos do Clube"><span>${clubPremiumIcon('shield')} Cadastro identificado</span><span>${clubPremiumIcon('receipt')} Condições visíveis</span><span>${clubPremiumIcon('pin')} Vantagens por região</span></div>
  <div class="club-premium-message"><span class="club-premium-message-symbol">${clubPremiumIcon('shield')}</span><p><strong>Sem surpresas.</strong> Entrar no Clube não gera cobrança. Cupons e cashback dependem de regras, disponibilidade e validações próprias.</p></div>
 </div>
 <aside class="club-premium-entry-card" id="club-premium-account" aria-labelledby="club-premium-account-title">
  <div class="club-premium-card-top"><span class="club-premium-card-monogram">T<span>•</span></span><span>ACESSO AO CLUBE</span></div>
  <h2 id="club-premium-account-title">Sua conta. Suas vantagens.</h2>
  <p>Entre com seu e-mail ou faça seu primeiro cadastro. O acesso é confirmado pela sua caixa de entrada.</p>
  <form class="form-stack tamao-club-access" data-tamao-account-context="club" onsubmit="return tamaoWelcomeRegister(event)">
   <label for="clube-visitor-coupon-name">Nome e sobrenome (para criar conta)</label>
   <input id="clube-visitor-coupon-name" name="full_name" class="input" type="text" autocomplete="name" placeholder="Como podemos chamar você?" maxlength="100">
   <label for="clube-visitor-coupon-phone">Telefone com DDD (para criar conta)</label>
   <input id="clube-visitor-coupon-phone" name="phone" class="input" type="tel" inputmode="tel" autocomplete="tel" placeholder="(55) 99999-9999" maxlength="18">
   <label for="clube-visitor-coupon-email">Seu e-mail</label>
   <input id="clube-visitor-coupon-email" name="email" class="input" type="email" autocomplete="email" placeholder="voce@email.com" maxlength="160" required>
   <button type="submit" class="primary" name="intent" value="login">Entrar no meu Clube →</button>
   <button type="submit" class="secondary tamao-club-register" name="intent" value="register">Primeiro acesso? Criar minha conta</button>
   <p data-welcome-signup-status role="status" aria-live="polite"></p>
   <small>Confira sua caixa de entrada para confirmar o acesso. Não solicitamos senha nem pagamento para entrar.</small>
  </form>
 </aside>
</header>
<div class="club-premium-trustbar" aria-label="Como protegemos seus benefícios"><span>${clubPremiumIcon('receipt')} <strong>Histórico na sua conta</strong> para consultar o que foi reconhecido</span><span>${clubPremiumIcon('shield')} <strong>Sem crédito fictício:</strong> benefícios passam por validação</span><span>${clubPremiumIcon('pin')} <strong>Uso regional:</strong> disponibilidade depende do CEP</span></div>
<aside class="tamao-coupon-price-board card form-stack" hidden aria-label="Pacote de cupons com preço confirmado" id="club-premium-offers">
 <div class="club-premium-offer-heading"><span class="section-kicker">PACOTE DE CUPONS · CATÁLOGO CONFERIDO</span><h2>Condições do pacote em destaque</h2><p>O preço e as condições abaixo vêm do catálogo oficial, não de um exemplo.</p></div>
 <div class="club-premium-offer-data"><p class="tamao-club-face" data-coupon-face></p><p class="tamao-club-offer-label">Preço do pacote: <strong data-coupon-price></strong></p><p data-coupon-minimum></p><p data-coupon-availability></p></div>
 <details class="tamao-benefits-details"><summary>Regras, validade e disponibilidade</summary><p class="tiny">Ter um pacote não garante ofertas ou revendas disponíveis no seu CEP. Veja validade e condições ao usar. Entrar não gera cobrança. Confira no Clube se a compra está habilitada antes de pagar.</p></details>
</aside>
<section id="club-premium-benefits" class="club-premium-benefits" aria-labelledby="club-premium-benefits-title">
 <div class="club-premium-section-heading"><span class="club-premium-section-index">01 / O QUE VOCÊ ENCONTRA</span><h2 id="club-premium-benefits-title">Benefícios compreensíveis.<br><em>Sem letras miúdas escondidas.</em></h2><p>São modalidades diferentes. Cada vantagem tem uma condição, um momento de validação e um histórico próprio.</p></div>
 <div class="grid cards-3 tamao-club-visitor-grid club-premium-benefit-grid" aria-label="Vantagens do Clube">
  <article class="card club-premium-benefit"><span class="club-premium-feature-icon">${clubPremiumIcon('ticket')}</span><span class="club-premium-card-counter">01 / CUPONS</span><h3>Descontos para aproveitar</h3><p>Veja pacotes elegíveis, valor, quantidade, prazo e pedido mínimo. Um cupom só pode ser usado quando as regras e a cobertura permitirem.</p><div class="club-premium-benefit-foot">Condições antes da compra</div></article>
  <article class="card club-premium-benefit"><span class="club-premium-feature-icon">${clubPremiumIcon('wallet')}</span><span class="club-premium-card-counter">02 / CASHBACK</span><h3>Cashback para voltar</h3><p>Créditos de compras elegíveis aparecem no saldo após a confirmação aplicável. Valores em análise e compensações não são dinheiro disponível.</p><div class="club-premium-benefit-foot">Saldo conferido na conta</div></article>
  <article class="card club-premium-benefit"><span class="club-premium-feature-icon">${clubPremiumIcon('receipt')}</span><span class="club-premium-card-counter">03 / TRANSPARÊNCIA</span><h3>Mais controle da sua economia</h3><p>Compare o preço total por CEP, acompanhe suas compras concluídas e consulte a origem dos benefícios reconhecidos.</p><div class="club-premium-benefit-foot">Origem e validade acessíveis</div></article>
 </div>
</section>
<section class="club-premium-how" aria-labelledby="club-premium-how-title">
 <div class="club-premium-section-heading"><span class="club-premium-section-index">02 / SIMPLES NA PRÁTICA</span><h2 id="club-premium-how-title">Da descoberta ao benefício.<br><em>Sem complicação.</em></h2></div>
 <ol class="club-premium-steps">
  <li><span class="club-premium-step-number">01</span><div><h3>Entre na sua conta</h3><p>Identifique-se e confirme o e-mail. Sua carteira e seus cupons ficam vinculados à sua conta.</p></div></li>
  <li><span class="club-premium-step-number">02</span><div><h3>Confira a condição</h3><p>Verifique preço, CEP, prazo, pedido mínimo e disponibilidade real antes de decidir.</p></div></li>
  <li><span class="club-premium-step-number">03</span><div><h3>Acompanhe o resultado</h3><p>Cupons emitidos, uso e cashback elegível ficam registrados conforme as validações.</p></div></li>
 </ol>
</section>
<section class="club-premium-faq" aria-labelledby="club-premium-faq-title">
 <div class="club-premium-section-heading"><span class="club-premium-section-index">03 / TRANSPARÊNCIA</span><h2 id="club-premium-faq-title">Dúvidas importantes.<br><em>Respostas sem enrolação.</em></h2><p>Consulte as condições completas antes de adquirir um pacote ou usar qualquer benefício.</p><button type="button" class="club-premium-text-action" onclick="go('terms')">Ler os Termos de Uso <span aria-hidden="true">→</span></button></div>
 <div class="club-premium-faq-items">
  <details><summary>Preciso pagar para entrar no Clube?<span aria-hidden="true">+</span></summary><p>Não. O cadastro e a consulta ao Clube não geram cobrança. Pacotes de cupons, quando habilitados, possuem preço e condições próprios.</p></details>
  <details><summary>Posso utilizar cupons em qualquer cidade?<span aria-hidden="true">+</span></summary><p>Não necessariamente. A utilização depende de revendas elegíveis, produtos e atendimento ao seu CEP, além de prazo e pedido mínimo de cada cupom.</p></details>
  <details><summary>Cashback é dinheiro disponível para saque?<span aria-hidden="true">+</span></summary><p>Não. Cashback elegível é crédito para uso nas compras permitidas. Créditos pendentes, revertidos ou destinados a compensação não estão disponíveis.</p></details>
  <details><summary>O que ocorre se um pacote não puder ser utilizado?<span aria-hidden="true">+</span></summary><p>Confira as condições do pacote e os direitos de cancelamento ou reembolso aplicáveis. O histórico da compra e o atendimento ficam disponíveis na conta.</p></details>
  <details><summary>Quando vou encontrar ofertas perto de mim?<span aria-hidden="true">+</span></summary><p>As ofertas variam conforme a cidade e a revenda. A plataforma só apresenta disponibilidade de compra quando existe oferta operacional elegível.</p></details>
 </div>
</section>
<footer class="club-premium-final">
 <div><span class="club-premium-section-index">CLUBE TAMÃO</span><h2>Vantagens começam com <em>informação clara.</em></h2><p>Consulte sua conta, veja o que está liberado e escolha com segurança.</p></div>
 <button type="button" class="club-premium-button club-premium-primary" onclick="document.getElementById('club-premium-account')?.scrollIntoView({behavior:'smooth',block:'start'})">Entrar no meu Clube <span aria-hidden="true">→</span></button>
</footer>
</section>`);
const purchases=Math.max(0,Number(state.user.purchases)||0);
const cycle=purchases===0?0:(purchases%5||5);
const pct=cycle*20;
const next=purchases>0&&cycle===5?'Ciclo completo — a próxima compra inicia um novo ciclo':`${cycle} de 5 compras no ciclo atual`;
const debt=Math.max(0,Number(state.user.cashbackDebt)||0);
const comparisonSavings=Math.max(0,Number(globalThis.liveRuntime?.comparisonSavingsCents||0))/100;
const cashbackEarned=Math.max(0,Number(globalThis.liveRuntime?.cashbackEarnedCents||0))/100;
return shell(`<section class="page tamao-club-premium club-premium-member" aria-labelledby="club-member-title">
<header class="club-premium-member-hero">
 <div class="club-premium-member-intro">
  <span class="club-premium-section-index">MEU CLUBE / VANTAGENS DA SUA CONTA</span>
  <h1 id="club-member-title">A sua economia.<br><em>Com cada detalhe à vista.</em></h1>
  <p>Consulte cupons, acompanhe cashback elegível e veja o histórico dos benefícios associados às suas compras. Os valores só ficam disponíveis conforme as regras de validação.</p>
  <div class="club-premium-member-hero-actions">
   <button class="club-premium-button club-premium-light" type="button" onclick="document.getElementById('club-member-coupons')?.scrollIntoView({behavior:'smooth',block:'start'})">Consultar meus cupons <span aria-hidden="true">↓</span></button>
   <button class="club-premium-button club-premium-member-outline" type="button" onclick="go('refer')">Minha Rede e extrato <span aria-hidden="true">→</span></button>
  </div>
 </div>
 <div class="reward-hero club-premium-member-balance" aria-label="Resumo do cashback disponível">
  <div class="club-premium-balance-label">SEU CASHBACK DISPONÍVEL</div>
  <div class="balance">${BRL.format(state.user.cashback)}</div>
  <p>Crédito para utilizar em compras elegíveis, não valor para saque.</p>
  <div class="club-premium-cycle"><div class="club-premium-cycle-heading"><span>ACOMPANHAMENTO DE COMPRAS</span><small>${esc(next)}</small></div><div class="progress" role="progressbar" aria-label="Progresso do ciclo de cinco compras" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div></div>
 </div>
</header>
<section class="club-premium-statistics" aria-label="Resumo de benefícios reconhecidos">
 <article><span>Economia nas comparações</span><strong>${BRL.format(comparisonSavings)}</strong><small>Diferença registrada contra a alternativa mais cara exibida nas consultas que viraram pedidos concluídos.</small></article>
 <article><span>Cashback já gerado</span><strong>${BRL.format(cashbackEarned)}</strong><small>Créditos válidos historicamente, inclusive a parte eventualmente já utilizada.</small></article>
 <article><span>Seu histórico</span><strong>Na sua conta</strong><small>Consulte cupons, compras e extrato por origem. Cada modalidade segue regras próprias.</small></article>
</section>
${debt>0?`<div class="notice club-premium-compensation" role="status"><strong>${BRL.format(debt)} em compensação.</strong><p>Esse valor corresponde a cashback de uma compra posteriormente revertida. Novos créditos reduzem essa compensação antes de ficarem disponíveis.</p></div>`:''}
<section class="club-premium-private-section" id="club-member-coupons" aria-label="Meus cupons e pacotes">
 <div class="club-premium-section-heading"><span class="club-premium-section-index">01 / SUA CARTEIRA</span><h2>Cupons e histórico.<br><em>Tudo organizado.</em></h2><p>Consulte apenas os benefícios vinculados à sua conta. As emissões e os pagamentos são verificados pelo sistema.</p></div>
 ${clubePaidCouponPanel()}
</section>
<section class="club-premium-private-section club-premium-shop-section" aria-label="Pacotes de cupons e condições">
 <div class="club-premium-section-heading"><span class="club-premium-section-index">02 / CONDIÇÕES DISPONÍVEIS</span><h2>Confira antes<br><em>de escolher.</em></h2><p>Se houver pacotes liberados, consulte o preço, a validade, o pedido mínimo e a cobertura do CEP antes de pagar.</p></div>
 ${typeof clubeCouponShopPanel==='function'?clubeCouponShopPanel():''}
</section>
<section class="tamao-club-shop-now club-premium-shopping-action" aria-label="Usar as vantagens do Clube">
 <div><span class="club-premium-section-index">03 / USAR SUAS VANTAGENS</span><h2>Compare o preço total e escolha a compra certa para você.</h2><p>Consulte as revendas que atendem seu endereço, confirme os produtos e aproveite o cashback disponível quando elegível.</p></div>
 <button type="button" class="primary" onclick="go('home')">Encontrar produtos <span aria-hidden="true">→</span></button>
</section>
<section class="club-premium-member-options" aria-label="Vantagens complementares">
 <article><span class="club-premium-feature-icon">${clubPremiumIcon('wallet')}</span><h3>Cashback para voltar</h3><p>Nas compras elegíveis, parte do valor pode retornar como crédito para novas compras após as verificações.</p></article>
 <article><span class="club-premium-feature-icon">${clubPremiumIcon('receipt')}</span><h3>Seus pedidos, seu controle</h3><p>Reveja suas compras e as condições aplicáveis aos benefícios registrados.</p></article>
 <article><span class="club-premium-feature-icon">${clubPremiumIcon('pin')}</span><h3>Uma Rede local</h3><p>Compartilhe seu link pessoal e acompanhe as indicações qualificadas em sua área da Rede.</p><button type="button" class="club-premium-text-action" onclick="go('earn')">Conhecer a Rede <span aria-hidden="true">→</span></button></article>
</section>
</section>`)
}

// The editorial theme is fetched only by #club, without affecting home or checkout startup.
if(typeof document!=='undefined'&&!document.querySelector('link[data-tamao-club-premium]')){
 const link=document.createElement('link');
 link.rel='stylesheet';
 link.setAttribute('data-tamao-club-premium','');
 link.href='./css/club-premium.css?v=1164';
 link.onload=()=>{if(typeof route==='function'&&route()==='club')render();};
 document.head.appendChild(link);
}
globalThis.clubPremiumPage=clubPremiumPage;

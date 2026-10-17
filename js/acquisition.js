
function rememberedMarketRegion(postal=state.postalCode){
  try{
    const cached=JSON.parse(localStorage.getItem('tamao-market-region-v1')||'null');
    if(cached?.postalCode!==String(postal||'').replace(/\D/g,''))return null;
    if(!/^[A-Z]{2}$/.test(String(cached.state||'')))return null;
    const city=String(cached.city||'').trim().slice(0,120);
    return city.length>=2?{city,state:cached.state}:null;
  }catch{return null}
}
function rememberMarketRegion(region,postalCode){
  const postal=String(postalCode||'').replace(/\D/g,'');
  const city=String(region?.city||'').trim().slice(0,120);
  const state=String(region?.state||'').trim().toUpperCase();
  if(!/^[0-9]{8}$/.test(postal)||city.length<2||!/^[A-Z]{2}$/.test(state))return;
  try{
    localStorage.setItem('tamao-market-region-v1',JSON.stringify({postalCode:postal,city,state}));
    localStorage.removeItem?.(TAMAO_HOME_REGION_KEY);
  }catch{}
}


const TAMAO_HOME_REGION_KEY='tamao-home-region-v1-341';
function homeMarketRegion(){
  // An explicit visitor choice overrides older CEP cache until the next
  // successfully validated CEP refreshes this choice.
  try{
    const saved=JSON.parse(localStorage.getItem(TAMAO_HOME_REGION_KEY)||'null');
    if(/^[A-Z]{2}$/.test(String(saved?.state||''))&&
      /^[\p{L}\p{M} .'-]{2,80}$/u.test(String(saved?.city||'')))
      return {city:saved.city,state:saved.state,origin:'chosen'};
  }catch{}
  const confirmed=rememberedMarketRegion();
  if(confirmed)return {...confirmed,origin:'confirmed'};
  // São Gabriel is the launch *showcase*, not a geolocation assertion.
  return {city:'São Gabriel',state:'RS',origin:'showcase'};
}
function homeChooseMarketCity(){
  const name=String(document.getElementById('home-city-name')?.value||'').trim();
  const uf=String(document.getElementById('home-city-uf')?.value||'').trim().toUpperCase();
  if(!/^[\p{L}\p{M} .'-]{2,80}$/u.test(name)||!/^[A-Z]{2}$/.test(uf))
    return toast('Informe o nome da cidade e a sigla do estado.');
  try{localStorage.setItem(TAMAO_HOME_REGION_KEY,JSON.stringify({city:name,state:uf}))}catch{}
  // Changing a showcase never transfers cart, verified CEP, address or a quote.
  if(globalThis.liveRuntime)globalThis.liveRuntime.cityPriceSnapshot=null;
  render();
  const pending=globalThis.liveRefreshCityPriceBoard?.({force:true});
  pending?.then?.(()=>render()).catch?.(()=>{});
}

function prelaunchLeadSent(type){
  try{
    const saved=localStorage.getItem('tamao-prelaunch-'+type+'-sent-v1');
    if(type!=='customer')return saved==='1';
    const postal=leadPostalDigits(state.postalCode||'');
    return postal.length===8&&saved===postal;
  }catch{return false}
}
function markPrelaunchLeadSent(type){
  try{
    const value=type==='customer'?leadPostalDigits(document.querySelector('#prelaunch-postal')?.value||state.postalCode||''):'1';
    localStorage.setItem('tamao-prelaunch-'+type+'-sent-v1',value);
  }catch{}
}
function leadCheckedValues(name){
  return [...document.querySelectorAll('input[name="'+name+'"]:checked')].map(el=>String(el.value||''));
}
function leadPhoneDigits(value){
  return String(value||'').replace(/\D/g,'').slice(0,13);
}
function leadPostalDigits(value){
  return String(value||'').replace(/\D/g,'').slice(0,8);
}
function openPrelaunchCustomerLead(){
  const postalSource=document.querySelector('#home-address')||document.querySelector('#postal-code');
  const typed=String(postalSource?.value||'').trim();
  const enteredPostal=leadPostalDigits(typed);
  if(typed&&enteredPostal.length!==8){
    postalSource?.focus();
    return toast('Informe um CEP válido com 8 dígitos');
  }
  if(enteredPostal.length===8&&enteredPostal!==leadPostalDigits(state.postalCode||'')){
    state.postalCode=enteredPostal;
    state.address='';
    state.addressNumber='';
    save();
    render(); // New CEP must not inherit a previous regional notification.
  }
  const section=document.getElementById('early-access');
  if(!section){
    if(route()!=='home')go('home');
    setTimeout(()=>{
      if(route()!=='home')return;
      const targetSection=document.getElementById('early-access');
      if(!targetSection)return;
      const target=document.querySelector('#prelaunch-postal');
      const postal=leadPostalDigits(state.postalCode||'');
      if(target&&postal.length===8)target.value=postal.replace(/^(\d{5})(\d{3})$/,'$1-$2');
      targetSection.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(()=>document.querySelector('#prelaunch-phone')?.focus(),250);
    },120);
    return;
  }
  const source=document.querySelector('#home-address');
  const target=document.querySelector('#prelaunch-postal');
  const postal=leadPostalDigits(source?.value||state.postalCode||'');
  if(target&&postal.length===8)target.value=postal.replace(/^(\d{5})(\d{3})$/,'$1-$2');
  section.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>document.querySelector('#prelaunch-phone')?.focus(),350);
}
function prelaunchTransparencyBand(){
  return [
    '<section class="section prelaunch-transparency" aria-label="Atendimento TAMÃO">',
      '<div class="section-head"><div><span class="section-kicker">ATENDIMENTO POR REGIÃO</span><h2>Veja se já há entrega para o seu CEP.</h2><p>Informe seu CEP para conferir se alguma revenda atende o seu endereço.</p></div></div>',
      '<div class="prelaunch-transparency-grid">',
        '<article><span class="prelaunch-step">1</span><div><strong>Atendimento na sua região</strong><p>Você consulta o endereço e vê se há uma revenda disponível para entregar.</p></div></article>',
        '<article><span class="prelaunch-step">2</span><div><strong>Revendas cadastradas</strong><p>Antes de aparecer nas ofertas, a empresa precisa concluir o cadastro e as verificações necessárias.</p></div></article>',
        '<article><span class="prelaunch-step">3</span><div><strong>Ainda não há entrega?</strong><p>Você pode deixar seu WhatsApp para pedir um aviso quando houver atendimento no seu CEP.</p></div></article>',
      '</div>',
    '</section>'
  ].join('');
}

function customerLeadInterestSelection(cart=state.cart){
  const codes=Object.entries(cart||{}).filter(([,qty])=>Number(qty)>0)
    .map(([code])=>String(code||'').trim().toUpperCase())
    .filter(code=>!code.endsWith('_CONTAINER'));
  if(!codes.length)return new Set(['gas']);
  const interests=new Set();
  for(const code of codes){
    const category=String(products[code]?.categoryKey||'').toLowerCase();
    if(/^P[0-9]+$/.test(code)||category==='glp')interests.add('gas');
    else if(code==='WATER20'||category==='water')interests.add('water');
    else if(code==='CHARCOAL4')interests.add('charcoal');
    else if(code==='WOOD')interests.add('firewood');
    else if(code==='ICE5'||category==='ice')interests.add('ice');
    else interests.add('other');
  }
  return interests;
}
function prelaunchCustomerLeadSection(){
  const selectedInterests=customerLeadInterestSelection();
  const checkedInterest=key=>selectedInterests.has(key)?' checked':'';
  const verifiedRegion=rememberedMarketRegion();
  const friendlyCity=verifiedRegion?esc(verifiedRegion.city):'sua região';
  if(prelaunchLeadSent('customer')){
    return '<section class="section lead-section" id="early-access"><div class="lead-success-card"><span class="lead-success-icon">✓</span><div><span class="section-kicker">AVISO DE DISPONIBILIDADE</span><h2>Seu pedido de aviso para '+friendlyCity+' foi recebido.</h2><p>Seu WhatsApp já está cadastrado para este CEP. Quando houver atendimento, poderemos avisar você por lá.</p></div><button class="secondary" onclick="go(\'learn\')">Conhecer o TAMÃO</button></div></section>';
  }
  const rawPostal=leadPostalDigits(state.postalCode||'');
  const postal=rawPostal.length===8?rawPostal.replace(/^(\d{5})(\d{3})$/,'$1-$2'):rawPostal;
  return [
    '<section class="section lead-section" id="early-access"><div class="lead-shell">',
      '<div class="lead-copy"><span class="section-kicker">CONSULTAR DISPONIBILIDADE</span><h2>Ainda não encontrou entrega em '+friendlyCity+'?</h2>',
      '<p>Informe seu CEP e WhatsApp para solicitar um aviso quando alguma revenda passar a atender seu endereço.</p>',
      '<div class="lead-proof"><span>✓ Sem custo para pedir aviso</span><span>✓ Sem compromisso de compra</span></div></div>',
      '<div class="lead-form card flat customer-lead-form">',
        '<div class="input-wrap"><label for="prelaunch-phone">Seu WhatsApp</label><input id="prelaunch-phone" class="input" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="(55) 99999-9999" required aria-required="true" aria-describedby="customer-phone-hint"><small class="field-hint" id="customer-phone-hint">Usaremos este número para avisar quando houver atendimento no seu CEP.</small></div>',
        '<div class="input-wrap"><label for="prelaunch-name">Seu nome <small>(opcional)</small></label><input id="prelaunch-name" class="input" maxlength="120" autocomplete="name" placeholder="Como podemos chamar você?"></div>',
        '<div class="input-wrap"><label for="prelaunch-postal">CEP onde você quer receber</label><input id="prelaunch-postal" class="input" maxlength="9" inputmode="numeric" autocomplete="postal-code" value="'+esc(postal)+'" placeholder="97300-000"></div>',
        '<fieldset class="lead-interests"><legend>O que você gostaria de pedir?</legend>',
          '<label><input type="checkbox" name="prelaunch-interest" value="gas"'+checkedInterest('gas')+'><span>🔥 Gás</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="water"'+checkedInterest('water')+'><span>💧 Água</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="charcoal"'+checkedInterest('charcoal')+'><span>🔥 Carvão</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="firewood"'+checkedInterest('firewood')+'><span>🪵 Lenha</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="ice"'+checkedInterest('ice')+'><span>🧊 Gelo</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="other"'+checkedInterest('other')+'><span>＋ Outros</span></label>',
        '</fieldset>',
        '<input id="prelaunch-website" class="lead-trap" tabindex="-1" autocomplete="off" aria-hidden="true" aria-label="Não preencher este campo" name="website" value="">',
        '<label class="check-row lead-consent"><input id="prelaunch-consent" type="checkbox"><span><strong>Quero receber um aviso de disponibilidade pelo WhatsApp.</strong><small>Usaremos estes dados somente para informar disponibilidade e atendimento. Nenhuma compra é criada por este cadastro.</small></span></label><div class="lead-privacy-note">Saiba como tratamos seus dados no <button class="text-link" onclick="go(\'privacy\')">Aviso de Privacidade</button>.</div>',
        '<button id="prelaunch-submit" class="primary full" onclick="submitPrelaunchCustomerLead()">Me avise quando puder pedir →</button>',
        '<div id="prelaunch-result" class="lead-result" role="status" aria-live="polite"></div>',
      '</div></div>',
      '<div class="lead-partner-link"><span>Tem uma revenda ou comércio local?</span><button class="ghost small" onclick="go(\'merchants\')">Quero vender no TAMÃO →</button></div>',
    '</section>'
  ].join('');
}
async function submitPrelaunchCustomerLead(){
  const button=document.querySelector('#prelaunch-submit');
  const result=document.querySelector('#prelaunch-result');
  if(button?.disabled)return;
  const phone=leadPhoneDigits(document.querySelector('#prelaunch-phone')?.value);
  const postalCode=leadPostalDigits(document.querySelector('#prelaunch-postal')?.value);
  const contactName=String(document.querySelector('#prelaunch-name')?.value||'').trim();
  const interests=leadCheckedValues('prelaunch-interest');
  const consent=document.querySelector('#prelaunch-consent')?.checked===true;
  const website=String(document.querySelector('#prelaunch-website')?.value||'');
  if(phone.length<10||phone.length>13)return toast('Informe um WhatsApp válido com DDD');
  if(postalCode.length!==8)return toast('Informe um CEP válido');
  if(!interests.length)return toast('Marque pelo menos um produto de interesse');
  if(!consent)return toast('Confirme que podemos avisar você pelo WhatsApp');
  if(!globalThis.prelaunchLeadSubmit)return toast('Cadastro temporariamente indisponível');
  const oldText=button?.textContent||'Quero receber aviso de disponibilidade';
  if(button){button.disabled=true;button.textContent='Salvando…'}
  if(result){result.textContent='';result.className='lead-result'}
  try{
    const data=await globalThis.prelaunchLeadSubmit({leadType:'customer',contactName,phone,postalCode,interests,consent,website});
    markPrelaunchLeadSent('customer');
    if(data?.region){
      state.postalCode=postalCode;
      rememberMarketRegion(data.region,postalCode);
      save();
    }
    if(result){result.textContent=String(data?.message||'Cadastro recebido.');result.className='lead-result success'}
    if(button)button.textContent='Cadastro recebido ✓';
  }catch(error){
    if(result){result.textContent=String(error?.message||'Não foi possível salvar agora.');result.className='lead-result error'}
    if(button){button.disabled=false;button.textContent=oldText}
  }
}
function prelaunchMerchantLeadSection(){
  if(prelaunchLeadSent('merchant')){
    return '<section class="section" id="partner-interest"><div class="lead-success-card partner"><span class="lead-success-icon">✓</span><div><span class="section-kicker">CADASTRO DE PARCEIRO</span><h2>Recebemos os dados da sua empresa.</h2><p>Obrigado pelo contato. Se precisarmos de mais informações, poderemos conversar pelo WhatsApp que você informou.</p></div></div></section>';
  }
  return [
    '<section class="section" id="partner-interest"><div class="partner-lead-shell">',
      '<div class="lead-copy"><span class="section-kicker">VENDA PELO TAMÃO</span><h2>Quer vender pelo TAMÃO?</h2>',
      '<p>Conte o que sua empresa vende e como podemos falar com você. O cadastro de interesse não ativa vendas nem cria cobranças.</p>',
      '<div class="lead-proof"><span>✓ Você mantém o controle da revenda</span><span>✓ Sem mensalidade no modelo atual</span><span>✓ Você decide quais pedidos aceitar</span></div></div>',
      '<div class="lead-form card flat partner-lead-form">',
        '<div class="merchant-lead-form-head"><strong>Vamos começar?</strong><small>Informe os dados para contato. Você não precisa configurar sua operação agora.</small></div>',
        '<div class="input-wrap"><label for="partner-business">Nome da empresa</label><input id="partner-business" class="input" maxlength="120" autocomplete="organization" placeholder="Nome da revenda ou comércio"></div>',
        '<div class="field-row"><div class="input-wrap"><label for="partner-name">Seu nome</label><input id="partner-name" class="input" maxlength="120" autocomplete="name" placeholder="Responsável"></div>',
        '<div class="input-wrap"><label for="partner-phone">WhatsApp</label><input id="partner-phone" class="input" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="(55) 99999-9999"></div></div>',

        '<fieldset class="lead-interests"><legend>O que sua empresa vende?</legend>',
          '<label><input type="checkbox" name="partner-interest" value="gas"><span>🔥 Gás</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="water"><span>💧 Água</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="charcoal"><span>🔥 Carvão</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="firewood"><span>🪵 Lenha</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="ice"><span>🧊 Gelo</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="other"><span>＋ Outros</span></label>',
        '</fieldset>',
        '<details class="merchant-lead-options"><summary>Adicionar CEP ou detalhes da operação <span>(opcional)</span></summary><div class="merchant-lead-options-fields">',
'<div class="input-wrap"><label for="partner-postal">CEP da empresa <small>(opcional)</small></label><input id="partner-postal" class="input" maxlength="9" inputmode="numeric" autocomplete="postal-code" placeholder="97300-000"></div>',
'<div class="input-wrap"><label for="partner-note">Algo que devemos saber? <small>(opcional)</small></label><textarea id="partner-note" class="input" rows="2" maxlength="500" placeholder="Ex.: atendemos vários bairros da nossa cidade; temos frota própria."></textarea></div>',
        '</div></details>',
        '<input id="partner-website" class="lead-trap" tabindex="-1" autocomplete="off" aria-hidden="true" aria-label="Não preencher este campo" name="website" value="">',
        '<label class="check-row lead-consent"><input id="partner-consent" type="checkbox"><span><strong>Autorizo o TAMÃO a entrar em contato pelo WhatsApp.</strong><small>Esse contato não libera vendas. Antes, precisamos conferir os dados da empresa e as autorizações aplicáveis.</small></span></label><div class="lead-privacy-note">O uso destes dados está explicado no <button class="text-link" onclick="go(\'privacy\')">Aviso de Privacidade</button>.</div>',
        '<button id="partner-submit" class="primary full" onclick="submitPrelaunchMerchantLead()">Quero apresentar minha empresa →</button>',
        '<div id="partner-result" class="lead-result" role="status" aria-live="polite"></div>',
      '</div>',
    '</div></section>'
  ].join('');
}
function openPrelaunchMerchantLead(){
  const focusMerchantLead=()=>{
    if(route()!=='merchants')return;
    document.getElementById('partner-interest')?.scrollIntoView({behavior:'smooth',block:'start'});
    document.querySelector('#partner-business')?.focus({preventScroll:true});
  };
  if(route()!=='merchants'){
    go('merchants');
    setTimeout(focusMerchantLead,160);
    return;
  }
  focusMerchantLead();
}
async function submitPrelaunchMerchantLead(){
  const button=document.querySelector('#partner-submit');
  const result=document.querySelector('#partner-result');
  if(button?.disabled)return;
  const businessName=String(document.querySelector('#partner-business')?.value||'').trim();
  const contactName=String(document.querySelector('#partner-name')?.value||'').trim();
  const phone=leadPhoneDigits(document.querySelector('#partner-phone')?.value);
  const postalCode=leadPostalDigits(document.querySelector('#partner-postal')?.value);
  const interests=leadCheckedValues('partner-interest');
  const note=String(document.querySelector('#partner-note')?.value||'').trim();
  const consent=document.querySelector('#partner-consent')?.checked===true;
  const website=String(document.querySelector('#partner-website')?.value||'');
  if(businessName.length<2)return toast('Informe o nome da empresa');
  if(contactName.length<2)return toast('Informe o nome do responsável');
  if(phone.length<10||phone.length>13)return toast('Informe um WhatsApp válido com DDD');
  if(postalCode&&postalCode.length!==8)return toast('Revise o CEP informado');
  if(!interests.length)return toast('Marque pelo menos uma categoria que sua empresa vende');
  if(!consent)return toast('Confirme que podemos entrar em contato pelo WhatsApp');
  if(!globalThis.prelaunchLeadSubmit)return toast('Cadastro temporariamente indisponível');
  const oldText=button?.textContent||'Quero conversar sobre parceria';
  if(button){button.disabled=true;button.textContent='Enviando…'}
  if(result){result.textContent='';result.className='lead-result'}
  try{
    const data=await globalThis.prelaunchLeadSubmit({leadType:'merchant',businessName,contactName,phone,postalCode:postalCode||null,interests,note,consent,website});
    markPrelaunchLeadSent('merchant');
    if(result){result.textContent=String(data?.message||'Interesse recebido.');result.className='lead-result success'}
    if(button)button.textContent='Interesse registrado ✓';
  }catch(error){
    if(result){result.textContent=String(error?.message||'Não foi possível enviar agora.');result.className='lead-result error'}
    if(button){button.disabled=false;button.textContent=oldText}
  }
}

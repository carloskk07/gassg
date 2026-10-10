
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
  try{localStorage.setItem('tamao-market-region-v1',JSON.stringify({postalCode:postal,city,state}))}catch{}
}

function prelaunchLeadSent(type){
  try{return localStorage.getItem('tamao-prelaunch-'+type+'-sent-v1')==='1'}catch{return false}
}
function markPrelaunchLeadSent(type){
  try{localStorage.setItem('tamao-prelaunch-'+type+'-sent-v1','1')}catch{}
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
  const section=document.getElementById('early-access');
  if(!section){
    if(route()!=='home')go('home');
    setTimeout(()=>{
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
      '<div class="section-head"><div><span class="section-kicker">ATENDIMENTO POR REGIÃO</span><h2>Consulte sua região e veja o próximo passo.</h2><p>A disponibilidade é confirmada pelo CEP e pela capacidade das revendas cadastradas.</p></div></div>',
      '<div class="prelaunch-transparency-grid">',
        '<article><span class="prelaunch-step">1</span><div><strong>Atendimento local</strong><p>O TAMÃO organiza a disponibilidade conforme a região informada e as revendas aptas a atender.</p></div></article>',
        '<article><span class="prelaunch-step">2</span><div><strong>Rede de parceiros</strong><p>Empresas entram na plataforma após cadastro, configuração operacional e validações aplicáveis.</p></div></article>',
        '<article><span class="prelaunch-step">3</span><div><strong>Disponibilidade pelo seu CEP</strong><p>Se ainda não houver atendimento, você pode deixar um contato para receber o aviso quando a região estiver disponível.</p></div></article>',
      '</div>',
    '</section>'
  ].join('');
}

function prelaunchCustomerLeadSection(){
  if(prelaunchLeadSent('customer')){
    return '<section class="section lead-section" id="early-access"><div class="lead-success-card"><span class="lead-success-icon">✓</span><div><span class="section-kicker">AVISO DE DISPONIBILIDADE</span><h2>Seu contato já foi registrado.</h2><p>Quando houver disponibilidade para sua região, o TAMÃO poderá avisar pelo WhatsApp informado.</p></div><button class="secondary" onclick="go(\'learn\')">Conhecer o TAMÃO</button></div></section>';
  }
  const rawPostal=leadPostalDigits(state.postalCode||'');
  const postal=rawPostal.length===8?rawPostal.replace(/^(\d{5})(\d{3})$/,'$1-$2'):rawPostal;
  return [
    '<section class="section lead-section" id="early-access"><div class="lead-shell">',
      '<div class="lead-copy"><span class="section-kicker">CONSULTAR DISPONIBILIDADE</span><h2>Quer receber pelo TAMÃO nesta região?</h2>',
      '<p>Informe seu WhatsApp e CEP. Se ainda não houver uma revenda disponível para atender, avisamos quando a cobertura chegar à sua região.</p>',
      '<div class="lead-proof"><span>✓ Cadastro gratuito</span><span>✓ Sem pedido automático</span><span>✓ Você escolhe quando comprar</span></div></div>',
      '<div class="lead-form card flat">',
        '<div class="field-row"><div class="input-wrap"><label for="prelaunch-name">Seu nome <small>(opcional)</small></label><input id="prelaunch-name" class="input" maxlength="120" autocomplete="name" placeholder="Como podemos chamar você?"></div>',
        '<div class="input-wrap"><label for="prelaunch-phone">WhatsApp</label><input id="prelaunch-phone" class="input" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="(55) 99999-9999"></div></div>',
        '<div class="input-wrap"><label for="prelaunch-postal">CEP onde você quer receber</label><input id="prelaunch-postal" class="input" maxlength="9" inputmode="numeric" autocomplete="postal-code" value="'+esc(postal)+'" placeholder="97300-000"></div>',
        '<fieldset class="lead-interests"><legend>O que você gostaria de pedir?</legend>',
          '<label><input type="checkbox" name="prelaunch-interest" value="gas" checked><span>🔥 Gás</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="water"><span>💧 Água</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="charcoal"><span>🔥 Carvão</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="firewood"><span>🪵 Lenha</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="ice"><span>🧊 Gelo</span></label>',
          '<label><input type="checkbox" name="prelaunch-interest" value="other"><span>＋ Outros</span></label>',
        '</fieldset>',
        '<input id="prelaunch-website" class="lead-trap" tabindex="-1" autocomplete="off" aria-hidden="true" aria-label="Não preencher este campo" name="website" value="">',
        '<label class="check-row lead-consent"><input id="prelaunch-consent" type="checkbox"><span><strong>Quero receber um aviso de disponibilidade pelo WhatsApp.</strong><small>Usaremos estes dados somente para informar disponibilidade e atendimento. Nenhuma compra é criada por este cadastro.</small></span></label><div class="lead-privacy-note">Saiba como tratamos seus dados no <button class="text-link" onclick="go(\'privacy\')">Aviso de Privacidade</button>.</div>',
        '<button id="prelaunch-submit" class="primary full" onclick="submitPrelaunchCustomerLead()">Quero receber aviso de disponibilidade</button>',
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
    return '<section class="section" id="partner-interest"><div class="lead-success-card partner"><span class="lead-success-icon">✓</span><div><span class="section-kicker">CADASTRO DE PARCEIRO</span><h2>Interesse da sua empresa já registrado.</h2><p>O TAMÃO poderá entrar em contato pelo WhatsApp informado para conhecer sua operação e orientar os próximos passos.</p></div></div></section>';
  }
  return [
    '<section class="section" id="partner-interest"><div class="partner-lead-shell">',
      '<div class="lead-copy"><span class="section-kicker">VENDA PELO TAMÃO</span><h2>Cadastre sua empresa em menos de 1 minuto.</h2>',
      '<p>Comece com os dados básicos da sua empresa. Depois, o TAMÃO orienta o cadastro operacional necessário para receber pedidos.</p>',
      '<div class="lead-proof"><span>✓ Sem exclusividade</span><span>✓ Sem mensalidade no modelo atual</span><span>✓ Você controla preço e disponibilidade</span></div></div>',
      '<div class="lead-form card flat">',
        '<div class="input-wrap"><label for="partner-business">Nome da empresa</label><input id="partner-business" class="input" maxlength="120" autocomplete="organization" placeholder="Nome da revenda ou comércio"></div>',
        '<div class="field-row"><div class="input-wrap"><label for="partner-name">Seu nome</label><input id="partner-name" class="input" maxlength="120" autocomplete="name" placeholder="Responsável"></div>',
        '<div class="input-wrap"><label for="partner-phone">WhatsApp</label><input id="partner-phone" class="input" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="(55) 99999-9999"></div></div>',
        '<div class="input-wrap"><label for="partner-postal">CEP da empresa <small>(opcional)</small></label><input id="partner-postal" class="input" maxlength="9" inputmode="numeric" autocomplete="postal-code" placeholder="97300-000"></div>',
        '<fieldset class="lead-interests"><legend>O que sua empresa vende?</legend>',
          '<label><input type="checkbox" name="partner-interest" value="gas"><span>🔥 Gás</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="water"><span>💧 Água</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="charcoal"><span>🔥 Carvão</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="firewood"><span>🪵 Lenha</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="ice"><span>🧊 Gelo</span></label>',
          '<label><input type="checkbox" name="partner-interest" value="other"><span>＋ Outros</span></label>',
        '</fieldset>',
        '<div class="input-wrap"><label for="partner-note">Algo que devemos saber? <small>(opcional)</small></label><textarea id="partner-note" class="input" rows="2" maxlength="500" placeholder="Ex.: entregamos em toda São Gabriel; temos frota própria."></textarea></div>',
        '<input id="partner-website" class="lead-trap" tabindex="-1" autocomplete="off" aria-hidden="true" aria-label="Não preencher este campo" name="website" value="">',
        '<label class="check-row lead-consent"><input id="partner-consent" type="checkbox"><span><strong>Autorizo o TAMÃO a entrar em contato pelo WhatsApp.</strong><small>Este envio registra apenas interesse comercial; a ativação exige cadastro e validações posteriores.</small></span></label><div class="lead-privacy-note">O uso destes dados está explicado no <button class="text-link" onclick="go(\'privacy\')">Aviso de Privacidade</button>.</div>',
        '<button id="partner-submit" class="primary full" onclick="submitPrelaunchMerchantLead()">Quero conversar sobre parceria</button>',
        '<div id="partner-result" class="lead-result" role="status" aria-live="polite"></div>',
      '</div>',
    '</div></section>'
  ].join('');
}
function openPrelaunchMerchantLead(){
  document.getElementById('partner-interest')?.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>document.querySelector('#partner-business')?.focus(),350);
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

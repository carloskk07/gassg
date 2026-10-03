const TAMAO_LEGAL_EFFECTIVE='03/10/2026';

function legalHero(kicker,title,text){
  return '<section class="page legal-page"><span class="eyebrow">'+esc(kicker)+'</span><h1 class="page-title">'+esc(title)+'</h1><p class="legal-lead">'+esc(text)+'</p>';
}
function legalClose(){
  return '</section>';
}
function legalNav(){
  return '<div class="legal-nav"><button class="ghost small" onclick="go(\'privacy\')">Privacidade</button><button class="ghost small" onclick="go(\'terms\')">Termos</button><button class="ghost small" onclick="go(\'contact\')">Contato</button></div>';
}
function privacyPage(){
  return shell(
    legalHero(
      'PRIVACIDADE • PRÉ-LANÇAMENTO',
      'Aviso de Privacidade',
      'Este aviso explica como o TAMÃO trata dados pessoais durante o pré-lançamento e como você pode exercer seus direitos.'
    )+
    legalNav()+
    '<div class="legal-meta">Vigente desde '+TAMAO_LEGAL_EFFECTIVE+' • Operação inicial: São Gabriel/RS</div>'+
    '<section class="legal-card"><h2>1. Quem trata seus dados</h2><p><strong>TAMÃO</strong> é a marca da operação em pré-lançamento responsável pelas decisões sobre os dados coletados neste site. Nesta fase, o canal oficial para dúvidas e exercício de direitos é o formulário <button class="text-link" onclick="go(\'contact\')">Contato e Privacidade</button>. A identificação civil ou empresarial completa do responsável pela operação será publicada antes da abertura do comércio real.</p></section>'+
    '<section class="legal-card"><h2>2. Dados que podemos coletar</h2><div class="legal-grid">'+
      '<div><h3>Lista de abertura</h3><p>Nome opcional, WhatsApp, CEP, categorias de interesse e dados de origem da campanha, como UTM, página de entrada e referenciador.</p></div>'+
      '<div><h3>Parceiros interessados</h3><p>Nome da empresa, responsável, WhatsApp, CEP opcional, categorias vendidas e observações enviadas voluntariamente.</p></div>'+
      '<div><h3>Contato e privacidade</h3><p>Nome, canal escolhido para resposta, contato, assunto, mensagem e, quando aplicável, o direito de privacidade que você deseja exercer.</p></div>'+
      '<div><h3>Operação futura</h3><p>Quando o comércio real for aberto, poderemos tratar dados de conta, endereço de entrega, pedidos, eventos da entrega, forma de pagamento, benefícios e suporte necessários para executar o serviço.</p></div>'+
    '</div></section>'+
    '<section class="legal-card"><h2>3. Para que usamos os dados</h2><ul class="legal-list"><li>avisar sobre abertura ou disponibilidade quando você solicitar;</li><li>medir demanda por região e categoria para formar a rede de parceiros;</li><li>conversar com empresas interessadas e conduzir onboarding;</li><li>responder dúvidas, suporte e solicitações de privacidade;</li><li>quando o comércio estiver ativo, executar consulta, pedido, entrega, suporte, benefícios e conciliação;</li><li>prevenir abuso, fraude e uso automatizado indevido.</li></ul></section>'+
    '<section class="legal-card"><h2>4. Bases utilizadas</h2><p>Na lista de abertura, o contato promocional ocorre com sua autorização. Em pedidos e onboarding, o tratamento poderá ser necessário para procedimentos pré-contratuais e execução do serviço. Também poderemos tratar dados para cumprir obrigações legais, exercer direitos e proteger a segurança da plataforma, sempre de forma compatível com a LGPD.</p></section>'+
    '<section class="legal-card"><h2>5. Segurança e antiabuso</h2><p>Os formulários públicos gravam dados somente por endpoints server-side. As tabelas de leads e solicitações não são abertas diretamente ao navegador. Para limitar abuso, o sistema utiliza um hash técnico derivado do endereço de rede; o IP bruto não é armazenado nessas tabelas de captação.</p></section>'+
    '<section class="legal-card"><h2>6. Fornecedores de infraestrutura</h2><p>O TAMÃO utiliza serviços de infraestrutura necessários ao funcionamento do produto, incluindo Supabase para backend e banco de dados. Durante a transição de domínio, GitHub Pages é usado como laboratório técnico; Cloudflare está planejado para DNS, proteção e hospedagem pública. Esses fornecedores podem tratar dados técnicos conforme seus próprios contratos e medidas de segurança. Não vendemos dados pessoais a anunciantes.</p></section>'+
    '<section class="legal-card"><h2>7. Armazenamento local e tecnologias similares</h2><p>O site pode usar <em>sessionStorage</em> e <em>localStorage</em> para manter estado funcional, preferências técnicas e evitar repetição desnecessária de formulários. Recursos de segurança como Turnstile poderão processar sinais técnicos quando ativados. Nesta fase não instalamos pixels de publicidade ou analytics comportamental de terceiros.</p></section>'+
    '<section class="legal-card"><h2>8. Por quanto tempo mantemos os dados</h2><p>Conservamos dados somente enquanto forem necessários para a finalidade informada, para cumprir obrigações aplicáveis, proteger direitos ou atender solicitações. Leads baseados em autorização podem ser eliminados quando a finalidade terminar ou quando você retirar a autorização, ressalvadas hipóteses legais de conservação.</p></section>'+
    '<section class="legal-card"><h2>9. Seus direitos</h2><p>Você pode solicitar, conforme aplicável, confirmação de tratamento, acesso, correção, anonimização, bloqueio, eliminação, informação sobre compartilhamento, portabilidade nos termos regulamentares e revogação do consentimento. Podemos solicitar confirmação de identidade antes de entregar, corrigir ou excluir dados.</p><button class="primary" onclick="go(\'contact\')">Exercer um direito de privacidade</button></section>'+
    '<section class="legal-card"><h2>10. Crianças e adolescentes</h2><p>O TAMÃO não é direcionado a crianças. Cadastros comerciais, contratação e operação de produtos regulados devem ser realizados por pessoas com capacidade legal adequada.</p></section>'+
    '<section class="legal-card"><h2>11. Atualizações</h2><p>Este aviso será revisado antes do go-live comercial e sempre que houver mudança relevante de finalidade, fornecedor ou tecnologia. A data de vigência fica indicada no topo desta página.</p></section>'+
    legalClose()
  );
}

function termsPage(){
  return shell(
    legalHero(
      'TERMOS • PRÉ-LANÇAMENTO',
      'Termos de Uso',
      'Regras atuais para conhecer o TAMÃO, entrar na lista de abertura e manifestar interesse como parceiro.'
    )+
    legalNav()+
    '<div class="legal-meta">Vigente desde '+TAMAO_LEGAL_EFFECTIVE+' • versão de pré-lançamento</div>'+
    '<section class="legal-card"><h2>1. Situação atual</h2><p>O TAMÃO está em pré-lançamento. Algumas telas demonstram como será a experiência. Quando uma oferta estiver marcada como exemplo ou quando o comércio estiver fechado, nenhuma ação cria pedido, cobrança ou reserva real de estoque.</p></section>'+
    '<section class="legal-card"><h2>2. Lista de abertura</h2><p>Entrar na lista é gratuito e não obriga você a comprar. O cadastro serve para avisar disponibilidade e entender demanda regional. Você pode solicitar a retirada dos seus dados pelo canal de contato.</p></section>'+
    '<section class="legal-card"><h2>3. Parceiro Fundador</h2><p>Manifestar interesse como parceiro não ativa automaticamente uma empresa na plataforma e não cria exclusividade. Ativação futura depende de cadastro, validações operacionais e, para produtos regulados como GLP, das comprovações exigidas. O TAMÃO não promete volume de pedidos, faturamento ou renda.</p></section>'+
    '<section class="legal-card"><h2>4. Quando o comércio real abrir</h2><p>O cliente deverá receber preço total e previsão de entrega antes de confirmar. Preço, estoque e disponibilidade podem mudar até a criação de uma cotação válida. O parceiro precisa aceitar o pedido antes de ele avançar para preparação. O status “a caminho” só deve aparecer após confirmação de saída.</p></section>'+
    '<section class="legal-card"><h2>5. Papel dos parceiros</h2><p>Os produtos são ofertados por empresas parceiras habilitadas para suas categorias. O TAMÃO organiza a experiência de consulta, matching, acompanhamento e suporte. Essa descrição operacional não exclui responsabilidades que a legislação aplicável atribua à plataforma ou aos parceiros.</p></section>'+
    '<section class="legal-card"><h2>6. Conduta do usuário</h2><ul class="legal-list"><li>informar dados de contato e entrega corretos;</li><li>não automatizar ou sobrecarregar formulários e endpoints;</li><li>não tentar acessar áreas administrativas ou dados de terceiros;</li><li>usar o serviço para finalidades lícitas e respeitar regras de segurança de produtos regulados.</li></ul></section>'+
    '<section class="legal-card"><h2>7. Benefícios, cashback e indicação</h2><p>Benefícios só se tornam devidos quando as regras publicadas e os eventos necessários forem cumpridos. Valores, elegibilidade, quarentena e limites podem variar por campanha. Materiais promocionais não devem ser interpretados como promessa de renda.</p></section>'+
    '<section class="legal-card"><h2>8. Disponibilidade e mudanças</h2><p>Recursos de pré-lançamento podem ser ajustados ou interrompidos para testes e segurança. Antes da abertura comercial, estes termos serão revistos para refletir a operação real, formas de pagamento, cancelamento, atendimento e demais condições aplicáveis.</p></section>'+
    '<section class="legal-card"><h2>9. Privacidade e contato</h2><p>O tratamento de dados segue o <button class="text-link" onclick="go(\'privacy\')">Aviso de Privacidade</button>. Para dúvidas, suporte ou exercício de direitos, use o <button class="text-link" onclick="go(\'contact\')">canal oficial do site</button>.</p></section>'+
    legalClose()
  );
}

function contactPrivacyOptions(){
  return '<option value="">Selecione</option><option value="confirmation">Confirmar se há tratamento</option><option value="access">Acessar meus dados</option><option value="correction">Corrigir meus dados</option><option value="deletion">Solicitar eliminação</option><option value="information">Informações sobre uso/compartilhamento</option><option value="revocation">Revogar autorização</option><option value="other">Outro assunto de privacidade</option>';
}
function contactKindChanged(){
  const kind=document.querySelector('#public-request-kind')?.value||'general';
  const wrap=document.querySelector('#privacy-action-wrap');
  if(wrap)wrap.hidden=kind!=='privacy';
}
function contactChannelChanged(){
  const channel=document.querySelector('#public-contact-channel')?.value||'whatsapp';
  const input=document.querySelector('#public-contact-value');
  if(!input)return;
  if(channel==='email'){
    input.type='email';
    input.inputMode='email';
    input.autocomplete='email';
    input.placeholder='voce@exemplo.com';
  }else{
    input.type='tel';
    input.inputMode='tel';
    input.autocomplete='tel';
    input.placeholder='(55) 99999-9999';
  }
}
async function submitPublicRequest(){
  const button=document.querySelector('#public-request-submit');
  const result=document.querySelector('#public-request-result');
  if(button?.disabled)return;
  const requestKind=String(document.querySelector('#public-request-kind')?.value||'general');
  const privacyAction=String(document.querySelector('#public-privacy-action')?.value||'');
  const contactName=String(document.querySelector('#public-contact-name')?.value||'').trim();
  const contactChannel=String(document.querySelector('#public-contact-channel')?.value||'whatsapp');
  const contactValue=String(document.querySelector('#public-contact-value')?.value||'').trim();
  const message=String(document.querySelector('#public-request-message')?.value||'').trim();
  const website=String(document.querySelector('#public-request-website')?.value||'');
  const acknowledged=document.querySelector('#public-request-ack')?.checked===true;

  if(contactName.length<2)return toast('Informe seu nome');
  if(requestKind==='privacy'&&!privacyAction)return toast('Escolha o assunto de privacidade');
  if(contactChannel==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue))return toast('Informe um e-mail válido');
  if(contactChannel==='whatsapp'){
    const digits=contactValue.replace(/\D/g,'');
    if(digits.length<10||digits.length>13)return toast('Informe um WhatsApp válido com DDD');
  }
  if(message.length<10)return toast('Explique sua solicitação em pelo menos 10 caracteres');
  if(!acknowledged)return toast('Confirme o uso dos dados para responder à solicitação');
  if(!globalThis.publicRequestSubmit)return toast('Canal temporariamente indisponível');

  const old=button?.textContent||'Enviar solicitação';
  if(button){button.disabled=true;button.textContent='Enviando…'}
  if(result){result.textContent='';result.className='lead-result'}
  try{
    const data=await globalThis.publicRequestSubmit({
      requestKind,privacyAction,contactName,contactChannel,contactValue,message,website,acknowledged
    });
    if(result){
      result.textContent=(data?.message||'Solicitação recebida.')+(data?.protocol?' Protocolo: '+data.protocol+'.':'');
      result.className='lead-result success';
    }
    if(button)button.textContent='Solicitação enviada ✓';
  }catch(error){
    if(result){
      result.textContent=String(error?.message||'Não foi possível enviar agora.');
      result.className='lead-result error';
    }
    if(button){button.disabled=false;button.textContent=old}
  }
}

function contactPage(){
  return shell(
    legalHero(
      'CONTATO • CANAL OFICIAL',
      'Fale com o TAMÃO',
      'Use este canal para dúvidas gerais, suporte ou solicitações relacionadas aos seus dados pessoais.'
    )+
    legalNav()+
    '<div class="contact-purpose-grid">'+
      '<article class="trust-card"><span>💬</span><h3>Dúvidas gerais</h3><p>Pré-lançamento, funcionamento, cadastro e disponibilidade.</p></article>'+
      '<article class="trust-card"><span>🛟</span><h3>Suporte</h3><p>Problemas de uso ou atendimento que não estejam vinculados a um pedido ativo.</p></article>'+
      '<article class="trust-card"><span>🔐</span><h3>Privacidade / LGPD</h3><p>Acesso, correção, eliminação, informações ou revogação de autorização.</p></article>'+
    '</div>'+
    '<section class="legal-card public-contact-card"><div class="field-row">'+
      '<div class="input-wrap"><label for="public-request-kind">Assunto</label><select id="public-request-kind" class="input" onchange="contactKindChanged()"><option value="general">Dúvida geral</option><option value="support">Suporte</option><option value="privacy">Privacidade / dados pessoais</option></select></div>'+
      '<div class="input-wrap" id="privacy-action-wrap" hidden><label for="public-privacy-action">Direito ou assunto de privacidade</label><select id="public-privacy-action" class="input">'+contactPrivacyOptions()+'</select></div>'+
    '</div>'+
    '<div class="field-row"><div class="input-wrap"><label for="public-contact-name">Seu nome</label><input id="public-contact-name" class="input" maxlength="120" autocomplete="name" placeholder="Nome"></div>'+
      '<div class="input-wrap"><label for="public-contact-channel">Como prefere receber resposta?</label><select id="public-contact-channel" class="input" onchange="contactChannelChanged()"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></div></div>'+
    '<div class="input-wrap"><label for="public-contact-value">Seu contato</label><input id="public-contact-value" class="input" type="tel" inputmode="tel" maxlength="180" autocomplete="tel" placeholder="(55) 99999-9999"></div>'+
    '<div class="input-wrap"><label for="public-request-message">Mensagem</label><textarea id="public-request-message" class="input" rows="5" maxlength="2000" placeholder="Conte o que você precisa. Evite enviar senha, código de autenticação ou dados bancários."></textarea></div>'+
    '<input id="public-request-website" class="lead-trap" tabindex="-1" autocomplete="off" aria-hidden="true" aria-label="Não preencher este campo" name="website" value="">'+
    '<label class="check-row lead-consent"><input id="public-request-ack" type="checkbox"><span><strong>Entendo que estes dados serão usados para responder à minha solicitação.</strong><small>Em pedidos de privacidade, o TAMÃO poderá solicitar confirmação de identidade antes de fornecer, corrigir ou excluir dados.</small></span></label>'+
    '<button id="public-request-submit" class="primary full" onclick="submitPublicRequest()">Enviar solicitação</button>'+
    '<div id="public-request-result" class="lead-result" role="status" aria-live="polite"></div>'+
    '</section>'+
    '<div class="notice"><strong>Segurança:</strong> nunca envie senha, código de verificação, número completo de cartão ou chave privada por este formulário.</div>'+
    legalClose()
  );
}

globalThis.privacyPage=privacyPage;
globalThis.termsPage=termsPage;
globalThis.contactPage=contactPage;

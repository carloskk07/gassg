/* V1.1071 — optional personalized invitation editor, loaded only inside the Rede workspace. */
const TAMAO_NETWORK_PAGE_THEMES=Object.freeze({clean:'Clean',gold:'Black Gold',rose:'Elegance'});
function tamaoNetworkPageLocalOptions(code){
 try{
  const input=JSON.parse(localStorage.getItem('tamao-network-look:'+code)||'{}');
  return input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 }catch{return {};}
}
function tamaoNetworkPageFormOptions(portal='customer'){
 const code=tamaoNetworkPageVerifiedCode(portal);
 if(!code)return null;
 const id='tamao-network-page-'+portal;
 const el=document.getElementById(id);
 const saved=tamaoNetworkPageLocalOptions(code);
 if(!el)return {audience:portal==='merchant'?'merchant':'customer',theme:'clean'};
 const selected=key=>el.querySelector('[name="'+key+'"]')?.value||'';
 return {
  audience:selected('audience')||saved.audience||(portal==='merchant'?'merchant':'customer'),
  theme:selected('theme')||saved.theme||'clean',
  name:selected('name')||'',
  message:selected('message')||''
 };
}
function tamaoNetworkPageCurrentLink(portal='customer'){
 const code=tamaoNetworkPageVerifiedCode(portal);
 return tamaoNetworkPageLink(code,tamaoNetworkPageFormOptions(portal)||{});
}
function tamaoNetworkPageChanged(portal='customer'){
 const code=tamaoNetworkPageVerifiedCode(portal),options=tamaoNetworkPageFormOptions(portal);
 if(!code||!options)return;
 try{localStorage.setItem('tamao-network-look:'+code,JSON.stringify(options));}catch{}
 const card=document.getElementById('tamao-network-page-preview-'+portal);
 if(card){
  card.className='tamao-network-page-preview theme-'+
   (Object.hasOwn(TAMAO_NETWORK_PAGE_THEMES,options.theme)?options.theme:'clean');
  const label=card.querySelector('.tamao-network-page-preview-kicker');
  const title=card.querySelector('.tamao-network-page-preview-title');
  const content=card.querySelector('.tamao-network-page-preview-copy');
  if(label)label.textContent=TAMAO_NETWORK_INVITE_TARGETS[options.audience]?.label||'Clientes';
  if(title)title.textContent=options.name?options.name+' convida você':'Um convite para conhecer o TAMÃO';
  if(content)content.textContent=options.message||'Descubra mais no TAMÃO.';
 }
 const link=document.getElementById('tamao-network-page-link-'+portal);
 if(link)link.textContent=tamaoNetworkPageCurrentLink(portal);
}
async function tamaoNetworkPageShare(portal='customer',mode='share'){
 const url=tamaoNetworkPageCurrentLink(portal);
 if(!url)return toast('Entre na sua conta para obter um convite válido.');
 tamaoNetworkPageChanged(portal);
 if(mode==='view'){
  window.open(url,'_blank','noopener,noreferrer');return;
 }
 try{
  if(mode==='share'&&navigator.share){
   await navigator.share({title:'Um convite para conhecer o TAMÃO',url});return;
  }
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);toast('Página de convite copiada');return;}
  toast('Copie o endereço exibido na sua página de indicação.');
 }catch(e){if(e?.name!=='AbortError')toast('Não foi possível compartilhar; copie o link exibido.');}
}
function tamaoNetworkPageBuilder(portal='customer'){
 const code=tamaoNetworkPageVerifiedCode(portal);
 if(!code)return '';
 const id='tamao-network-page-'+portal,stored=tamaoNetworkPageLocalOptions(code);
 const audience=Object.hasOwn(TAMAO_NETWORK_INVITE_TARGETS,stored.audience)?
  stored.audience:(portal==='merchant'?'merchant':'customer');
 const theme=Object.hasOwn(TAMAO_NETWORK_PAGE_THEMES,stored.theme)?stored.theme:'clean';
 const name=String(stored.name||'').slice(0,48);
 const message=String(stored.message||'').slice(0,140);
 const url=tamaoNetworkPageLink(code,{audience,theme,name,message});
 const escSafe=value=>esc(String(value||''));
 return '<section class="card flat tamao-network-page-builder" id="'+id+'" aria-label="Minha página de convite">'+
  '<div class="tamao-network-page-head"><span class="section-kicker">LINK COM A SUA IDENTIDADE</span>'+
   '<h2>Minha página de indicação</h2>'+
   '<p>Escolha para quem vai enviar e use uma página pronta. Você pode personalizar sem precisar montar um site.</p></div>'+
  '<div class="tamao-network-page-grid"><div class="tamao-network-page-controls">'+
   '<label>O que deseja divulgar?<select class="input" name="audience" onchange="tamaoNetworkPageChanged(\''+portal+'\')">'+
    Object.entries(TAMAO_NETWORK_INVITE_TARGETS).map(([key,item])=>
     '<option value="'+key+'"'+(key===audience?' selected':'')+'>'+escSafe(item.label)+'</option>').join('')+
   '</select></label>'+
   '<fieldset><legend>Visual da página</legend><div class="tamao-network-page-styles">'+
    Object.entries(TAMAO_NETWORK_PAGE_THEMES).map(([key,label])=>
     '<label class="tamao-network-page-style theme-'+key+'">'+
      '<input type="radio" name="theme" value="'+key+'"'+(key===theme?' checked':'')+
      ' onchange="tamaoNetworkPageChanged(\''+portal+'\')"><span aria-hidden="true">✦</span><strong>'+escSafe(label)+'</strong></label>').join('')+
   '</div></fieldset>'+
   '<details><summary>Personalizar nome e mensagem (opcional)</summary><div class="tamao-network-page-custom">'+
    '<label>Nome para apresentar no convite<input class="input" name="name" maxlength="48" autocomplete="off" value="'+escSafe(name)+'" placeholder="Ex.: Maria ou Barbearia do João" oninput="tamaoNetworkPageChanged(\''+portal+'\')"></label>'+
    '<label>Mensagem curta<input class="input" name="message" maxlength="140" autocomplete="off" value="'+escSafe(message)+'" placeholder="Ex.: Conheça os serviços que eu recomendo" oninput="tamaoNetworkPageChanged(\''+portal+'\')"></label>'+
   '</div></details>'+
   '<div class="tamao-network-page-actions">'+
    '<button type="button" class="primary" onclick="tamaoNetworkPageShare(\''+portal+'\',\'share\')">Compartilhar página</button>'+
    '<button type="button" class="secondary" onclick="tamaoNetworkPageShare(\''+portal+'\',\'view\')">Ver minha página</button></div>'+
   '<p class="tiny muted">Seu link mantém o código de indicação e funciona nas sete áreas. As escolhas ficam neste navegador e também no endereço que você compartilhar.</p>'+
  '</div><div class="tamao-network-page-preview theme-'+theme+'" id="tamao-network-page-preview-'+portal+'">'+
   '<span class="tamao-network-page-preview-brand">TAMÃO · REDE</span>'+
   '<span class="tamao-network-page-preview-kicker">'+escSafe(TAMAO_NETWORK_INVITE_TARGETS[audience].label)+'</span>'+
   '<strong class="tamao-network-page-preview-title">'+escSafe(name?name+' convida você':'Um convite para conhecer o TAMÃO')+'</strong>'+
   '<p class="tamao-network-page-preview-copy">'+escSafe(message||'Descubra mais no TAMÃO.')+'</p>'+
   '<span class="tamao-network-page-preview-button">Conhecer o TAMÃO →</span></div></div>'+
   '<div class="tamao-network-page-address"><span>Seu endereço de compartilhamento</span><div id="tamao-network-page-link-'+portal+'" class="share-box">'+escSafe(url)+'</div></div>'+
  '</section>';
}


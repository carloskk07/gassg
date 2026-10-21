// Only an authenticated, fresh server query tied to this exact checkout draft
// may be summarized on the home page. It does not authorize an order.
function homeQuoteVerifiedOffers(){
 const rt=globalThis.liveRuntime;
 if(globalThis.liveReady?.()!==true||!rt||rt.postalValidated!==true||
    rt.commerceLaunchBlocked===true||rt.loadingOffers===true||
    typeof liveOfferRequestFingerprint!=='function')return [];
 const zip=String(state?.postalCode||'').replace(/\D/g,'');
 const number=String(state?.addressNumber||'').trim().toUpperCase();
 if(!/^[0-9]{8}$/.test(zip)||!/^[0-9]{1,6}[A-Za-z]?$/.test(number)||
    !String(state?.address||'').trim()||rt.lastCityCheck?.postalCode!==zip||
    rt.lastCityCheck?.regionAvailable!==true)return [];
 const fingerprint=liveOfferRequestFingerprint();
 if(!fingerprint||rt.lastOfferFingerprint!==fingerprint||
    !Number.isFinite(Number(rt.lastOfferCheckedAt))||
    Date.now()-Number(rt.lastOfferCheckedAt)>60000||
    Date.now()<Number(rt.lastOfferCheckedAt)-1000)return [];
 return (Array.isArray(rt.offers)?rt.offers:[]).filter(offer=>
   offer?.live===true&&
   typeof offer.id==='string'&&/^[A-Za-z0-9-]{1,70}$/.test(offer.id)&&
   offer.total!=null&&Number.isFinite(Number(offer.total))&&
   Number(offer.total)>0&&Number(offer.total)<=1000000&&
   Number.isFinite(Date.parse(String(offer.expiresAt||'')))&&
   Date.parse(String(offer.expiresAt))>Date.now()+1000
 ).slice().sort((a,b)=>Number(a.total)-Number(b.total)).slice(0,3);
}
function homeQuoteVerifiedComparison(){
 const matches=homeQuoteVerifiedOffers();
 if(!matches.length)return '';
 const rows=matches.map((offer,index)=>{
  const total=Number(offer.total),fee=Number(offer.deliveryFee);
  const delivery=offer.deliveryFee!=null&&Number.isFinite(fee)&&fee>=0&&fee<=total
    ?'<span>Entrega: '+BRL.format(fee)+'</span>'
    :'<span>Entrega incluída no total</span>';
  const eta=Number(offer.etaMax??offer.eta);
  const deadline=(offer.etaMax??offer.eta)!=null&&Number.isFinite(eta)&&eta>0&&eta<=1440
    ?'<span>Até '+Math.round(eta)+' min (estimativa)</span>':'';
  return '<div class="city-price-verified-option"><span>'+(index===0?'Menor total consultado':'Outra opção')+'</span>'+
    '<strong>'+BRL.format(total)+'</strong><small>Total com entrega</small>'+
    delivery+deadline+'</div>';
 }).join('');
 return '<section class="city-price-verified-list" aria-label="Comparativo das últimas ofertas confirmadas">'+
  '<strong>Ofertas consultadas para esta cesta e endereço</strong>'+
  '<p>Valores e entrega da última consulta válida. Confira novamente antes de solicitar.</p>'+
  '<div class="city-price-verified-options">'+rows+'</div>'+
  '<p>Cupons e cashback são calculados conforme a elegibilidade no pedido.</p></section>';
}

// A live basket counts quantities, not imaginary savings from reference research.
function homeQuoteBasketMarkup(cart){
 const selected=Object.entries(cart||{}).filter(([code,qty])=>
  /^[A-Z][A-Z0-9_]{1,31}$/.test(code)&&Number.isInteger(Number(qty))&&
  Number(qty)>0&&products[code]&&!products[code].hidden);
 const units=selected.reduce((total,[,qty])=>total+Number(qty),0);
 const items=selected.slice(0,4).map(([code,qty])=>
  '<span class="city-price-basket-chip">'+Number(qty)+'× '+esc(customerProductName(code,products[code]))+'</span>').join('');
 return '<div class="city-price-basket-copy"><span class="city-price-basket-label">🧺 SUA CESTA</span>'+
  '<strong>'+(units?units+' '+(units===1?'unidade selecionada':'unidades selecionadas'):'Escolha um produto para começar')+'</strong>'+
  '<span>'+(units?'Consulte o total com entrega e descontos aplicáveis no próximo passo.':'Selecione os itens acima para começar.')+'</span>'+
  (items?'<div class="city-price-basket-items">'+items+'</div>':'')+'</div>'+
  (units?homeQuoteVerifiedComparison():'')+
  '<button type="button" class="primary" onclick="homeQuoteGoToOrder()"'+(units?'':' disabled')+'>Ver cesta e consultar →</button>';
}

// Expand a product directly below its price; never use research prices as checkout offers.
function homeQuoteProductPicker(item){
 const code=String(item?.code||'').trim().toUpperCase();
 if(!/^[A-Z][A-Z0-9_]{1,31}$/.test(code))return '';
 const label=String(item?.label||code),price=String(item?.price||'');
 const previousPostal=typeof state==='object'?String(state?.postalCode||''):'';
 const zipId='city-price-postal-'+code,qtyId='city-price-qty-'+code;
 return '<details name="tamao-city-quote" class="city-price-product-pick" data-city-quote-code="'+code+'">'+
  '<summary aria-label="Selecionar '+esc(label)+' e consultar pelo CEP">'+
   '<span class="city-price-product-heading"><span class="city-price-product-icon" aria-hidden="true">'+esc(products[code]?.icon||'🛒')+'</span><span class="city-price-caption">'+esc(label)+'</span></span>'+
   (item.caption?'<small>'+esc(item.caption)+'</small>':'')+
   '<strong class="city-price-amount">'+esc(price)+'</strong>'+
   '<span class="city-price-product-hint">Selecionar e consultar <span aria-hidden="true">↘</span></span>'+
  '</summary>'+
  '<div class="city-price-product-form">'+
   '<div class="city-price-product-fields">'+
    '<label for="'+zipId+'">CEP de entrega<input id="'+zipId+'" class="city-price-product-postal" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="00000-000" oninput="homeQuoteSyncPostal(this)" value="'+esc(previousPostal)+'"></label>'+
    '<label for="'+qtyId+'">Quantidade<span class="city-price-product-qty-control"><button type="button" aria-label="Diminuir quantidade de '+esc(label)+'" onclick="homeQuoteAdjustQuantity(\''+code+'\',-1)">−</button><input id="'+qtyId+'" class="city-price-product-qty" type="number" min="1" max="20" step="1" value="1"><button type="button" aria-label="Aumentar quantidade de '+esc(label)+'" onclick="homeQuoteAdjustQuantity(\''+code+'\',1)">+</button></span></label>'+
   '</div>'+
   '<p class="city-price-product-note">'+(item.reference
     ?'Valor de pesquisa, não é oferta. Preço, estoque e entrega só serão confirmados na consulta.'
     :'Preço inicial informativo. Confirme o total com entrega e a disponibilidade no seu CEP.')+'</p>'+
   '<div class="city-price-product-actions">'+
    '<button type="button" class="secondary small" onclick="homeQuoteSelectProduct(\''+code+'\',false)">Adicionar à cesta</button>'+
    '<button type="button" class="primary small" onclick="homeQuoteSelectProduct(\''+code+'\',true)">Consultar e comprar →</button>'+
   '</div>'+
   '<p class="city-price-product-feedback" role="status" aria-live="polite"></p>'+
  '</div></details>'+
 '<button type="button" class="secondary small city-price-quick-add" '+
 'onclick="homeQuoteQuickAdd(\''+code+'\')" '+
 'aria-label="Adicionar uma unidade de '+esc(label)+' à cesta">'+
 '＋ Adicionar à cesta</button>';
}

// TAMÃO V1.341 — trustworthy city-first pricing presentation.
// Real prices only originate in the read-only, commercially gated city RPC.
function homeRegionalPriceBoard(region){
 const city=String(region?.city||''),uf=String(region?.state||'');
 const snapshot=globalThis.liveRuntime?.cityPriceSnapshot;
 const verified=snapshot?.source==='public_city_price_board_v1_341'&&
  snapshot.city===city&&snapshot.state===uf&&snapshot.real===true&&
  snapshot.notAQuote===true&&Array.isArray(snapshot.products);
 const real=verified?snapshot.products:[];
 const localP13=city.toLocaleUpperCase('pt-BR')==='SÃO GABRIEL'&&uf==='RS';
 const place=city+'/'+uf;
 const checkedAt=verified?Date.parse(String(snapshot.checkedAt||'')):NaN;
 const checkedLabel=Number.isFinite(checkedAt)&&checkedAt<=Date.now()+60000
   ?new Date(checkedAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
 // A range across merchants is informational, not a discount or a total
 // basket saving. Display only for independently eligible merchants.
 const spread=real.filter(p=>p.merchantCount>1&&p.toCents>p.fromCents)
   .sort((a,b)=>(b.toCents-b.fromCents)-(a.toCents-a.fromCents))[0]||null;
 const spreadValue=spread?BRL.format((spread.toCents-spread.fromCents)/100):'';
 const spreadName=spread?customerProductName(spread.code,products[spread.code]||{name:spread.code}):'';
 const liveCards=real.slice(0,6).map(p=>{
  const label=customerProductName(p.code,products[p.code]||{name:p.code});
  const price=BRL.format(p.fromCents/100);
  const band=p.toCents>p.fromCents?'até '+BRL.format(p.toCents/100)+' em outras revendas':'preço informado pela revenda';
  return '<article class="city-price-card verified">'+
   '<span class="city-price-kind"><i class="city-price-dot"></i> PREÇO DE REVENDA</span>'+
   homeQuoteProductPicker({code:p.code,label,price,
    caption:p.toCents>p.fromCents?'A partir de':'Preço informado'})+
   '<small>'+esc(band)+'</small><span class="city-price-origin">'+Number(p.merchantCount)+
   (p.merchantCount===1?' revenda elegível':' revendas elegíveis')+'</span></article>';
 }).join('');
 // These are LOCAL PRICE RESEARCH values provided for São Gabriel,
 // recorded in the test merchant catalog on 15/10/2026. They are not
 // current inventory, availability, the price of a verified merchant,
 // or three competitive offers. Only verified RPC data is an offer.
 const localResearch=localP13?[
   {code:'P13',label:'Gás P13 • 13 kg',priceCents:11590},
   {code:'WATER20',label:'Água • 20 L',priceCents:1590},
   {code:'WOOD',label:'Lenha • unidade informada',priceCents:2500}
 ]:[];
 const references=localP13?
   '<article class="city-price-card reference city-price-reference-summary">'+
   '<div class="city-price-reference-copy">'+
   '<span class="city-price-kind">REFERÊNCIA LOCAL • NÃO É OFERTA</span>'+
   '<div class="city-price-name">Pesquisa de preços em São Gabriel</div>'+
   '<p>Pesquisa local informada em 15/10/2026.</p></div>'+
   '<div class="city-price-research-grid city-price-reference-amount">'+localResearch.map(item=>
      '<div class="city-price-research-item">'+homeQuoteProductPicker({
       code:item.code,label:item.label,price:BRL.format(item.priceCents/100),reference:true
      })+'</div>'
   ).join('')+'</div>'+
   '<p class="city-price-reference-note">Referência de mercado, não é oferta de revenda. Consulte pelo CEP para confirmar preço e entrega.</p>'+
   '</article>':
   '<div class="city-price-empty">Explore os produtos e consulte as ofertas de '+esc(place)+
   '.</div>';
 const cards=real.length?liveCards:references;
 const copy='Clique no produto, coloque seu CEP e consulte as ofertas para o seu endereço.';
 return '<section class="city-price-board tamao-quote-first" aria-label="Painel de preços e vantagens de sua cidade">'+
  '<div class="tamao-quote-topline"><span>📊 COTAÇÕES E ECONOMIA</span>'+
   '<span>'+(real.length&&checkedLabel?'Atualizado '+esc(checkedLabel):'Seu preço, suas vantagens')+'</span></div>'+
  '<div class="city-price-heading"><div>'+
   '<h2>Tamão '+esc(place)+'</h2><p>'+esc(copy)+'</p></div></div>'+


  '<div class="city-price-grid">'+cards+'</div>'+
  '<aside id="city-price-basket" class="city-price-basket" aria-label="Cesta de produtos selecionados">'+
   homeQuoteBasketMarkup(typeof state==='object'?state.cart:{})+'</aside>'+
  '<div class="tamao-home-coupon-rail" aria-label="Cupons e descontos TAMÃO">'+
   '<span class="tamao-home-coupon-icon" aria-hidden="true">🎟️</span>'+
   '<div><strong>Cupons e Clube TAMÃO</strong>'+
   '<p>Consulte descontos e benefícios disponíveis para você.</p></div>'+
   '<button type="button" onclick="go(\'club\')">Ver cupons e Clube →</button></div>'+

  (spread?'<div class="tamao-quote-spread"><span aria-hidden="true">↔</span><div><strong>Diferença de '+esc(spreadValue)+' entre os valores estimados para '+esc(spreadName)+'</strong>'+
   '<p>Compare as ofertas com entrega para seu endereço.</p></div></div>':'')+
  (real.length?'<p class="city-price-disclaimer">Preço final, descontos e entrega são confirmados na consulta por CEP.</p>':'')+
  '<div class="city-price-controls">'+
   '<button type="button" class="primary" onclick="startCustomerAvailability()">Comparar preços e benefícios →</button>'+
   (globalThis.liveReady?.()===true?
     '<button type="button" class="secondary" onclick="homeRefreshQuotePrices()" aria-label="Atualizar cotações de preços da cidade">↻ Atualizar cotações</button>':'')+
   '<details class="city-price-chooser"><summary>Ver outra cidade</summary>'+
    '<div class="city-price-chooser-fields">'+
     '<label>Cidade<input id="home-city-name" maxlength="80" autocomplete="address-level2" value="'+esc(city)+'"></label>'+
     '<label>UF<input id="home-city-uf" maxlength="2" autocomplete="address-level1" value="'+esc(uf)+'"></label>'+
     '<button type="button" class="secondary" onclick="homeChooseMarketCity()">Atualizar vitrine</button>'+
    '</div></details></div></section>';
}

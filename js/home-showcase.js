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
 const liveCards=real.slice(0,6).map(p=>{
  const label=customerProductName(p.code,products[p.code]||{name:p.code});
  const price=BRL.format(p.fromCents/100);
  const band=p.toCents>p.fromCents?'até '+BRL.format(p.toCents/100)+' em outras revendas':'preço informado pela revenda';
  return '<article class="city-price-card verified">'+
   '<span class="city-price-kind"><i class="city-price-dot"></i> PREÇO DE REVENDA</span>'+
   '<div class="city-price-name">'+esc(label)+'</div>'+
   '<span class="city-price-caption">'+(p.toCents>p.fromCents?'A partir de':'Preço informado')+'</span>'+
   '<strong class="city-price-amount">'+price+'</strong>'+
   '<small>'+esc(band)+'</small><span class="city-price-origin">'+Number(p.merchantCount)+
   (p.merchantCount===1?' revenda elegível':' revendas elegíveis')+'</span></article>';
 }).join('');
 const references=localP13?[
  {label:'Faixa inferior',value:PUBLIC_P13_REFERENCE.minimum},
  {label:'Preço usual',value:PUBLIC_P13_REFERENCE.usual},
  {label:'Faixa superior',value:PUBLIC_P13_REFERENCE.maximum}
 ].map((p,i)=>'<article class="city-price-card reference'+(i===1?' center':'')+'">'+
  '<span class="city-price-kind">REFERÊNCIA LOCAL • NÃO É OFERTA</span>'+
  '<div class="city-price-name">Gás P13 • 13 kg</div>'+
  '<span class="city-price-caption">'+p.label+'</span>'+
  '<strong class="city-price-amount">'+BRL.format(p.value)+'</strong>'+
  '<small>Faixa comercial local conhecida • entrega incluída na referência</small></article>').join(''):
  '<div class="city-price-empty">Os preços de '+esc(place)+
  ' aparecerão aqui quando houver revendas autorizadas e disponíveis. Não exibimos preços inventados.</div>';
 const cards=real.length?liveCards:references;
 const copy=real.length
  ?'Preços informativos de revendas autorizadas, com produto em estoque. Para pedir, confirme seu CEP, cesta e condições da entrega.'
  :localP13
    ?'Conheça a faixa comercial local do gás de cozinha. Estes três valores são referências do mesmo produto, não três revendas.'
    :'Sua vitrine local será preenchida por preços reais assim que houver revendas elegíveis.';
 const origin=region?.origin==='confirmed'?'Cidade lembrada de uma consulta por CEP':
   region?.origin==='chosen'?'Cidade escolhida por você':'São Gabriel é a vitrine inicial do TAMÃO';
 return '<section class="city-price-board" aria-label="Preços e referências de sua cidade">'+
  '<div class="city-price-heading"><div><span class="section-kicker">PERTO DE VOCÊ</span>'+
   '<h2>Descubra preços em '+esc(place)+'</h2><p>'+esc(copy)+'</p></div>'+
   '<span class="city-price-place">📍 '+esc(place)+'</span></div>'+
  '<p class="tiny muted city-price-location-note">'+esc(origin)+
   ' • Os preços reais substituem as referências automaticamente quando houver revendas elegíveis.</p>'+
  '<div class="city-price-grid">'+cards+'</div>'+
  '<p class="city-price-disclaimer">'+(real.length
   ?'Valores preliminares de produto + taxa de entrega configurada; não são cotações finais nem garantia de atendimento.'
   :'Referências informativas, sem revenda associada e sem compra nesta vitrine.')+'</p>'+
  '<div class="city-price-controls">'+
   '<button type="button" class="primary" onclick="startCustomerAvailability()">Escolher produtos e consultar entrega →</button>'+
   '<details class="city-price-chooser"><summary>Ver outra cidade</summary>'+
    '<div class="city-price-chooser-fields">'+
     '<label>Cidade<input id="home-city-name" maxlength="80" autocomplete="address-level2" value="'+esc(city)+'"></label>'+
     '<label>UF<input id="home-city-uf" maxlength="2" autocomplete="address-level1" value="'+esc(uf)+'"></label>'+
     '<button type="button" class="secondary" onclick="homeChooseMarketCity()">Atualizar vitrine</button>'+
    '</div></details></div></section>';
}

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
   '<div class="city-price-name">'+esc(label)+'</div>'+
   '<span class="city-price-caption">'+(p.toCents>p.fromCents?'A partir de':'Preço informado')+'</span>'+
   '<strong class="city-price-amount">'+price+'</strong>'+
   '<small>'+esc(band)+'</small><span class="city-price-origin">'+Number(p.merchantCount)+
   (p.merchantCount===1?' revenda elegível':' revendas elegíveis')+'</span></article>';
 }).join('');
 // A reference is not three store offers. Show one clearly contextualized
 // market note, never a three-card comparison without verified revendas.
 const references=localP13?
  '<article class="city-price-card reference city-price-reference-summary">'+
   '<div class="city-price-reference-copy"><span class="city-price-kind">REFERÊNCIA LOCAL • NÃO É OFERTA</span>'+
   '<div class="city-price-name">Gás P13 • 13 kg</div>'+
   '<p>Valor usual de referência, com entrega incluída na faixa informada.</p></div>'+
   '<div class="city-price-reference-amount"><span class="city-price-caption">Referência usual</span>'+
   '<strong class="city-price-amount">'+BRL.format(PUBLIC_P13_REFERENCE.usual)+'</strong>'+
   '<small>Faixa de '+BRL.format(PUBLIC_P13_REFERENCE.minimum)+' a '+BRL.format(PUBLIC_P13_REFERENCE.maximum)+'</small></div>'+
   '<p class="city-price-reference-note">Não representa uma revenda, um preço disponível ou uma entrega confirmada para seu CEP.</p>'+
  '</article>':
  '<div class="city-price-empty">Os preços de '+esc(place)+
  ' aparecerão aqui quando houver revendas autorizadas e disponíveis. Não exibimos preços inventados.</div>';
 const cards=real.length?liveCards:references;
 const copy=real.length
  ?'Preços informativos de revendas autorizadas, com produto em estoque. Para pedir, confirme seu CEP, cesta e condições da entrega.'
  :localP13
    ?'Uma referência comercial ajuda a orientar sua pesquisa, mas somente a consulta por CEP confirma revendas, preço e entrega.'
    :'Sua vitrine local será preenchida por preços reais assim que houver revendas elegíveis.';
 const origin=region?.origin==='confirmed'?'Cidade lembrada de uma consulta por CEP':
   region?.origin==='chosen'?'Cidade escolhida por você':'São Gabriel é a vitrine inicial do TAMÃO';
 const savingGuide='<div class="tamao-quote-benefits" aria-label="Como aproveitar vantagens no TAMÃO">'+
   '<div class="tamao-quote-benefits-head"><div><span class="section-kicker">ECONOMIZE MAIS. VOLTE SEMPRE.</span>'+
    '<h3>Preço é só o começo. Veja todas as suas vantagens.</h3></div>'+
    '<button type="button" onclick="go(\'learn\')">Por que usar o TAMÃO? →</button></div>'+
   '<div class="tamao-quote-benefit-grid">'+
    '<article><span aria-hidden="true">💰</span><strong>Compare antes de comprar</strong>'+
     '<p>Compare o preço total e a entrega para seu CEP. Escolha o que faz mais sentido para você.</p>'+
     '<button type="button" onclick="startCustomerAvailability()">Consultar ofertas →</button></article>'+
    '<article><span aria-hidden="true">🎟️</span><strong>Clube, cashback e cupons</strong>'+
     '<p>Acompanhe créditos de compras elegíveis e consulte descontos de campanhas válidas, quando disponíveis.</p>'+
     '<button type="button" onclick="go(\'club\')">Ver minhas vantagens →</button></article>'+
    '<article><span aria-hidden="true">🤝</span><strong>Indicar também tem valor</strong>'+
     '<p>Apresente o TAMÃO a amigos e revendas. Acompanhe sua rede e os benefícios de indicações qualificadas.</p>'+
     '<button type="button" onclick="go(\'earn\')">Conhecer minha rede →</button></article>'+
   '</div></div>';
 return '<section class="city-price-board tamao-quote-first" aria-label="Painel de preços e vantagens de sua cidade">'+
  '<div class="tamao-quote-topline"><span>📊 PAINEL DE COTAÇÕES DO TAMÃO</span>'+
   '<span>'+(real.length&&checkedLabel?'Verificado em '+esc(checkedLabel):'Consulte preços e benefícios da sua região')+'</span></div>'+
  '<div class="city-price-heading"><div><span class="section-kicker">COTAÇÕES POR CIDADE</span>'+
   '<h2>'+(real.length?'Quanto custam os produtos em ':'Pesquise os preços em ')+esc(place)+'</h2><p>'+esc(copy)+'</p></div>'+
   '<span class="city-price-place">📍 '+esc(place)+'</span></div>'+
  '<p class="tiny muted city-price-location-note">'+esc(origin)+
   ' • Os preços reais substituem as referências automaticamente quando houver revendas elegíveis.</p>'+
  '<div class="city-price-grid">'+cards+'</div>'+
  (spread?'<div class="tamao-quote-spread"><span aria-hidden="true">↔</span><div><strong>Diferença de '+esc(spreadValue)+' entre os valores estimados para '+esc(spreadName)+'</strong>'+
   '<p>Variação entre revendas, não desconto nem economia garantida. Compare o total confirmado para seu CEP.</p></div></div>':'')+
  '<p class="city-price-disclaimer">'+(real.length
   ?'Valores preliminares de produto + taxa de entrega configurada; não são cotações finais nem garantia de atendimento.'
   :'Referência informativa, sem revenda associada. A consulta não cria pedido.')+'</p>'+
  '<div class="city-price-controls">'+
   '<button type="button" class="primary" onclick="startCustomerAvailability()">Escolher produtos e consultar entrega →</button>'+
   (globalThis.liveReady?.()===true?
     '<button type="button" class="secondary" onclick="homeRefreshQuotePrices()" aria-label="Atualizar cotações de preços da cidade">↻ Atualizar cotações</button>':'')+
   '<details class="city-price-chooser"><summary>Ver outra cidade</summary>'+
    '<div class="city-price-chooser-fields">'+
     '<label>Cidade<input id="home-city-name" maxlength="80" autocomplete="address-level2" value="'+esc(city)+'"></label>'+
     '<label>UF<input id="home-city-uf" maxlength="2" autocomplete="address-level1" value="'+esc(uf)+'"></label>'+
     '<button type="button" class="secondary" onclick="homeChooseMarketCity()">Atualizar vitrine</button>'+
    '</div></details></div>'+savingGuide+'</section>';
}

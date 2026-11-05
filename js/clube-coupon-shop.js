// The signed-in buyer sees only packages explicitly released by the server.
// A failed commercial preflight never manufactures a public offer.
const clubeCouponShopState={
  userId:null,status:'idle',packages:[],seller:null,error:null,busy:false,
  attempts:{},purchase:null,autoQueuedFor:null
};
function clubeCouponShopPanel(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.())return '';
  const s=clubeCouponShopState.userId===uid?clubeCouponShopState:null;
  // Fetch once on opening the Clube, with no extra user click. Never request
  // an invoice/Pix here; the buyer must explicitly choose and accept terms.
  if((!s||s.status==='idle')&&!clubeCouponShopState.busy&&
     clubeCouponShopState.autoQueuedFor!==uid){
    clubeCouponShopState.autoQueuedFor=uid;
    Promise.resolve().then(()=>clubeCouponShopRefresh());
  }
  const money=n=>BRL.format((Number(n)||0)/100);
  const offers=(s?.status==='ready'?s.packages:[]).map(p=>{
    const key=String(p.packageKey||'');
    if(!/^[a-z][a-z0-9_]{2,39}$/.test(key))return '';
    return '<article class="card flat form-stack"><h3>'+esc(p.title)+'</h3>'+
     '<p><strong>'+esc(money(p.priceCents))+'</strong> por '+
     Number(p.couponCount)+' cupons de '+esc(money(p.faceCents))+'</p>'+
     '<p class="tiny muted">Válidos por '+Number(p.validDays)+' dias após a emissão. '+
     'Valem para qualquer produto do catálogo. '+
     (Number(p.minOrderCents)>0?'Pedido mínimo: '+esc(money(p.minOrderCents))+'.':'')+'</p>'+
     '<label class="check-row"><input type="checkbox" id="clube-coupon-terms-'+key+'">'+
     '<span>Li e aceito as condições, inclusive que pode não haver revendas na minha região, que a validade começa na emissão e que posso solicitar reembolso de um pacote não utilizado.</span></label>'+ 
     '<button type="button" class="text-link" onclick="go(\'terms\')">Ler condições completas</button>'+ 
     '<button type="button" class="primary small" onclick="clubeCouponBuy(\''+
     key+'\')" '+(s.busy?'disabled':'')+'>Comprar com Pix</button></article>';
  }).join('');
  const seller=s?.seller;
  const sellerInfo=seller?'<aside class="card flat form-stack" aria-label="Fornecedor dos cupons">'+
    '<strong>Quem vende os cupons</strong>'+
    '<p>'+esc(String(seller.name||''))+' · Documento: '+esc(String(seller.taxDocument||''))+'</p>'+
    '<p>Endereço: '+esc(String(seller.address||''))+'</p>'+
    '<p>Atendimento e cancelamentos: '+esc(String(seller.supportEmail||''))+'</p></aside>':'';
  const purchase=s?.purchase;
  const pix=String(purchase?.pixCode||'');
  const validCode=pix.length>=30&&pix.length<=3000;
  let paymentLink='';
  try{
    const u=new URL(String(purchase?.paymentUrl||''));
    if(u.protocol==='https:'&&
       ['mercadopago.com.br','www.mercadopago.com.br'].includes(u.hostname))
      paymentLink='<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">Abrir pagamento seguro no Mercado Pago</a>';
  }catch{}
  const qr=String(purchase?.qrImageDataUri||'');
  const qrImage=/^data:image\/png;base64,[A-Za-z0-9+/=]{16,300000}$/.test(qr)
    ?'<img alt="QR Code Pix do pedido de cupom" src="'+esc(qr)+'" style="max-width:240px;width:100%;height:auto">':'';
  const payment=purchase?'<article class="card flat form-stack">'+
    '<strong>Pagamento do seu pacote</strong>'+
    '<p>Valor: '+esc(money(purchase.amountCents))+' • Situação: '+
     esc(purchase.status==='paid'&&purchase.fundingPending===true?
       'Pagamento identificado; cupons aguardam conciliação financeira':
       purchase.status||'Em conferência')+'</p>'+
    (purchase.pixPayable===true?(qrImage+
      (validCode?'<label>Código Pix copia e cola<textarea readonly rows="3" class="input">'+
        esc(pix)+'</textarea></label><button type="button" class="secondary small" onclick="clubeCouponCopyPix()">Copiar código Pix</button>':'')+
      paymentLink):'')+
    '<button type="button" class="secondary small" onclick="clubeCouponCheckInvoice(\''+
       esc(String(purchase.invoiceId||''))+'\')" '+(s?.busy?'disabled':'')+
       '>Conferir pagamento e cupons</button></article>':'';
  const empty=s?.status==='ready'&&s.packages.length===0
    ?'<p class="muted">Não há pacotes liberados para compra neste momento. Você ainda pode consultar cupons já emitidos na sua conta.</p>':'';
  const error=s?.status==='failed'?'<p class="notice danger">Não foi possível consultar os pacotes. Tente novamente.</p>':'';
  const loading=(!s||s.status==='idle'||s.status==='loading'||s.busy)&&!purchase
    ?'<p class="tiny muted" role="status">Conferindo pacotes disponíveis…</p>':'';
  return '<section class="section" aria-label="Comprar cupons TAMÃO">'+
   '<div class="section-head"><div><h2>Pacotes de cupons</h2>'+
   '<p>Escolha um pacote disponível e pague com Pix. Os cupons são vinculados à sua conta.</p>'+
   '<p class="tiny muted">A compra de cupons não reserva produtos ou entrega. O desconto só pode ser usado quando houver revenda atendendo seu CEP. Sem atendimento disponível, você poderá solicitar cancelamento e reembolso no histórico do Clube.</p></div>'+
   '<button type="button" class="secondary small" onclick="clubeCouponShopRefresh()" '+
   (s?.busy?'disabled':'')+'>Consultar pacotes</button></div>'+
   (offers?'<div class="grid cards-2">'+offers+'</div>':'')+
   loading+error+sellerInfo+empty+payment+'</section>';
}
async function clubeCouponShopRefresh(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.())return;
  if(clubeCouponShopState.busy)return;
  if(clubeCouponShopState.userId!==uid)Object.assign(clubeCouponShopState,{
    userId:uid,status:'idle',packages:[],seller:null,attempts:{},purchase:null
  });
  clubeCouponShopState.busy=true;
  try{
    const result=await liveInvoke('coupon-credit-pix',{action:'catalog'});
    if(result?.source!=='clube_paid_catalog_v1_807'||result.ok!==true||
       !Array.isArray(result.packages))throw Error('COUPON_CATALOG_NOT_VERIFIED');
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    const valid=result.packages.filter(p=>
      /^[a-z][a-z0-9_]{2,39}$/.test(String(p.packageKey||''))&&
      Number.isSafeInteger(p.priceCents)&&p.priceCents>=100&&
      Number.isSafeInteger(p.faceCents)&&p.faceCents>=100&&
      Number.isSafeInteger(p.couponCount)&&p.couponCount>=1&&p.couponCount<=15&&
      Number.isSafeInteger(p.validDays)&&p.validDays>=1&&p.validDays<=365&&
      p.termsVersion==='clube_coupon_terms_v1_813'
    );
    clubeCouponShopState.packages=valid;
    clubeCouponShopState.seller=valid.length&&
      result.seller&&typeof result.seller.name==='string'&&
      typeof result.seller.taxDocument==='string'&&
      typeof result.seller.address==='string'&&
      typeof result.seller.supportEmail==='string'
      ?result.seller:null;
    if(valid.length&&!clubeCouponShopState.seller)
      throw Error('COUPON_SELLER_NOT_DISCLOSED');
    clubeCouponShopState.status='ready';
  }catch(err){
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    clubeCouponShopState.status='failed';
    clubeCouponShopState.error=String(err?.message||err);
  }finally{
    clubeCouponShopState.busy=false;
    if(route()==='club')render();
  }
}
async function clubeCouponBuy(packageKey){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.()||clubeCouponShopState.busy||
     clubeCouponShopState.userId!==uid)return;
  const p=clubeCouponShopState.status==='ready'?
    clubeCouponShopState.packages.find(x=>x.packageKey===packageKey):null;
  if(!p)return toast('Atualize os pacotes antes de comprar.');
  if(!document.getElementById('clube-coupon-terms-'+packageKey)?.checked)
    return toast('Leia e aceite as condições do pacote antes de comprar.');
  if(p.termsVersion!=='clube_coupon_terms_v1_813')
    return toast('Não foi possível confirmar a versão das condições. Atualize a página.');
  clubeCouponShopState.busy=true;
  if(route()==='club')render();
  try{
    // Old pending invoice must be resumed, never replaced with a second Pix.
    if(clubePaidCouponView.userId!==uid||clubePaidCouponView.status!=='ready'){
      await clubePaidCouponsRefresh();
      if(clubePaidCouponView.userId!==uid||clubePaidCouponView.status!=='ready')
        throw Error('COUPON_HISTORY_NOT_READY');
    }
    const previous=clubePaidCouponView.purchases.find(x=>
      x.packageKey===packageKey&&
      ['prepared','awaiting_payment'].includes(String(x.status)));
    if(previous?.invoiceId&&previous.status!=='prepared'){
      await clubeCouponCheckInvoice(previous.invoiceId,true);
      return;
    }
    // An interrupted prepared invoice is retried with its OWN immutable UUID,
    // never a second invoice, even after a page reload.
    if(previous?.status==='prepared'&&
       !/^[0-9a-f-]{36}$/i.test(String(previous.requestId||'')))
      throw Error('COUPON_PREPARED_REPLAY_KEY_MISSING');
    if(!clubeCouponShopState.attempts[packageKey])
      clubeCouponShopState.attempts[packageKey]=previous?.requestId||crypto.randomUUID();
    const requestId=clubeCouponShopState.attempts[packageKey];
    const result=await liveInvoke('coupon-credit-pix',{
      action:'purchase',packageKey,requestId,
      termsAccepted:true,termsVersion:p.termsVersion
    });
    if(result?.ok!==true||!/^[0-9a-f-]{36}$/i.test(String(result.invoiceId||'')))
      throw Error('COUPON_PIX_NOT_CONFIRMED');
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    clubeCouponShopState.purchase=result;
    // Retain same request UUID during ambiguous retries / pending payments.
    await clubePaidCouponsRefresh();
  }catch(err){
    if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid)
      toast('Não foi possível confirmar o Pix. Consulte o pedido antes de tentar novamente.');
  }finally{
    clubeCouponShopState.busy=false;
    if(route()==='club')render();
  }
}
async function clubeCouponCheckInvoice(invoiceId,nested=false){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.()||(!nested&&clubeCouponShopState.busy)||
     !/^[0-9a-f-]{36}$/i.test(String(invoiceId||'')))return;
  if(!nested)clubeCouponShopState.busy=true;
  try{
    const result=await liveInvoke('coupon-credit-pix',{action:'invoice-status',invoiceId});
    if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
    if(result?.ok!==true||result.invoiceId!==invoiceId)
      throw Error('COUPON_INVOICE_NOT_CONFIRMED');
    // A paid invoice without separately verified net funds is NOT an available coupon.
    clubeCouponShopState.purchase=result;
    await clubePaidCouponsRefresh();
  }catch(err){
    if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid)
      toast('Pagamento não confirmado. Reabra o Pix original ou consulte novamente.');
  }finally{
    if(!nested)clubeCouponShopState.busy=false;
    if(route()==='club')render();
  }
}
async function clubeCouponCopyPix(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(clubeCouponShopState.userId!==uid||!uid)return;
  const code=String(clubeCouponShopState.purchase?.pixCode||'');
  if(code.length<30||code.length>3000)return;
  try{
    await navigator.clipboard.writeText(code);
    toast('Código Pix copiado.');
  }catch{toast('Selecione e copie o código Pix exibido.');}
}


// History is lazy-loaded with the coupon shop and never costs the merchant startup JS.
function clubeCouponPurchasesPanel(){
 const money=value=>BRL.format(Math.max(0,Number(value)||0)/100);
return (clubePaidCouponView.status==='ready' && clubePaidCouponView.userId===String(globalThis.liveRuntime?.session?.user?.id||''))?
 clubePaidCouponView.purchases.slice(0,20).map(inv=>{
  const id=String(inv.invoiceId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))return '';
  const request=String(inv.refundStatus||'');
  const allowed=['paid','awaiting_payment','prepared','review_required'].includes(String(inv.status));
  const seller=inv.seller;
  return '<article class="card flat"><strong>Compra de cupons</strong>'+
   '<p>'+esc(money(inv.amountCents))+' · '+esc(inv.status)+'</p>'+
   (inv.fundingModel==='partner_funded'
    ?'<p class="tiny">Cupom pago financiado pela revenda participante. O desconto depende de adesão da revenda e pedido elegível; o TAMÃO não o converte em cashback comum.</p>'
    :'')+
   (seller?'<p class="tiny muted">Vendedor: '+esc(String(seller.name||''))+
      ' · '+esc(String(seller.taxDocument||''))+'</p>':'')+
   (request==='refunded'&&inv.status==='refunded'?
     '<p class="tiny">Reembolso confirmado pelo provedor.</p>':
    request?'<p class="tiny muted">Pedido de reembolso registrado. O Pix ainda não está confirmado como devolvido.</p>'+
      '<button class="secondary small" type="button" onclick="clubeCouponRefundAsk(\''+id+'\')">Conferir reembolso</button>':
    allowed?'<label class="tiny">Motivo do cancelamento<select id="clube-refund-reason-'+id+'" class="input">'+
       '<option value="arrependimento">Desistência / arrependimento</option>'+
       '<option value="sem_atendimento">Não há revenda para utilizar</option>'+
       '<option value="outro">Outro motivo</option></select></label>'+
      '<button class="secondary small" type="button" onclick="clubeCouponRefundAsk(\''+id+
       '\')">Solicitar cancelamento / reembolso</button>':'')+'</article>';
 }).join(''):'';
}

// A cancellation is a protocol/request, NOT an immediate Pix reversal.
async function clubeCouponRefundAsk(invoiceId){
 const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
 if(!uid||!globalThis.liveReady?.()||
    !/^[0-9a-f-]{36}$/i.test(String(invoiceId||'')))return;
 const invoice=clubePaidCouponView.userId===uid&&clubePaidCouponView.status==='ready'?
  clubePaidCouponView.purchases.find(x=>x.invoiceId===invoiceId):null;
 if(!invoice||invoice.refundStatus==='refunded')return;
 const existing=Boolean(invoice.refundStatus);
 const choice=existing?'outro':String(document.getElementById('clube-refund-reason-'+invoiceId)?.value||'');
 if(!['arrependimento','sem_atendimento','outro'].includes(choice))
   return toast('Escolha o motivo do cancelamento.');
 if(!existing&&!window.confirm('Confirma o cancelamento do pacote? A devolução do Pix só aparece como concluída após confirmação do Mercado Pago.'))return;
 try{
  const result=await liveInvoke('coupon-credit-pix',{action:'request-refund',
    invoiceId,requestId:crypto.randomUUID(),reason:choice});
  if(result?.ok!==true||result?.source!=='clube_coupon_refund_request_v1_814'||
     result?.invoiceId!==invoiceId)throw Error('COUPON_REFUND_REQUEST_UNVERIFIED');
  if(String(globalThis.liveRuntime?.session?.user?.id||'')!==uid)return;
  toast('Pedido recebido. Protocolo: '+String(result.requestId).slice(0,8)+'. Aguardando análise do reembolso.');
  await clubePaidCouponsRefresh();
 }catch{
  if(String(globalThis.liveRuntime?.session?.user?.id||'')===uid)
   toast('Não foi possível registrar o pedido. Consulte seu histórico e tente novamente.');
 }
}

// ESM lazy load: onclick handlers must be available on the customer window.
Object.assign(globalThis,{clubeCouponShopPanel,clubeCouponShopRefresh,
  clubeCouponBuy,clubeCouponCheckInvoice,clubeCouponCopyPix,clubeCouponRefundAsk,
  clubeCouponPurchasesPanel});

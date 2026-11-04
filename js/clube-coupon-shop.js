// V1.807: packages are shown ONLY when the provider, merchant-settlement,
// sponsor backing and central commerce gates have all been verified server-side.
const clubeCouponShopState={
  userId:null,status:'idle',packages:[],error:null,busy:false,
  attempts:{},purchase:null
};
function clubeCouponShopPanel(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.())return '';
  const s=clubeCouponShopState.userId===uid?clubeCouponShopState:null;
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
     '<span>Li e aceito as condições para comprar e usar estes cupons, incluindo validade, valor mínimo, disponibilidade regional e pedidos de cancelamento.</span></label>'+ 
     '<button type="button" class="text-link" onclick="go(\'terms\')">Ler condições completas</button>'+ 
     '<button type="button" class="primary small" onclick="clubeCouponBuy(\''+
     key+'\')" '+(s.busy?'disabled':'')+'>Comprar com Pix</button></article>';
  }).join('');
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
    ?'<p class="muted">Confira novamente mais tarde os pacotes e suas condições. Os cupons emitidos continuam disponíveis em sua conta.</p>':'';
  const error=s?.status==='failed'?'<p class="notice danger">Não foi possível consultar os pacotes. Tente novamente.</p>':'';
  return '<section class="section" aria-label="Comprar cupons TAMÃO">'+
   '<div class="section-head"><div><h2>Pacotes de cupons</h2>'+
   '<p>Escolha um pacote disponível e pague com Pix. Os cupons são vinculados à sua conta.</p></div>'+
   '<button type="button" class="secondary small" onclick="clubeCouponShopRefresh()" '+
   (s?.busy?'disabled':'')+'>Consultar pacotes</button></div>'+
   (offers?'<div class="grid cards-2">'+offers+'</div>':'')+
   error+empty+payment+'</section>';
}
async function clubeCouponShopRefresh(){
  const uid=String(globalThis.liveRuntime?.session?.user?.id||'');
  if(!uid||!globalThis.liveReady?.())return;
  if(clubeCouponShopState.busy)return;
  if(clubeCouponShopState.userId!==uid)Object.assign(clubeCouponShopState,{
    userId:uid,status:'idle',packages:[],attempts:{},purchase:null
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


// ESM lazy load: onclick handlers must be available on the customer window.
Object.assign(globalThis,{clubeCouponShopPanel,clubeCouponShopRefresh,
  clubeCouponBuy,clubeCouponCheckInvoice,clubeCouponCopyPix});
